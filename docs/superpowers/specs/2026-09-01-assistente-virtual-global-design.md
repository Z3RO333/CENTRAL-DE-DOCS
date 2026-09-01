# Assistente virtual global (widget + memória + multi-domínio)

## Contexto

Hoje existe um copiloto de IA (`documentosCopilotAgent.ts`) especializado em
um único domínio — busca de documentos —, embutido como card fixo dentro da
página `/documentos` (`DocumentosCopilot.tsx`). Ele usa function calling
(`buscar_documentos`, `buscar_lojas`, `buscar_prestadores`) e devolve
insights (por status, por loja, tendência mensal). A memória da conversa
vive só em `useState` do componente: some ao recarregar a página ou sair da
tela.

O pedido é evoluir isso para algo no espírito do widget "EVA" (assistente
flutuante global de outro sistema usado pela empresa): uma bolha de chat
disponível em qualquer página do app, com atalhos rápidos, e memória que
persiste entre sessões — cobrindo não só documentos, mas também orçamentos
internos e cobranças.

## Objetivo

1. Generalizar o agente de "hard-coded para documentos" para
   **multi-domínio**, com controle de acesso por domínio.
2. Um **widget flutuante global**, substituindo o card embutido de
   documentos.
3. **Memória persistente**: uma conversa contínua por usuário, salva no
   banco, que sobrevive a reload/logout/login.
4. Estender a cobertura do agente para os domínios **orçamentos internos** e
   **cobranças**, com o mesmo nível de insights que documentos já tem hoje.

Fora de escopo (mantido do design anterior): o agente nunca executa ações
que alterem estado (aplicar filtro, abrir documento, disparar cobrança,
aprovar orçamento) — ele só busca e explica; toda ação continua exigindo um
clique do usuário.

Este documento cobre três fases, cada uma implementada e entregue
separadamente (plano de implementação próprio por fase), mas especificadas
juntas porque a Fase 1 é a base estrutural das outras duas.

---

## Fase 1 — Infraestrutura (widget global + memória + registro de domínios)

### Arquitetura: registro de domínios

O agente deixa de ser um módulo monolítico por domínio e passa a ser um
**core genérico** (`src/lib/assistenteAgent.ts`) que carrega uma lista de
domínios registrados:

```ts
type AssistenteDominioId = "documentos" | "orcamentos" | "cobrancas";

type AssistenteToolResult = {
  content: string;              // JSON serializado devolvido ao modelo
  resultado?: AssistenteSearchOutcome; // preenchido só por tools de busca
};

type AssistenteDominio = {
  id: AssistenteDominioId;
  descricaoPrompt: (ctx: AssistenteContext) => string; // trecho do system prompt
  tools: AzureOpenAiTool[];
  podeAcessar: (ctx: AssistenteContext) => Promise<boolean>;
  executarTool: (
    nome: string,
    args: Record<string, unknown>,
    ctx: AssistenteContext,
  ) => Promise<AssistenteToolResult>;
};

type AssistenteSearchOutcome = {
  dominio: AssistenteDominioId;
  filters: Record<string, unknown>;
  results: AssistenteResultItem[];
  total: number;
  insights: AssistenteInsights;
};

type AssistenteResultItem = {
  id: string;
  titulo: string;
  subtitulo: string;
  url: string;            // rota já filtrada pra abrir na tela certa
  abrirArquivoPath?: string; // quando aplicável (documentos/orçamentos)
};
```

Fluxo por turno (mantém o loop de tool-calling já validado no design
anterior, agora genérico):

1. `runAssistenteAgent(request, auth)` resolve, para o usuário autenticado,
   quais domínios estão acessíveis (`podeAcessar`) e monta:
   - o system prompt concatenando a introdução geral + `descricaoPrompt` de
     cada domínio acessível;
   - a lista de `tools` = união das tools dos domínios acessíveis (mais
     `buscar_lojas`/`buscar_prestadores`, que sobem para o nível
     compartilhado do agente por serem usadas por mais de um domínio).
2. Loop de até 5 iterações chamando o Azure OpenAI com essas tools. Cada
   `tool_call` é despachado para o domínio dono da tool (`executarTool`).
   Tool desconhecida ou tool de domínio sem acesso → erro serializado pro
   modelo, nunca lançado.
3. Ao final, `lastOutcome` (o último resultado de busca de qualquer domínio
   naquele turno) alimenta a resposta genérica:

```ts
type AssistenteResponse = {
  reply: string;
  dominio: AssistenteDominioId | null;
  summary: string;
  filters: Record<string, unknown>;
  results: AssistenteResultItem[];
  total: number;
  insights: AssistenteInsights;
};
```

O domínio "documentos" existente é portado para esse formato: suas
`DocumentoCopilotMatch` viram `AssistenteResultItem` (mapeamento simples:
`nome`→`titulo`, `identificacao`→`subtitulo`, path assinado resolvido →
`url`/`abrirArquivoPath`), e sua lógica de tools/insights migra de
`documentosCopilotAgent.ts`/`documentosCopilot.ts` para um módulo
`src/lib/assistenteDominioDocumentos.ts` implementando a interface
`AssistenteDominio`. Nenhuma regra de negócio de documentos muda — é
puramente uma migração de forma.

### Insights genéricos

O padrão já existente em `documentosCopilot.ts` (`buildInsightItems`,
`buildTrendItems`, `buildAnalyticInsights`) é extraído para
`src/lib/assistenteInsights.ts`, parametrizado:

```ts
function buildInsightItems<T>(
  rows: T[],
  getKey: (row: T) => string | null | undefined,
  getLabel: (row: T) => string,
  totalBase: number,
  limit?: number,
): AssistenteInsightItem[];

function buildTrendItems<T>(
  rows: T[],
  getDate: (row: T) => string,
  limit?: number,
): AssistenteTrendItem[];
```

Cada domínio chama esses helpers com seus próprios `rows`/extratores e monta
seu `AssistenteInsights` (mesmo shape que `DocumentoCopilotInsights` hoje:
totais, `porStatus`, `porLoja`, `tendenciaMensal`, `observacoes`). Domínios
que recebem dados já agregados (cobranças, Fase 3) passam os agregados
diretamente sem re-agrupar — o helper aceita isso porque opera sobre
qualquer `T[]`, não exige uma linha por documento.

### Persistência da conversa

Nova tabela:

```sql
create table assistente_conversas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  mensagens jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now(),
  criado_em timestamptz not null default now()
);

alter table assistente_conversas enable row level security;

create policy "usuario le sua conversa"
  on assistente_conversas for select
  using (auth.uid() = user_id);

create policy "usuario escreve sua conversa"
  on assistente_conversas for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

Cada elemento de `mensagens` é `{ role: "user" | "assistant", text: string,
dominio?: AssistenteDominioId, criado_em: string }`. Não persiste
`results`/`insights`/`filters` daquele turno — são recalculáveis e podem
refletir uma permissão que já não se aplica mais no momento em que a
conversa é reaberta; persistir só o texto evita reexibir dado desatualizado
ou que o usuário não deveria mais ver.

Acesso via `supabaseAdmin` no servidor (mesmo padrão de todo o resto do
app — RLS como defesa em profundidade, não como único controle, já que o
service role já bypassa RLS; a policy documenta a intenção e protege contra
uso futuro do client anônimo).

Endpoints:

- `GET /api/assistente/historico` — devolve as últimas `MAX_HISTORY_MESSAGES`
  (mantém 10) mensagens da conversa do usuário autenticado. Widget chama isso
  ao montar (primeira vez que abre a bolha, não a cada render).
- `POST /api/assistente/chat` — substitui `POST /api/documentos/copilot`.
  Recebe só a nova pergunta + contexto de tela (`{ pergunta, currentContext }`)
  em vez do histórico completo (o backend já tem o histórico persistido — o
  front não precisa reenviar); processa o turno via `runAssistenteAgent`, e
  ao final faz upsert em `assistente_conversas` acrescentando a pergunta do
  usuário e a resposta do assistente ao array `mensagens` (mantendo só as
  últimas 10 para não crescer sem limite — trim no mesmo upsert).
- `DELETE /api/assistente/historico` — "Nova conversa": apaga a linha
  (ou zera `mensagens`) da conversa do usuário.

### Widget flutuante

Componente `src/components/AssistenteWidget.tsx`, montado uma vez em
`src/app/layout.tsx` (fora de rotas de login/formulário público — mesma
checagem de sessão que o resto do app já usa para decidir o que renderizar
no layout autenticado).

- **Fechado**: bolha circular fixa (`fixed bottom-6 right-6 z-50`), ícone/
  avatar, abre o painel ao clicar.
- **Aberto**: painel flutuante (não modal, não bloqueia clique fora) com:
  - header com título e botão de fechar/minimizar;
  - corpo rolável com a thread de mensagens (bolha do usuário à direita,
    card de resposta do assistente à esquerda — reaproveita o markup de
    `AssistantTurnCard` de `DocumentosCopilot.tsx`, generalizado para os
    campos de `AssistenteResponse`);
  - ao abrir pela primeira vez na sessão do browser, busca
    `GET /api/assistente/historico` e popula a thread;
  - chips de atalho rápido (Documentos / Orçamentos / Cobranças — só exibe
    o chip se o domínio correspondente estiver acessível ao usuário, mesma
    lista que o backend usa) quando a thread está vazia; clicar preenche o
    textarea com uma pergunta inicial sugerida, não envia direto;
  - textarea + botão enviar; botão "Nova conversa" chama o `DELETE` e limpa
    a thread local.
- **Contexto de tela**: usa `usePathname()` para detectar se a rota atual é
  de um domínio conhecido (`/documentos*` → documentos,
  `/orcamentos-internos*` → orçamentos, `/cobrancas*` → cobranças) e, nesse
  caso, lê os filtros/query params atuais da URL para montar
  `currentContext: { dominio, filtros }`, enviado em cada pergunta — mesmo
  papel que `currentFilters` cumpre hoje, generalizado.
- **Ação em resultado**: cada `AssistenteResultItem` renderiza um botão que
  usa `url` (navegação via `router.push`) ou, se tiver
  `abrirArquivoPath`, abre o arquivo assinado (mesma lógica de
  `getSignedFileUrl`/`resolveSignedPdfPath` que `DocumentosCopilot.tsx` já
  tem, movida para um helper compartilhado).

`DocumentosCopilot.tsx` e o card na página de documentos são **removidos**
— o widget cobre esse caso via detecção de rota.

### Testes (Fase 1)

- Unitário: registro de domínios — usuário sem acesso a um domínio não
  recebe as tools desse domínio nem o trecho de prompt correspondente.
- Unitário: `assistenteInsights.ts` (`buildInsightItems`/`buildTrendItems`)
  com casos genéricos (não específicos de documento).
- Unitário: upsert de `assistente_conversas` mantém só as últimas 10
  mensagens.
- Integração: fluxo completo do domínio documentos migrado — mesmos
  cenários de teste que já existem em `documentosCopilotAgent.test.ts`,
  adaptados para a nova estrutura, devem continuar passando (não há
  regressão de comportamento, só de forma).
- Integração: `GET /historico` → `POST /chat` → `GET /historico` de novo
  reflete a mensagem persistida; `DELETE /historico` zera.
- Manual: abrir o widget em páginas fora de documentos/orçamentos/cobranças
  (ex. home) e confirmar que os atalhos ainda funcionam sem contexto de
  tela.

---

## Fase 2 — Domínio orçamentos

Implementa `src/lib/assistenteDominioOrcamentos.ts` seguindo a interface
`AssistenteDominio`.

### Tool `buscar_orcamentos`

Parâmetros: `termo`, `status` (enum dos 8 valores de
`ORCAMENTO_INTERNO_STATUSES`), `lojaId`, `prestadorId`, `gestorEmail`,
`dataInicio`, `dataFim`, `valorMin`, `valorMax`, `escopo` (`"meus" |
"aprovacao" | "todos"`, default `"meus"`).

Reaproveita `buscar_lojas`/`buscar_prestadores` (já compartilhados desde a
Fase 1).

### Controle de acesso

`podeAcessar` chama a mesma checagem que `GET /api/orcamentos-internos` já
faz (`assertInternalActor`). Dentro de `executarTool`, a query replica
exatamente as regras hoje em `route.ts`:

- Sem ser admin/aprovador: força `solicitante_id = userId`, ignora
  `escopo` vindo do modelo.
- `escopo: "todos"` só é aceito de admin/aprovador; caso contrário, erro
  serializado orientando o modelo a usar `"meus"`.
- Mesmos filtros de `status`, `lojaId`, `prestadorId`, `gestorEmail`,
  intervalo de data e valor que a tela já suporta.

### Insights

Usando `assistenteInsights.ts`: por status (rótulos de `STATUS_LABEL`), por
loja, tendência mensal (por `created_at`). Acrescenta um total agregado que
documentos não tem: **soma de `valor_total`** dos resultados encontrados —
exibido como card extra "Valor total" no widget.

### Resultado

`titulo`: `numero_orcamento` + prestador. `subtitulo`: status (label
legível) + valor formatado. `url`: rota de orçamentos internos com os
mesmos filtros aplicados como query params (padrão de `buildDocumentosUrl`,
replicado para essa tela).

### Testes (Fase 2)

- Unitário: `buscar_orcamentos` — usuário comum nunca recebe resultado de
  outro solicitante mesmo pedindo `escopo: "todos"`.
- Unitário: filtros de valor/data aplicados corretamente.
- Integração: pergunta tipo "meus orçamentos aguardando aprovação" resolve
  para `status: "aguardando_aprovacao", escopo: "meus"` e retorna insights
  com soma de valor.

---

## Fase 3 — Domínio cobranças

Implementa `src/lib/assistenteDominioCobrancas.ts`.

### Tool `consultar_pendencias_cobranca`

Parâmetro: `ano` (opcional, default = `anoManaus()`). Chama
`levantarPendencias(ano, supabaseAdmin)` (já existe em
`cobrancasService.ts`), que devolve pendências já agregadas por
prestador+loja.

### Controle de acesso

`podeAcessar`: só admin ou `isAprovadorInterno(email)` — mesma regra do
`GET /api/cobrancas/pendencias`. Para qualquer outro usuário, o domínio
inteiro (tool + trecho de prompt + chip de atalho no widget) não existe.

### Mascaramento de e-mail

Reaproveita `mascararEmail` (hoje inline em
`src/app/api/cobrancas/pendencias/route.ts`, movido para
`cobrancasService.ts` como export) — o agente nunca recebe nem expõe e-mail
de prestador em texto pleno.

### Insights

`assistenteInsights.ts` recebe os agregados por prestador diretamente (sem
reagrupar linha a linha, já que `levantarPendencias` já entrega isso
pronto): por prestador (total faltante), por loja, sem tendência mensal
(não faz sentido para um snapshot de um ano — omitido, não zerado).

### Resultado

`titulo`: nome do prestador. `subtitulo`: "`N` pendências / `M`
faltantes". `url`: rota de cobranças.

### Fora de escopo (reforço explícito)

O agente nunca dispara cobrança, mesmo que o usuário peça — o system prompt
do domínio reforça essa regra especificamente, já que essa tela (diferente
de documentos/orçamentos) tem uma ação de efeito real e sensível (envio de
e-mail) diretamente relacionada aos dados consultados.

### Testes (Fase 3)

- Unitário: usuário não-gestor não recebe a tool nem o domínio no prompt.
- Unitário: e-mails na resposta do agente sempre mascarados.
- Integração: pedido de "disparar cobrança pro fornecedor X" via chat →
  agente recusa e explica que a ação deve ser feita pela tela.

---

## Notas de migração

- `documentosCopilotAgent.ts`, `documentosCopilotAgent.test.ts`, e o card
  `DocumentosCopilot.tsx` são removidos ao final da Fase 1 (substituídos
  pelos módulos novos) — não ficam como código morto em paralelo.
- `POST /api/documentos/copilot` é removido ao final da Fase 1 em favor de
  `POST /api/assistente/chat`.
- Cada fase é seu próprio plano de implementação (`writing-plans`), na
  ordem 1 → 2 → 3. A Fase 1 é pré-requisito das outras duas.
