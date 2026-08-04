# Detecção de frases críticas e classificação de emergência — sub-projeto 5/8 (Central de Documentos)

## Contexto

Quinto subsistema da reformulação da Central de Documentos (ver
[2026-07-31-analise-ia-automatica-design.md](2026-07-31-analise-ia-automatica-design.md)
para a lista completa dos 8 subsistemas). Cobre as seções 2 ("Identificação
de palavras e frases críticas") e 3 ("Melhoria das recomendações de
emergência") do pedido original. Trabalho independente sobre o mesmo
pipeline dos sub-projetos 1 e 4 — não depende do 3 (controle mensal) nem do
7 (painel consolidado), mas alimenta dados que o 7 provavelmente vai
consumir depois.

Depende de:
- Sub-projeto 1 (análise automática por IA) — em produção.
- Sub-projeto 4 (identificação automática de equipamento) — em produção;
  reaproveita o `equipamento_id` já resolvido para o documento, não
  identifica equipamento por achado individualmente (decisão explícita do
  usuário, ver "Fora de escopo").

## Escopo

A IA, ao analisar automaticamente Registro e Laudos ou Notas Fiscais
(mesmo escopo de tipos do sub-projeto 4), passa a também extrair achados
críticos — trechos que indicam problema, risco ou necessidade de
manutenção — com uma classificação de prioridade e uma recomendação
específica (não genérica), e grava cada achado numa tabela nova para
consulta futura.

### Fora de escopo

- Identificação de equipamento por achado individual — cada achado usa o
  mesmo `equipamento_id` já resolvido para o documento inteiro (sub-projeto
  4). Se o documento não tem equipamento resolvido, o achado fica sem
  `equipamento_id`.
- Qualquer tela nova ou painel consolidado de achados críticos — só
  armazenamento estruturado e exibição no detalhe do documento já
  existente. Painel fica para o sub-projeto 7.
- Abertura real de ordem de manutenção em qualquer sistema (não existe
  essa entidade neste app — o achado só registra a *necessidade*, como um
  booleano).
- Alertas por e-mail para achados críticos — sub-projeto 6, explicitamente
  adiado pelo usuário.

## Extração pela IA

`src/lib/openAiDocumentAnalysis.ts`: `DocumentoAnaliseIa` ganha um campo
novo, aditivo (não substitui `recomendacoes`/`alertas`, que continuam como
estão):

```
recomendacoes_criticas: Array<{
  trecho: string;
  pagina: number | null;
  problema: string;
  componente: string | null;
  recomendacao_tecnica: string;
  prioridade: "emergencial" | "critica" | "alta" | "moderada" | "preventiva" | "informativa";
  prazo_dias: number | null;
  impacto: string | null;
  acao_necessaria: string;
  desligar_equipamento: boolean;
  substituir_peca: boolean;
  precisa_inspecao_presencial: boolean;
  abrir_ordem_corretiva: boolean;
  riscos: string[]; // subconjunto livre de: operacional, eletrico, estrutural, sanitario, seguranca
}>
```

O prompt do sistema, condicionado a `tipoDocumento` ser `registro_laudos`
ou `notas_fiscais`, ganha instrução para:
- Procurar semanticamente por indícios de problema/risco/necessidade de
  manutenção — não só as frases literais do pedido original ("É necessário
  substituir", "Recomenda-se a troca", "Equipamento apresenta falha",
  etc.), mas variações de escrita e o contexto técnico do documento.
- Para cada achado, preencher todos os campos acima com base no conteúdo
  real do documento — nunca uma recomendação genérica tipo "fazer
  manutenção".
- Classificar a prioridade considerando o contexto, não palavra-chave
  isolada: `emergencial` = ação imediata; `critica` = resolver em até 24h;
  `alta` = até 3 dias; `moderada` = até 7 dias; `preventiva` = acompanhar/
  programar; `informativa` = não exige ação.
- Para qualquer outro tipo de documento, retornar array vazio.

## Armazenamento

Nova tabela `public.documento_recomendacoes_criticas`, uma linha por
achado:

| Coluna | Notas |
|---|---|
| `id` | uuid PK |
| `documento_id` | FK `formularios.id`, obrigatório |
| `equipamento_id` | FK `equipamentos.id`, nullable — copiado do documento no momento da análise |
| `loja_id` | copiado de `dados->>'loja_id'` do documento, nullable |
| `tipo_documento`, `competencia` | copiados do documento, para consulta sem precisar fazer join |
| `trecho`, `pagina`, `problema`, `componente`, `recomendacao_tecnica`, `impacto`, `acao_necessaria` | texto livre, do achado |
| `prioridade` | texto, CHECK nos 6 valores da classificação |
| `prazo_dias` | integer, nullable |
| `desligar_equipamento`, `substituir_peca`, `precisa_inspecao_presencial`, `abrir_ordem_corretiva` | boolean |
| `riscos` | text[] |
| `created_at` | timestamptz |

## Onde entra no pipeline

Tanto no orquestrador automático (`processarDocumentoComIa`, disparado
pelo webhook) quanto na rota manual de reanálise
(`/api/documentos/[id]/analisar`) — **os dois precisam da mesma lógica**,
já que uma revisão anterior desta sessão encontrou um bug real por essa
lógica ter sido adicionada só no orquestrador automático e esquecida na
rota manual. Depois que `resultado` chega da IA:

1. Para cada item em `resultado.recomendacoes_criticas`, insere uma linha
   em `documento_recomendacoes_criticas`, usando o `equipamento_id` e
   `loja_id` já resolvidos para o documento.
2. Se pelo menos um achado tem `prioridade` igual a `emergencial` ou
   `critica`, isso força `status_analise_ia = 'necessita_revisao'` — mesmo
   que os critérios de confiança/loja/competência/equipamento já
   existentes indicassem `concluida`. Implementado como mais um parâmetro
   opcional em `determinarStatusFinal` (a função já ganhou um parâmetro de
   contexto de equipamento no sub-projeto 4; este é outro campo desse
   mesmo objeto de contexto, não uma assinatura nova).

## Tela

`DocumentDetailsDrawer.tsx` (painel de detalhes do documento, já existe)
ganha uma seção nova mostrando os achados críticos daquele documento —
badge de prioridade (cor por nível, mesmo espírito do badge de
`status_analise_ia` já existente), problema, ação necessária, prazo, e os
4 flags booleanos como indicadores visuais curtos (ex.: ícone/etiqueta
"Desligar equipamento", "Substituir peça"). A lista genérica de
`recomendacoes` que já existe na tela continua exatamente como está, sem
mudança — a seção nova é adicional.

## Testes necessários

- Prompt/schema só populam `recomendacoes_criticas` para
  `registro_laudos`/`notas_fiscais` — outros tipos sempre array vazio
  (mesmo padrão de teste já usado pros campos de equipamento do
  sub-projeto 4).
- Inserção de uma linha em `documento_recomendacoes_criticas` por achado,
  com `equipamento_id`/`loja_id` copiados do documento.
- Documento com zero achados críticos não insere nenhuma linha e não força
  `necessita_revisao` por causa disso.
- Documento com pelo menos um achado `emergencial` ou `critica` força
  `necessita_revisao`, mesmo com confiança alta e loja/competência/
  equipamento todos resolvidos.
- Documento só com achados `moderada`/`preventiva`/`informativa` não força
  revisão.
- A mesma lógica de gravação + força de revisão roda tanto no orquestrador
  automático quanto na rota manual de reanálise — teste (ou verificação
  explícita no plano) cobrindo os dois caminhos, não só um.
