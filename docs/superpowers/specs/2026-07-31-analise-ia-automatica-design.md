# Análise automática por IA no upload — sub-projeto 1/8 (Central de Documentos)

## Contexto

Pedido original do usuário é uma reformulação ampla da Central de Documentos:
automação da leitura por IA, detecção de frases críticas, classificação de
emergência, cadastro de equipamentos por loja, controle mensal por
equipamento, identificação automática de documentos, alertas de pendência por
e-mail, painel de acompanhamento, histórico/auditoria e ciclo de vida de
recomendações.

Esse escopo cobre pelo menos 8 subsistemas independentes, cada um com seu
próprio schema, regras de negócio e telas, alguns dependentes de outros
(ex.: alerta por equipamento não existe sem cadastro de equipamento). Ficou
combinado com o usuário quebrar em specs sequenciais:

1. **Análise automática por IA no upload** (este spec)
2. Cadastro de equipamentos por loja
3. Controle mensal por equipamento
4. Identificação automática do documento (loja/equipamento/mês) + fila de revisão
5. Detecção de frases críticas + classificação de emergência (evolução do
   schema de análise já existente)
6. Alertas de documento faltante por equipamento + e-mail
7. Painel + histórico/auditoria + ciclo de vida da recomendação
8. Validações de integridade (tratadas junto de cada subsistema que protegem,
   não como projeto isolado)

Levantamento no Supabase (projeto `formulario central`,
`tqzvgqauvbknwdvbtvfr`) confirmou que **nenhuma** tabela de equipamento
existe hoje — os subprojetos 2–4 partem do zero.

## O que já existe (achado no código antes do brainstorm)

- Análise por IA já funciona (Azure OpenAI Chat + Azure Document Intelligence
  para OCR de PDF), em `src/lib/openAiDocumentAnalysis.ts`. Extrai tipo,
  competências, loja, prestador, valores, alertas, observações e
  recomendações num JSON estruturado.
- Duas rotas chamam essa função hoje, cada uma com sua cópia de lógica de
  persistência:
  - `POST /api/documentos/[id]/analisar` — botão manual "Analisar com IA" no
    `DocumentDetailsDrawer`, para documentos já existentes em `formularios`
    (notas fiscais, laudos, retenção trabalhista, contratos, orçamentos
    externos).
  - `POST /api/orcamentos-internos/[id]/analisar` — chamada automaticamente
    pelo próprio formulário de intake de Orçamentos Internos, **antes** do
    envio final, para sugerir prestador/valor/data que o usuário confere e
    corrige antes de submeter para aprovação do gestor.
- Resultado de cada análise é salvo em `documentos_analises_ia` (id,
  documento_id, provider, model, status, resultado jsonb, erro, created_at).
  Hoje só grava linha em caso de sucesso — uma falha não deixa rastro na
  tabela, só um erro 500 na resposta HTTP.
- Todos os inserts em `formularios` acontecem **direto do navegador para o
  Supabase** (não passam por uma rota de API do Next.js) em pelo menos duas
  telas: `src/app/formulario/[slug]/page.tsx` (tipos `notas_fiscais`,
  `registro_laudos`, `retencao_trabalhista`, `contratos`, `orcamentos`) e
  `src/app/documentos/contratos/page.tsx`.

## Escopo deste sub-projeto

Eliminar o clique manual do botão "Analisar com IA" para os tipos inseridos
em `formularios` via os formulários de envio: `notas_fiscais`,
`registro_laudos`, `retencao_trabalhista`, `contratos`, `orcamentos`
(externo). A análise passa a rodar sozinha assim que o documento é recebido.

### Fora de escopo (decisão explícita do usuário)

- **Orçamentos internos mantém o fluxo atual.** Já é automático hoje (roda
  ao anexar o arquivo, antes do envio) — não vira um pipeline 100%
  pós-envio, porque isso tiraria a chance do usuário corrigir a extração
  antes do orçamento ir para aprovação. Só a implementação por baixo dos
  panos é unificada com o novo pipeline compartilhado; o botão
  "reanalisar" continua existindo como retry manual em caso de erro.
- **`notas_fiscais_conservacao` fica de fora.** Não tem análise de IA hoje
  e não foi pedido neste subprojeto.
- Detecção de frases críticas e classificação de emergência (sub-projeto 5)
  — este spec só cobre o gatilho automático e o status de processamento,
  não o conteúdo da análise.
- Cadastro de equipamento e qualquer vínculo documento↔equipamento
  (sub-projetos 2–4) — a análise automática deste spec continua vinculando
  só a loja e o prestador, como já faz hoje.

## Arquitetura

```
Usuário envia formulário (NF, Laudo, Retenção, Contrato, Orçamento externo)
        │
        ▼
INSERT direto em `formularios` (client → Supabase, como já é hoje)
        │
        ▼
Supabase Database Webhook (novo) dispara em AFTER INSERT ON formularios
        │  POST com header de segredo compartilhado (env var)
        ▼
Nova rota: POST /api/documentos/ia/processar
        │
        ├─ 1. Valida o segredo do header (rejeita chamadas sem ele)
        ├─ 2. Ignora tipos fora de escopo (orcamentos_internos já tem seu
        │     próprio caminho; notas_fiscais_conservacao fica de fora)
        ├─ 3. Verifica duplicidade: mesma loja + prestador + tipo +
        │     competência já existente com status concluído
        ├─ 4. Marca status_analise_ia = 'em_analise'
        ├─ 5. Baixa o arquivo do Storage
        ├─ 6. Roda o pipeline compartilhado (OCR + Azure OpenAI)
        ├─ 7. Grava resultado em documentos_analises_ia (sucesso OU erro)
        └─ 8. Atualiza status_analise_ia final
```

**Por que webhook do banco, e não a tela chamar a rota direto:** o insert
acontece do navegador em mais de uma tela hoje, e webhook garante que
**todo** insert dispara a análise — mesmo que o usuário feche a aba antes de
qualquer callback, e mesmo que uma terceira tela de envio apareça no futuro
sem que alguém lembre de adicionar a chamada manualmente lá.

**Por que isso é seguro em termos de tempo de resposta:** a aplicação roda em
Azure App Service (servidor Node persistente), não em função serverless com
limite curto — não há risco de timeout no polling do OCR (que já hoje pode
levar até ~30s).

## Status de processamento

Novo campo `status_analise_ia` em `formularios`:

```
recebido → aguardando_analise → em_analise → concluida
                                           → necessita_revisao
                                           → erro
                                           → duplicado
```

- **duplicado**: mesma loja + prestador + tipo + competência já tem
  documento concluído. Não bloqueia o envio, só sinaliza — o documento
  continua existindo normalmente, apenas não dispara nova análise.
- **necessita_revisao**: IA rodou, mas com `confianca_geral` abaixo do
  limiar (definir 0.5 como ponto de partida) ou sem conseguir identificar
  loja, prestador ou competência.
- **erro**: falha técnica (OCR fora do ar, IA fora do ar, arquivo
  corrompido/ilegível) — fica registrado com a mensagem de erro, permite
  reprocessar manualmente.

`documentos_analises_ia.status` continua existindo por tentativa (histórico
de cada rodada); `formularios.status_analise_ia` reflete o estado atual do
documento como um todo, para listar e filtrar rapidamente.

## Mudanças no banco de dados

- Migration nova:
  `ALTER TABLE public.formularios ADD COLUMN status_analise_ia text NOT NULL DEFAULT 'recebido' CHECK (status_analise_ia IN ('recebido','aguardando_analise','em_analise','concluida','necessita_revisao','erro','duplicado'));`
- `documentos_analises_ia`: permitir status `'erro'` e passar a inserir linha
  também quando a análise falhar (hoje só insere em caso de sucesso), usando
  a coluna `erro` já existente para a mensagem.
- Configurar o Database Webhook no Supabase (via SQL/dashboard) apontando
  `AFTER INSERT ON public.formularios` para a nova rota, com o segredo em
  header customizado.

## Mudanças de código

- Extrair a lógica de persistência hoje duplicada entre
  `src/app/api/documentos/[id]/analisar/route.ts` e
  `src/app/api/orcamentos-internos/[id]/analisar/route.ts` para uma função
  compartilhada nova, `src/lib/documentAnalysisPipeline.ts` — baixar
  arquivo, chamar `analisarDocumentoComOpenAi`, gravar em
  `documentos_analises_ia`, atualizar `status_analise_ia`, tratar duplicidade
  e erro. As duas rotas existentes passam a usar essa função por baixo.
- Nova rota `src/app/api/documentos/ia/processar/route.ts` — autenticada só
  por segredo de header (quem chama é o Supabase, não uma sessão de
  usuário), usa a função compartilhada.
- `src/app/documentos/_components/DocumentDetailsDrawer.tsx` — troca o botão
  "Analisar com IA" por um badge de status (ex.: "Em análise pela IA",
  "Necessita revisão", "Erro na leitura"). Mantém botão de **reprocessar**
  só quando o status for `erro` ou `necessita_revisao`.

## Testes necessários

- Webhook chega com payload de cada um dos 5 tipos em escopo → gera análise
  e status final correto.
- Insert de `orcamentos_internos` ou `notas_fiscais_conservacao` → rota
  ignora, não dispara pipeline duplicado.
- Documento duplicado (mesma loja/prestador/tipo/competência já concluída)
  → marca `duplicado`, não roda a IA de novo.
- Falha de OCR/IA → grava `erro` com mensagem em `documentos_analises_ia`,
  não deixa o registro travado em `em_analise` indefinidamente.
- Rota `/api/documentos/ia/processar` retorna 401/403 para chamada sem o
  segredo correto ou com segredo errado.
- Confiança baixa ou dados incompletos (sem loja/prestador/competência
  identificados) → marca `necessita_revisao`.
