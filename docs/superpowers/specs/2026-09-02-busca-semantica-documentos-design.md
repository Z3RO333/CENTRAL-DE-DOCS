# Busca semântica de documentos (RAG) na Central de Documentos

## Contexto

O chat de IA da Central de Documentos (domínio `documentos` do assistente
virtual) encontra documentos apenas por metadados. A consulta "o laudo do
gerador da Matriz" não retorna nada, mesmo quando o documento existe.

Este documento especifica a evolução dessa busca para recuperação semântica
sobre o **conteúdo** dos documentos, mantendo intactos os filtros,
permissões, visualização, download e organização já existentes.

## Diagnóstico da busca atual

Levantamento feito no código antes do desenho:

1. **A busca nunca olha o conteúdo.** `buildDocumentosTextSearchOr`
   (`src/lib/documentosApiUtils.ts:52-77`) executa `ilike '%termo%'` sobre uma
   lista fixa de 14 campos de metadados (`dados->>empresa`,
   `dados->>prestador`, `dados->>numero_nf`, `dados->>descricao`,
   `dados->>observacoes`, `dados->>tipo_laudo`, `dados->>loja_nome`,
   `dados->anexos->0->>nome`, `arquivo_path`, …). O texto do documento não
   está em nenhum deles.

2. **O texto do OCR já é extraído e descartado.** `openAiDocumentAnalysis.ts`
   chama o Azure Document Intelligence para PDFs, usa o texto para extração
   estruturada por LLM, e `analisarDocumentoComOpenAi` retorna apenas
   `{ provider, model, resultado }`. O texto nunca é persistido:
   `documentos_analises_ia.resultado` guarda somente o JSON estruturado.
   O insumo necessário para busca semântica já é produzido a cada upload.

3. **`ilike` é substring literal.** Não há stemming, sinônimos, full-text
   search (`tsvector`) nem embeddings — verificado: zero ocorrências de
   `vector`/`embedding`/`pgvector` no repositório. "gerador" não casa com
   "grupo motogerador", "GMG", "alternador" ou "motor diesel".

4. **A pergunta não é decomposta em filtros.** A tool `buscar_documentos`
   recebe `termo` como texto livre; se o modelo enviar a frase inteira, o
   `ilike` procura essa frase literal, que não existe em campo algum.

5. **Não existe filtro por equipamento.** A tabela `equipamentos`
   (`tipo_equipamento`, `identificacao`, `numero_serie`, por loja) e a coluna
   `formularios.equipamento_id` já ligam documento↔equipamento, mas nem a
   tool do agente nem `queryDocumentoCandidates` expõem esse filtro.

6. **O vocabulário existente é raso.** `servicosVocab.ts` traz 21 categorias
   e casa por distância de Levenshtein (tolerância a erro de digitação), sem
   sinônimos nem termos relacionados.

7. **Relevância é apenas cronológica.** `queryDocumentoCandidates` ordena por
   `created_at desc` e trunca. Não há score nem reordenação.

### Ativos reaproveitáveis

- OCR já integrado (Azure Document Intelligence) e disparado por webhook do
  banco a cada documento novo → `/api/documentos/ia/processar` →
  `processarDocumentoComIa` (`src/lib/documentAnalysisPipeline.ts:360`).
- `documento_recomendacoes_criticas` já persiste `trecho`, `pagina`,
  `problema`, `componente`, `recomendacao_tecnica`, `acao_necessaria` e
  `prioridade`, ligados a documento, equipamento, loja e competência.
- RPC de pendências por equipamento, com `frequencia` (mensal/semestral/
  anual), já calcula documento esperado × recebido por ano
  (`202607311500_add_frequencia_equipamentos_e_rpc_pendencias.sql`).
- `buildDocumentosAccessOr` (`src/lib/documentosAccessFilters.ts`) — filtro
  de permissão que deve continuar governando qualquer busca nova.
- `servicosVocab.ts` e os `tipo_equipamento` cadastrados como semente da
  taxonomia.

## Objetivo

Permitir que o chat entenda o contexto da solicitação e encontre documentos
pelo conteúdo, combinando busca semântica, busca textual e filtros de
metadados, respondendo sempre com base nos documentos recuperados e citando
suas fontes.

Fora de escopo: alterar a tela de documentos, seus filtros, o fluxo de
upload/assinatura, ou a busca de metadados existente (que permanece
disponível).

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Infra vetorial | `pgvector` no Supabase | Permite aplicar permissão e filtros no mesmo `WHERE` da busca vetorial. Sem segundo banco para sincronizar, sem reimplementar permissão fora do Postgres. |
| Modelo de embedding | Azure OpenAI, deployment novo (`text-embedding-3-small`, 1536 dimensões) | Mesmo tenant Azure já usado; custo desprezível para o volume. |
| Acervo existente | Backfill completo, em lotes com teto diário e retomada | Sem isso a busca só enxerga documentos novos — justamente o oposto do que se quer consultar. |
| Granularidade | Trecho (chunk), não documento inteiro | Necessário para citar o trecho que justificou o resultado e para achar detalhe no meio de um laudo longo. |
| Combinação de sinais | Híbrida: vetorial + `tsvector`, fundidos por RRF, reranking por LLM | Embeddings falham em identificadores literais (NF, série, CNPJ); full-text falha em sinônimos. |
| Expansão da taxonomia | Sugestão automática + aprovação do admin | Termo errado aprovado automaticamente degrada a busca de todos, silenciosamente. |

## Arquitetura geral

```
Upload → webhook → processarDocumentoComIa
                     ├── (existente) OCR → extração estruturada → dados/análise
                     └── (novo) persistir texto → chunking → embeddings → índice

Pergunta → interpretação (filtros + consulta semântica + expansão por taxonomia)
         → WHERE permissão + filtros
         → [busca vetorial ‖ busca textual] → RRF → agregação por documento
         → reranking por LLM (top ~20 trechos)
         → resposta com fontes, justificativa e confiança
```

---

## Fase 1 — Fundação de conteúdo

### `documento_conteudo` (1:1 com `formularios`)

```sql
create table public.documento_conteudo (
  documento_id uuid primary key references public.formularios(id) on delete cascade,
  texto text not null,
  origem text not null check (origem in ('ocr', 'pdf_texto', 'nao_aplicavel')),
  paginas integer,
  arquivo_hash text,
  caracteres integer not null default 0,
  indexado_em timestamptz,
  erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`arquivo_hash` (SHA-256 do arquivo) evita reprocessar OCR do mesmo arquivo —
o custo de OCR é por página e o backfill é grande.

### `documento_chunks`

```sql
create extension if not exists vector;

create table public.documento_chunks (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.formularios(id) on delete cascade,
  ordem integer not null,
  pagina integer,
  texto text not null,
  embedding vector(1536),
  -- colunas desnormalizadas: permitem filtrar no mesmo WHERE da busca vetorial
  loja_id text,
  tipo text,
  competencia text,
  equipamento_id uuid,
  prestador_id uuid,
  documento_created_at timestamptz,
  texto_tsv tsvector generated always as (to_tsvector('portuguese', texto)) stored,
  created_at timestamptz not null default now(),
  unique (documento_id, ordem)
);

create index documento_chunks_embedding_idx
  on public.documento_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
create index documento_chunks_tsv_idx on public.documento_chunks using gin (texto_tsv);
create index documento_chunks_loja_idx on public.documento_chunks (loja_id);
create index documento_chunks_tipo_idx on public.documento_chunks (tipo);
create index documento_chunks_equipamento_idx on public.documento_chunks (equipamento_id);
```

A desnormalização é deliberada: sem ela, aplicar permissão e filtros exigiria
join com `formularios` dentro da busca vetorial, degradando o plano de
execução. As colunas são reescritas quando o documento é reindexado.

Ambas as tabelas seguem a convenção de segurança do repositório: RLS
habilitada e `revoke all ... from public, anon, authenticated` — acesso
exclusivamente via `supabaseAdmin` na camada de API, como em
`202607311600_create_documento_recomendacoes_criticas.sql`.

### Chunking

- Alvo de ~1000 caracteres por trecho, com ~150 de sobreposição.
- Quebra preferencial em fim de parágrafo, depois em fim de frase; corte duro
  só quando não houver limite natural.
- Trechos com menos de 50 caracteres úteis são descartados (ruído de OCR).
- `pagina` preenchida quando o OCR fornecer a informação.

### Geração de embeddings

Módulo novo `src/lib/embeddings.ts`, isolado atrás de uma interface mínima
(`gerarEmbeddings(textos: string[]): Promise<number[][]>`), para que trocar de
provedor não exija tocar no restante. Variáveis novas:
`AZURE_OPENAI_EMBEDDING_DEPLOYMENT` e `AZURE_OPENAI_EMBEDDING_API_VERSION`.
Envio em lote, com retry exponencial e limite de tokens por requisição.

### Ingestão

`processarDocumentoComIa` ganha uma etapa final `indexarConteudoDocumento`:
persistir texto → chunking → embeddings → gravar chunks.

**Regra de não-regressão:** falha na indexação nunca derruba o upload nem a
análise. O erro é gravado em `documento_conteudo.erro` e o documento segue
com `status_analise_ia` normal. A busca semântica é aditiva.

Para evitar OCR duplicado, `analisarDocumentoComOpenAi` passa a retornar
também o texto extraído (`textoExtraido`), que hoje é descartado — mudança
aditiva no tipo de retorno.

### Backfill

Endpoint administrativo `POST /api/documentos/indexacao/backfill`, restrito a
admin, processando um lote por chamada (tamanho configurável, padrão 25):
seleciona documentos sem `documento_conteudo` ou com `indexado_em` nulo,
ordenados do mais recente para o mais antigo, e indexa. Retorna progresso
(`processados`, `restantes`, `erros`) para acompanhamento e retomada.

Teto diário configurável (`INDEXACAO_LIMITE_DIARIO`) protege o custo de OCR.

---

## Fase 2 — Taxonomia e metadados

### Tabelas

```sql
create table public.taxonomia_termos (
  id uuid primary key default gen_random_uuid(),
  termo text not null unique,          -- canônico, ex.: 'gerador'
  categoria text not null,             -- ex.: 'Gerador / nobreak'
  tipo text not null check (tipo in ('assunto', 'equipamento')),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.taxonomia_sinonimos (
  id uuid primary key default gen_random_uuid(),
  termo_id uuid not null references public.taxonomia_termos(id) on delete cascade,
  variacao text not null,              -- ex.: 'grupo motogerador', 'GMG'
  origem text not null check (origem in ('semente', 'aprovado')),
  created_at timestamptz not null default now(),
  unique (variacao)
);

create table public.taxonomia_sugestoes (
  id uuid primary key default gen_random_uuid(),
  variacao text not null,
  termo_sugerido text,
  categoria_sugerida text,
  documento_id uuid references public.formularios(id) on delete set null,
  trecho text,
  ocorrencias integer not null default 1,
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovada', 'rejeitada')),
  revisado_por uuid references auth.users(id) on delete set null,
  revisado_em timestamptz,
  created_at timestamptz not null default now(),
  unique (variacao)
);
```

### Semente

Gerada a partir de `SERVICOS_OFICIAIS` (21 categorias) e dos
`tipo_equipamento` distintos já cadastrados em `equipamentos`, enriquecida
com termos relacionados por categoria. Exemplo para **Gerador / nobreak**:
`gerador`, `grupo gerador`, `motogerador`, `GMG`, `alternador`, `motor
diesel`, `teste de carga`, `banco de carga`, `nobreak`, `UPS`, `ATS`,
`transferência automática`, `combustível`, `óleo diesel`, `manutenção
preventiva`. Categorias equivalentes para refrigeração, elevadores,
subestação, combate a incêndio, ar-condicionado e as demais existentes.

A semente é um arquivo versionado no repositório (`src/lib/taxonomiaSeed.ts`)
aplicado por migração idempotente — assim ela evolui por code review, e o
que cresce em produção são os sinônimos aprovados.

### Expansão

Durante a análise de cada documento, o LLM já classifica tipo, equipamento e
competência. Passa a propor também termos técnicos recorrentes que **não**
constam da taxonomia. Cada proposta vira linha em `taxonomia_sugestoes`
(incrementando `ocorrencias` quando repetida), com o documento e o trecho de
origem.

Tela administrativa simples lista as sugestões pendentes ordenadas por
`ocorrencias` e permite aprovar (vira `taxonomia_sinonimos` com origem
`aprovado`) ou rejeitar. Nada entra na taxonomia sem aprovação.

### Metadados por documento

A classificação existente já cobre unidade, fornecedor, data, competência e
equipamento. Esta fase acrescenta a ligação com a taxonomia: os termos
canônicos identificados no documento são gravados em
`documento_conteudo.termos`, permitindo filtrar por assunto sem depender de
similaridade.

Essa coluna **não existe na Fase 1** — é adicionada por migração própria
desta fase:

```sql
alter table public.documento_conteudo
  add column termos text[] not null default '{}'::text[];

create index documento_conteudo_termos_idx
  on public.documento_conteudo using gin (termos);
```

Documentos já indexados na Fase 1 recebem seus termos numa passagem de
reclassificação que **não** refaz OCR nem embeddings — só lê o texto já
persistido e aplica a taxonomia, portanto sem custo de OCR.

---

## Fase 3 — Busca híbrida e resposta

### Interpretação da pergunta

Passo de LLM que converte a pergunta em:

```ts
type ConsultaInterpretada = {
  consultaSemantica: string;      // texto para embedding
  tipo?: string;                  // registro_laudos, notas_fiscais, ...
  assunto?: string;               // termo canônico da taxonomia
  lojaTermo?: string;             // texto a resolver via buscar_lojas
  equipamentoTermo?: string;
  ano?: string;
  mes?: string;
  ordenar: "relevancia" | "mais_recente";
};
```

Regra: termo que não resolve com segurança **não vira filtro rígido** — entra
apenas na consulta semântica. Filtrar por um chute errado zera o resultado,
que é o pior desfecho possível.

O `assunto` é expandido pela taxonomia (canônico + sinônimos aprovados) e os
termos expandidos alimentam tanto a consulta textual quanto o filtro por
`documento_conteudo.termos`.

### Recuperação

A busca vetorial exige SQL (`embedding <=> $consulta` não é expressável no
query builder do PostgREST), mas a regra de permissão vive em TypeScript
(`buildDocumentosAccessOr` devolve filtros PostgREST, não SQL). Reimplementar
essa regra em SQL criaria duas fontes de verdade para controle de acesso —
exatamente o tipo de divergência que causa vazamento silencioso.

Por isso a recuperação é feita em **duas etapas**, com a permissão decidida
uma única vez, no código que já existe:

**Etapa 1 — recorte autorizado (query builder, TypeScript).** Consulta
`formularios` aplicando `.or(buildDocumentosAccessOr(...))` — o mesmo caminho
da busca atual, sem alteração — mais os filtros resolvidos (tipo, loja,
competência, equipamento, período). Devolve os `documento_id` que o usuário
pode ver e que satisfazem os filtros, limitados a um teto
(`RECORTE_MAX_DOCUMENTOS`, padrão 2000).

Para quem tem acesso total (`canAccess: true`, o caso mais comum entre quem
usa o chat), `buildDocumentosAccessOr` devolve lista vazia — não há restrição
por documento e a etapa 1 aplica só os filtros. O caminho custoso afeta
apenas usuários de escopo restrito, que por definição enxergam menos
documentos.

**Etapa 2 — ranqueamento (RPC SQL).** `buscar_chunks_hibrido(p_documento_ids
uuid[], p_embedding vector, p_consulta_texto text, p_limite int)` opera
**exclusivamente dentro do allowlist recebido**. A RPC não decide permissão —
não tem como decidir, e é essa a intenção. Nela:

1. `WHERE c.documento_id = any(p_documento_ids)`.
2. **Dois rankings paralelos** sobre esse conjunto: similaridade de cosseno
   (`embedding <=> p_embedding`) e `ts_rank_cd` sobre `texto_tsv` com
   `websearch_to_tsquery('portuguese', p_consulta_texto)`.
3. **Fusão RRF:** `score = Σ 1/(60 + posicao_i)` sobre as duas listas.
4. **Agregação por documento:** o melhor trecho representa o documento; a
   quantidade de trechos relevantes entra como reforço secundário.

Se o recorte da etapa 1 estourar o teto, a busca informa que restringiu o
alcance e pede um filtro adicional — em vez de devolver um recorte arbitrário
silenciosamente.

### Reranking e resposta

Os ~20 melhores trechos vão a um passo de LLM que ordena por aderência à
pergunta e produz, para cada documento, a justificativa da escolha. A
resposta final é gerada **exclusivamente** a partir desses trechos.

`documento_recomendacoes_criticas` entra como fonte paralela: perguntas sobre
problemas, riscos ou recomendações (ex.: "existe recomendação para substituir
peças do gerador?") consultam essa tabela diretamente, que já traz trecho e
recomendação estruturados.

### Formato da resposta

1. Resposta direta à solicitação.
2. Documentos encontrados, ordenados por relevância e data.
3. Trecho ou justificativa por documento.
4. Fontes utilizadas.
5. Nível de confiança.
6. Sugestão de refinamento quando houver ambiguidade.

**Confiança** derivada de sinais objetivos, não da opinião do modelo:
`alta` — filtros principais resolvidos e melhor score destacado do segundo;
`media` — resultados plausíveis sem destaque claro, ou filtro relevante não
resolvido; `baixa` — só houve correspondência semântica fraca.

**Ambiguidade:** havendo vários candidatos plausíveis, apresenta os melhores
e pede **apenas** o dado que discrimina (o mês, ou qual unidade), nunca um
questionário.

**Sem resultado:** explica o que foi pesquisado (filtros aplicados e termos
expandidos), mostra o que existe de relacionado e sugere alternativas. Nunca
inventa documento, data, competência ou conclusão.

### Integração com o agente

Nova tool `buscar_documentos_conteudo` no domínio `documentos`, **ao lado**
da `buscar_documentos` atual (que continua sendo a ferramenta certa para
consultas de metadados como "todas as notas fiscais de março"). O prompt do
domínio orienta a escolha: conteúdo/assunto/pergunta técnica → busca
semântica; listagem por metadados → busca atual.

### Resultado no widget

`AssistenteResultItem` ganha campos **opcionais**: `justificativa`,
`trechoCitado`, `pagina`, `competencia`, `unidade`, `equipamento`,
`resumo`. `AssistenteResponse` ganha `confianca` e `sugestaoRefinamento`,
também opcionais. Domínios que não os preenchem seguem renderizando como
hoje — mudança aditiva, sem regressão em orçamentos e cobranças.

O botão de abrir/baixar arquivo reaproveita o fluxo já existente
(`abrirArquivoPath` + URL assinada), sem alteração.

---

## Fase 4 — Consultas analíticas

**Documentos faltantes** ("quais laudos de gerador estão faltando neste
ano?"): tool `consultar_documentos_faltantes(ano?, tipoEquipamento?, lojaId?)`
sobre a RPC de pendências já existente, filtrando por tipo de equipamento com
os termos da taxonomia. A regra de esperado × recebido por frequência
(mensal/semestral/anual) já está implementada e não é reescrita.

**Comparação entre documentos** ("compare os dois últimos laudos e informe o
que mudou"): tool `comparar_documentos(documentoIds[])`, restrita a 2
documentos, que recupera o conteúdo de ambos e pede ao LLM uma comparação
estruturada — cada diferença citando de qual documento veio. Se um dos
documentos não estiver indexado, a tool informa isso em vez de comparar
parcialmente em silêncio.

---

## Compatibilidade e não-regressão

- Permissões: a regra continua exclusivamente em `buildDocumentosAccessOr`,
  inalterado. A RPC de ranqueamento não decide acesso — recebe um allowlist
  de documentos já autorizados e não consegue enxergar nada fora dele.
  Nenhum caminho novo consulta chunks sem esse recorte.
- A tool `buscar_documentos` e `queryDocumentoCandidates` permanecem
  inalteradas.
- Tela de documentos, filtros, visualização, download e organização não são
  tocados.
- Falha de indexação, de embedding ou de OCR nunca impede upload, análise ou
  consulta por metadados.
- Migrações seguem a convenção do repositório (RLS + `revoke`), e nenhuma
  tabela existente muda de forma incompatível.

## Testes

**Fase 1:** chunking (respeito a parágrafo, sobreposição, descarte de trecho
curto); `arquivo_hash` evita reprocessar; falha de embedding não derruba a
análise; backfill retoma de onde parou sem duplicar.

**Fase 2:** expansão de termo pela taxonomia (canônico → sinônimos);
sugestão duplicada incrementa `ocorrencias` em vez de duplicar linha; termo
só passa a valer na busca após aprovação.

**Fase 3:** o filtro de permissão é aplicado (usuário sem acesso não recebe
trecho de documento alheio — teste explícito); termo não resolvido não vira
filtro rígido; RRF ordena como esperado; sem resultado, a resposta explica a
busca e não inventa; ambiguidade gera pedido de um único dado.

**Fase 4:** faltantes respeita a frequência do equipamento; comparação com
documento não indexado informa a limitação.

**Regressão (todas as fases):** a suíte existente do domínio `documentos`
continua verde, e `buscar_documentos` mantém o comportamento atual.

## Riscos

- **Custo de OCR no backfill** é o item de maior incerteza: é por página e
  depende do tamanho do acervo. O teto diário existe para isso; a ordem de
  grandeza deve ser medida antes de liberar o backfill completo.
- **Qualidade do OCR** limita o teto da busca: documento digitalizado torto
  ou com carimbo sobre o texto indexa mal. Mitigação: `caracteres` em
  `documento_conteudo` permite detectar extração pobre e sinalizar.
- **`ivfflat` exige dados para treinar bem o índice.** Com acervo pequeno no
  início, `lists` deve ser ajustado (ou o índice recriado) após o backfill.
