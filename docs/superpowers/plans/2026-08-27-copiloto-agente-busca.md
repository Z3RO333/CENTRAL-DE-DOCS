# Copiloto de documentos como agente de busca — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o copiloto de documentos de um extrator de filtros em uma única chamada (LLM) para um agente com tool-calling real, que decide sozinho quantos passos dar (buscar documentos, resolver loja/prestador por nome parcial, refinar) antes de responder, com conversa mantida no cliente.

**Architecture:** Loop de tool-calling no servidor (máx. 5 iterações por pergunta) usando 3 ferramentas — `buscar_documentos`, `buscar_lojas`, `buscar_prestadores` — todas implementadas sobre código já existente (`queryDocumentoCandidates`, já corrigido para aplicar filtro de loja/prestador de verdade). O histórico da conversa vive só no componente React (`useState`), reenviado a cada pergunta; nada novo é persistido no Supabase.

**Tech Stack:** Next.js (API route), TypeScript, Supabase (`@supabase/supabase-js`), Azure OpenAI (`gpt-5-chat`, function calling nativo — validado), Vitest para testes.

**Spec:** [docs/superpowers/specs/2026-08-27-copiloto-agente-busca-design.md](../specs/2026-08-27-copiloto-agente-busca-design.md)

## Global Constraints

- Máximo de 5 iterações de tool-calling por pergunta (corta e devolve o melhor resultado disponível, nunca trava).
- Histórico de conversa: só no estado do componente React, nunca persistido no banco; cliente manda no máximo as últimas 10 mensagens por requisição.
- O agente nunca executa ações (aplicar filtro, abrir documento) sozinho — só busca e explica; toda ação continua exigindo clique do usuário.
- O agente nunca inventa IDs de loja/prestador — só usa IDs devolvidos por `buscar_lojas`/`buscar_prestadores`.
- Se `buscar_lojas`/`buscar_prestadores` devolver mais de um resultado plausível e a pergunta não distinguir, o agente pergunta antes de buscar documentos.
- Respostas sempre em português do Brasil.
- Todo filtro que chega em `buscar_documentos` passa pela normalização determinística já existente (`stripKnownFilters` e as funções `normalize*`) antes de virar query.

---

## Task 1: Tool-calling na Azure OpenAI

**Files:**
- Modify: `src/lib/azureOpenAi.ts`
- Test: `src/lib/azureOpenAi.test.ts`

**Interfaces:**
- Produces: `AzureOpenAiChatMessage` (union com `system`/`user`/`assistant`/`tool`), `AzureOpenAiTool`, `AzureOpenAiToolCall`, `AzureOpenAiChatResult = { content: string | null; toolCalls: AzureOpenAiToolCall[] }`, `callAzureOpenAiChat(input: { messages: AzureOpenAiChatMessage[]; maxTokens?: number; tools?: AzureOpenAiTool[] }): Promise<AzureOpenAiChatResult>`.

Hoje `callAzureOpenAiChat` sempre manda `response_format: { type: "json_object" }` e devolve só a `string` de `content`, assumindo que nunca é vazio. Isso quebra tool-calling: quando o modelo chama uma ferramenta, `content` vem `null` (não é um erro) e `response_format: json_object` força um formato incompatível com texto livre + tool_calls. Este task tira `response_format` e faz a função devolver `content` (pode ser `null`) e `toolCalls` (pode ser vazio).

- [ ] **Step 1: Escrever os testes (falhando)**

Crie `src/lib/azureOpenAi.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { callAzureOpenAiChat } from "@/lib/azureOpenAi";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

const mockFetchOnce = (body: unknown, status = 200) => {
  global.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
};

describe("callAzureOpenAiChat", () => {
  it("devolve o content quando o modelo responde texto direto", async () => {
    vi.stubEnv("AZURE_OPENAI_API_KEY", "chave-teste");
    mockFetchOnce({
      choices: [{ message: { content: "Ola!", tool_calls: undefined } }],
    });

    const result = await callAzureOpenAiChat({
      messages: [{ role: "user", content: "oi" }],
    });

    expect(result).toEqual({ content: "Ola!", toolCalls: [] });
  });

  it("devolve toolCalls e content null quando o modelo chama uma ferramenta", async () => {
    vi.stubEnv("AZURE_OPENAI_API_KEY", "chave-teste");
    mockFetchOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "buscar_documentos", arguments: '{"tipo":"notas_fiscais"}' },
              },
            ],
          },
        },
      ],
    });

    const result = await callAzureOpenAiChat({
      messages: [{ role: "user", content: "notas fiscais" }],
      tools: [
        {
          type: "function",
          function: { name: "buscar_documentos", description: "busca", parameters: { type: "object", properties: {} } },
        },
      ],
    });

    expect(result.content).toBeNull();
    expect(result.toolCalls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "buscar_documentos", arguments: '{"tipo":"notas_fiscais"}' },
      },
    ]);
  });

  it("lanca erro com a mensagem da Azure quando a resposta nao e ok", async () => {
    vi.stubEnv("AZURE_OPENAI_API_KEY", "chave-teste");
    mockFetchOnce({ error: { message: "chave invalida" } }, 401);

    await expect(
      callAzureOpenAiChat({ messages: [{ role: "user", content: "oi" }] }),
    ).rejects.toThrow("chave invalida");
  });

  it("lanca erro quando falta a api key", async () => {
    vi.stubEnv("AZURE_OPENAI_API_KEY", "");

    await expect(
      callAzureOpenAiChat({ messages: [{ role: "user", content: "oi" }] }),
    ).rejects.toThrow("Configure AZURE_OPENAI_API_KEY");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/azureOpenAi.test.ts`
Expected: FAIL (o arquivo `azureOpenAi.ts` ainda não expõe `toolCalls`/aceita `tools`).

- [ ] **Step 3: Reescrever `src/lib/azureOpenAi.ts`**

```ts
export type AzureOpenAiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type AzureOpenAiChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: AzureOpenAiToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type AzureOpenAiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AzureOpenAiChatResult = {
  content: string | null;
  toolCalls: AzureOpenAiToolCall[];
};

const DEFAULT_AZURE_OPENAI_ENDPOINT =
  "https://bml-azure-openai-agents.openai.azure.com/openai/deployments/gpt-5-chat/chat/completions?api-version=2025-01-01-preview";

type CallAzureOpenAiChatInput = {
  messages: AzureOpenAiChatMessage[];
  maxTokens?: number;
  tools?: AzureOpenAiTool[];
};

export async function callAzureOpenAiChat({
  messages,
  maxTokens = 700,
  tools,
}: CallAzureOpenAiChatInput): Promise<AzureOpenAiChatResult> {
  const endpoint =
    process.env.AZURE_OPENAI_ENDPOINT?.trim() ||
    DEFAULT_AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();

  if (!endpoint || !apiKey) {
    throw new Error("Configure AZURE_OPENAI_API_KEY na sua variável de ambiente.");
  }

  const payload: Record<string, unknown> = {
    messages,
    max_completion_tokens: maxTokens,
  };
  if (tools && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  const raw = (await response.json().catch(() => null)) as
    | {
        error?: { message?: string };
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: AzureOpenAiToolCall[];
          };
        }>;
      }
    | null;

  if (!response.ok) {
    throw new Error(
      raw?.error?.message ??
        `Azure OpenAI retornou status ${response.status}.`,
    );
  }

  const message = raw?.choices?.[0]?.message;
  return {
    content: message?.content?.trim() || null,
    toolCalls: message?.tool_calls ?? [],
  };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/azureOpenAi.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos (o único consumidor, `documentosCopilot.ts`, ainda usa a assinatura antiga — vai ser ajustado no Task 3/4; se o typecheck falhar por causa dele, siga em frente, é esperado até o Task 4 terminar).

- [ ] **Step 6: Commit**

```bash
git add src/lib/azureOpenAi.ts src/lib/azureOpenAi.test.ts
git commit -m "feat(copilot): suporta tool-calling na chamada Azure OpenAI"
```

---

## Task 2: Busca de lojas e prestadores por nome parcial

**Files:**
- Create: `src/lib/documentosCopilotEntitySearch.ts`
- Test: `src/lib/documentosCopilotEntitySearch.test.ts`

**Interfaces:**
- Produces: `LojaSearchResult = { id: string; nome: string | null; codigo: string | null }`, `PrestadorSearchResult = { id: string; nome: string | null }`, `ENTITY_SEARCH_LIMIT = 15`, `buscarLojasPorNome(query: string, supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>): Promise<LojaSearchResult[]>`, `buscarPrestadoresPorNome(query: string, supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>): Promise<PrestadorSearchResult[]>`.

Essas funções substituem o mecanismo antigo de mandar as ~2000 lojas/prestadores no prompt + regex de substring — o agente busca sob demanda via `ilike`.

- [ ] **Step 1: Escrever os testes (falhando)**

Crie `src/lib/documentosCopilotEntitySearch.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  buscarLojasPorNome,
  buscarPrestadoresPorNome,
} from "@/lib/documentosCopilotEntitySearch";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("buscarLojasPorNome", () => {
  it("busca por nome ou codigo parecido e devolve id/nome/codigo", async () => {
    const or = vi.fn(() => ({
      limit: async () => ({
        data: [{ id: "loja-302", nome: "302 - Avenida Paulista", codigo: "302" }],
        error: null,
      }),
    }));
    const supabase = {
      from: () => ({ select: () => ({ or }) }),
    } as unknown as SupabaseClient;

    const resultado = await buscarLojasPorNome("avenida", supabase);

    expect(resultado).toEqual([
      { id: "loja-302", nome: "302 - Avenida Paulista", codigo: "302" },
    ]);
    expect(or).toHaveBeenCalledWith(
      "nome.ilike.%avenida%,codigo.ilike.%avenida%",
    );
  });

  it("remove virgulas e parenteses do termo antes de montar o filtro", async () => {
    const or = vi.fn(() => ({ limit: async () => ({ data: [], error: null }) }));
    const supabase = {
      from: () => ({ select: () => ({ or }) }),
    } as unknown as SupabaseClient;

    await buscarLojasPorNome("avenida, (matriz)", supabase);

    expect(or).toHaveBeenCalledWith(
      "nome.ilike.%avenida  matriz%,codigo.ilike.%avenida  matriz%",
    );
  });

  it("devolve lista vazia para termo em branco sem consultar o banco", async () => {
    const from = vi.fn();
    const supabase = { from } as unknown as SupabaseClient;

    expect(await buscarLojasPorNome("   ", supabase)).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("propaga erro do supabase", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          or: () => ({ limit: async () => ({ data: null, error: new Error("falha") }) }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(buscarLojasPorNome("avenida", supabase)).rejects.toThrow("falha");
  });
});

describe("buscarPrestadoresPorNome", () => {
  it("busca por nome parecido e devolve id/nome", async () => {
    const ilike = vi.fn(() => ({
      limit: async () => ({
        data: [{ id: "prestador-1", nome: "Dinâmica Serviços" }],
        error: null,
      }),
    }));
    const supabase = {
      from: () => ({ select: () => ({ ilike }) }),
    } as unknown as SupabaseClient;

    const resultado = await buscarPrestadoresPorNome("dinamica", supabase);

    expect(resultado).toEqual([{ id: "prestador-1", nome: "Dinâmica Serviços" }]);
    expect(ilike).toHaveBeenCalledWith("nome", "%dinamica%");
  });

  it("devolve lista vazia para termo em branco sem consultar o banco", async () => {
    const from = vi.fn();
    const supabase = { from } as unknown as SupabaseClient;

    expect(await buscarPrestadoresPorNome("", supabase)).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/documentosCopilotEntitySearch.test.ts`
Expected: FAIL com "Cannot find module '@/lib/documentosCopilotEntitySearch'"

- [ ] **Step 3: Criar `src/lib/documentosCopilotEntitySearch.ts`**

```ts
import type { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { fixMojibakeText } from "@/lib/textEncoding";

export type LojaSearchResult = {
  id: string;
  nome: string | null;
  codigo: string | null;
};

export type PrestadorSearchResult = {
  id: string;
  nome: string | null;
};

export const ENTITY_SEARCH_LIMIT = 15;

const sanitizeSearchTerm = (query: string) =>
  query.trim().replace(/[,()%]/g, " ");

export async function buscarLojasPorNome(
  query: string,
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<LojaSearchResult[]> {
  const termo = sanitizeSearchTerm(query);
  if (!termo) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("lojas")
    .select("id,nome,codigo")
    .or(`nome.ilike.%${termo}%,codigo.ilike.%${termo}%`)
    .limit(ENTITY_SEARCH_LIMIT);

  if (error) {
    throw error;
  }

  return ((data as LojaSearchResult[]) ?? []).map((loja) => ({
    id: loja.id,
    nome: loja.nome ? fixMojibakeText(loja.nome) : null,
    codigo: loja.codigo,
  }));
}

export async function buscarPrestadoresPorNome(
  query: string,
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<PrestadorSearchResult[]> {
  const termo = sanitizeSearchTerm(query);
  if (!termo) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("prestadores")
    .select("id,nome")
    .ilike("nome", `%${termo}%`)
    .limit(ENTITY_SEARCH_LIMIT);

  if (error) {
    throw error;
  }

  return ((data as PrestadorSearchResult[]) ?? []).map((prestador) => ({
    id: prestador.id,
    nome: prestador.nome ? fixMojibakeText(prestador.nome) : null,
  }));
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/documentosCopilotEntitySearch.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentosCopilotEntitySearch.ts src/lib/documentosCopilotEntitySearch.test.ts
git commit -m "feat(copilot): busca lojas e prestadores por nome parcial"
```

---

## Task 3: Limpar e exportar as peças reaproveitáveis de `documentosCopilot.ts`

**Files:**
- Modify: `src/lib/documentosCopilot.ts`

**Interfaces:**
- Produces (passam a ser exportados, além do que já era público): `stripKnownFilters(filters: DocumentoCopilotFilters): DocumentoCopilotFilters`, `buildSearchSummary(filters: DocumentoCopilotFilters): string`, `createEmptyInsights(): DocumentoCopilotInsights`, `queryDocumentoCandidates(input: { filters: DocumentoCopilotFilters; userId: string; allowedPrestadores: string[]; gerenteEntries: GerenteAccessRow[]; canAccess: boolean; supabaseAdmin?: ReturnType<typeof createSupabaseAdminClient> }): Promise<{ matches: DocumentoCopilotMatch[]; total: number; insights: DocumentoCopilotInsights }>`.
- Removes: `runDocumentoCopilot`, `buildPrompt`, `applyDeterministicFilters`, `resolveEntityFilters`, `extractLojaMention`, `findLojaMentionInMessage`, `findPrestadorMentionInMessage`, `hasAnyFilter`, `buildTemporalReply`, `parseJsonObject`, os tipos `DocumentoCopilotRequest`, `LojaLookupRow`, `PrestadorLookupRow`, e a constante `MONTH_LABELS` — tudo isso só servia o fluxo antigo de uma chamada só (prompt com lista inteira de lojas/prestadores + JSON de intent) e é substituído pelo agente com ferramentas (Task 4/5).

Este arquivo continua sendo o dono da lógica de query/normalização/insights — o agente (Task 4) importa dessas funções, não duplica.

- [ ] **Step 1: Atualizar os imports do topo do arquivo**

Old:
```ts
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  buildDocumentosTextSearchOr,
  normalizeIds,
  safeParseDados,
  sanitizeId,
} from "@/lib/documentosApiUtils";
import { buildDocumentosAccessOr } from "@/lib/documentosAccessFilters";
import { callAzureOpenAiChat } from "@/lib/azureOpenAi";
import {
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
  hasDocumentosAccess,
  type GerenteAccessRow,
} from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { fixMojibakeText, normalizeDisplayData } from "@/lib/textEncoding";
```

New:
```ts
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  buildDocumentosTextSearchOr,
  normalizeIds,
  safeParseDados,
  sanitizeId,
} from "@/lib/documentosApiUtils";
import { buildDocumentosAccessOr } from "@/lib/documentosAccessFilters";
import type { GerenteAccessRow } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { fixMojibakeText, normalizeDisplayData } from "@/lib/textEncoding";
```

- [ ] **Step 2: Remover o tipo `DocumentoCopilotRequest`**

Delete este bloco (logo depois de `DocumentoCopilotResponse`):

```ts
export type DocumentoCopilotRequest = {
  message?: string;
  currentFilters?: DocumentoCopilotFilters;
};
```

- [ ] **Step 3: Remover os tipos `LojaLookupRow` e `PrestadorLookupRow`**

Delete este bloco (mantenha `EntityRow`, que continua em uso):

```ts
type LojaLookupRow = {
  id: string;
  nome: string | null;
  codigo: string | null;
};

type PrestadorLookupRow = {
  id: string;
  nome: string | null;
};
```

- [ ] **Step 4: Remover `MONTH_LABELS`**

Delete este bloco:

```ts
const MONTH_LABELS: Record<string, string> = {
  "01": "janeiro",
  "02": "fevereiro",
  "03": "março",
  "04": "abril",
  "05": "maio",
  "06": "junho",
  "07": "julho",
  "08": "agosto",
  "09": "setembro",
  "10": "outubro",
  "11": "novembro",
  "12": "dezembro",
};
```

- [ ] **Step 5: Remover `buildTemporalReply`**

Delete a função inteira (do `const buildTemporalReply = (input: {` até o `};` de fechamento, logo antes de `const buildTextSearchOr`).

- [ ] **Step 6: Remover `parseJsonObject` e `hasAnyFilter`**

Delete os dois blocos (ficam entre `buildTextSearchOr` e `stripKnownFilters`):

```ts
const parseJsonObject = <T,>(raw: string, fallback: T): T => {
  try {
    const parsed = JSON.parse(raw) as T;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    return fallback;
  }
  return fallback;
};

const hasAnyFilter = (filters: DocumentoCopilotFilters) =>
  Boolean(
    filters.termo ||
      filters.tipo ||
      filters.tipoLaudo ||
      filters.status ||
      filters.ano ||
      filters.mes ||
      filters.lojaId ||
      filters.prestadorId ||
      filters.somenteAssinados ||
      filters.somenteDisponiveisLote,
  );
```

- [ ] **Step 7: Exportar `stripKnownFilters`**

Change:
```ts
const stripKnownFilters = (filters: DocumentoCopilotFilters) => {
```
To:
```ts
export const stripKnownFilters = (filters: DocumentoCopilotFilters) => {
```

- [ ] **Step 8: Remover `extractLojaMention`, `findLojaMentionInMessage`, `findPrestadorMentionInMessage`, `applyDeterministicFilters`, `resolveEntityFilters`**

Delete o bloco inteiro entre o fim de `stripKnownFilters` e o início de `buildSearchSummary` — são estas 5 funções, nesta ordem, sem nada entre elas (verifique que o que sobra logo antes é `};` do fim de `stripKnownFilters` e logo depois é `const buildSearchSummary = ...`).

- [ ] **Step 9: Exportar `buildSearchSummary`**

Change:
```ts
const buildSearchSummary = (filters: DocumentoCopilotFilters) => {
```
To:
```ts
export const buildSearchSummary = (filters: DocumentoCopilotFilters) => {
```

- [ ] **Step 10: Remover `buildPrompt`**

Delete a função inteira (do `const buildPrompt = (input: {` até o `};` de fechamento, logo antes de `const buildDocumentoCandidatesQuery`).

- [ ] **Step 11: Exportar `queryDocumentoCandidates`**

Change:
```ts
const queryDocumentoCandidates = async (input: {
```
To:
```ts
export const queryDocumentoCandidates = async (input: {
```

- [ ] **Step 12: Exportar `createEmptyInsights`**

Change:
```ts
const createEmptyInsights = (): DocumentoCopilotInsights => ({
```
To:
```ts
export const createEmptyInsights = (): DocumentoCopilotInsights => ({
```

- [ ] **Step 13: Remover `runDocumentoCopilot`**

Delete a função inteira, do `export async function runDocumentoCopilot(` até o final do arquivo (é a última função do arquivo).

- [ ] **Step 14: Typecheck**

Run: `npx tsc --noEmit`
Expected: erro apenas em `src/app/api/documentos/copilot/route.ts` (ainda importa `runDocumentoCopilot`, que não existe mais) — isso é esperado e resolvido no Task 6. Nenhum outro erro deve aparecer.

- [ ] **Step 15: Commit**

```bash
git add src/lib/documentosCopilot.ts
git commit -m "refactor(copilot): remove fluxo de prompt unico, exporta pecas reaproveitaveis"
```

---

## Task 4: Loop do agente com `buscar_documentos`

**Files:**
- Create: `src/lib/documentosCopilotAgent.ts`
- Test: `src/lib/documentosCopilotAgent.test.ts`

**Interfaces:**
- Consumes: `callAzureOpenAiChat`, `AzureOpenAiChatMessage`, `AzureOpenAiTool`, `AzureOpenAiToolCall` (Task 1); `queryDocumentoCandidates`, `stripKnownFilters`, `buildSearchSummary`, `createEmptyInsights`, `DocumentoCopilotFilters`, `DocumentoCopilotMatch`, `DocumentoCopilotInsights`, `DocumentoCopilotResponse`, `DOCUMENTO_COPILOT_TYPES`, `DOCUMENTO_COPILOT_STATUS` (Task 3); `getAuthorizedPrestadorIds`, `getGerenteAccessEntries`, `hasDocumentosAccess`, `type GerenteAccessRow` de `@/lib/apiAuth`; `createSupabaseAdminClient` de `@/lib/supabaseAdminClient`.
- Produces: `DocumentoCopilotAgentMessage = { role: "user" | "assistant"; text: string }`, `DocumentoCopilotAgentRequest = { messages: DocumentoCopilotAgentMessage[]; currentFilters?: DocumentoCopilotFilters }`, `MAX_AGENT_TOOL_ITERATIONS = 5`, `runDocumentoCopilotAgent(request: DocumentoCopilotAgentRequest, auth: { userId: string; email: string | null }): Promise<DocumentoCopilotResponse>`.

Este task entrega o loop completo, mas com uma ferramenta só (`buscar_documentos`) — dá pra testar de ponta a ponta sem depender do Task 5. `buscar_lojas`/`buscar_prestadores` entram no Task 5.

- [ ] **Step 1: Escrever os testes (falhando)**

Crie `src/lib/documentosCopilotAgent.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/azureOpenAi", () => ({
  callAzureOpenAiChat: vi.fn(),
}));
vi.mock("@/lib/supabaseAdminClient", () => ({
  createSupabaseAdminClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/apiAuth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/apiAuth")>(
    "@/lib/apiAuth",
  );
  return {
    ...actual,
    getAuthorizedPrestadorIds: vi.fn(async () => []),
    getGerenteAccessEntries: vi.fn(async () => []),
    hasDocumentosAccess: vi.fn(async () => true),
  };
});
vi.mock("@/lib/documentosCopilotEntitySearch", () => ({
  buscarLojasPorNome: vi.fn(async () => []),
  buscarPrestadoresPorNome: vi.fn(async () => []),
}));
vi.mock("@/lib/documentosCopilot", async () => {
  const actual = await vi.importActual<typeof import("@/lib/documentosCopilot")>(
    "@/lib/documentosCopilot",
  );
  return {
    ...actual,
    queryDocumentoCandidates: vi.fn(),
  };
});

import { callAzureOpenAiChat } from "@/lib/azureOpenAi";
import { createEmptyInsights, queryDocumentoCandidates } from "@/lib/documentosCopilot";
import {
  MAX_AGENT_TOOL_ITERATIONS,
  runDocumentoCopilotAgent,
} from "@/lib/documentosCopilotAgent";

const mockedChat = vi.mocked(callAzureOpenAiChat);
const mockedQuery = vi.mocked(queryDocumentoCandidates);

const auth = { userId: "user-1", email: "user@empresa.com" };

beforeEach(() => {
  mockedChat.mockReset();
  mockedQuery.mockReset();
});

describe("runDocumentoCopilotAgent", () => {
  it("retorna a resposta do modelo direto quando ele nao chama nenhuma ferramenta", async () => {
    mockedChat.mockResolvedValueOnce({
      content: "Posso ajudar a buscar documentos. Me diga um detalhe.",
      toolCalls: [],
    });

    const result = await runDocumentoCopilotAgent(
      { messages: [{ role: "user", text: "oi" }] },
      auth,
    );

    expect(result.reply).toBe("Posso ajudar a buscar documentos. Me diga um detalhe.");
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.filters).toEqual({});
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(mockedChat).toHaveBeenCalledTimes(1);
  });

  it("executa buscar_documentos e devolve os resultados encontrados", async () => {
    mockedChat
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "buscar_documentos",
              arguments: JSON.stringify({ tipo: "notas_fiscais" }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({ content: "Encontrei 1 nota fiscal.", toolCalls: [] });

    mockedQuery.mockResolvedValueOnce({
      matches: [
        {
          id: "doc-1",
          tipo: "notas_fiscais",
          status: "pendente",
          created_at: "2026-01-01T00:00:00.000Z",
          nome: "nf1.pdf",
          identificacao: "123",
          complemento: null,
          lojaId: null,
          lojaNome: null,
          prestadorId: null,
          prestadorNome: null,
          tipoLaudo: null,
          observacoes: null,
        },
      ],
      total: 1,
      insights: createEmptyInsights(),
    });

    const result = await runDocumentoCopilotAgent(
      { messages: [{ role: "user", text: "notas fiscais" }] },
      auth,
    );

    expect(result.reply).toBe("Encontrei 1 nota fiscal.");
    expect(result.results).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0][0].filters.tipo).toBe("notas_fiscais");
  });

  it("corta no maximo de iteracoes e ainda devolve o ultimo resultado de busca", async () => {
    mockedChat.mockImplementation(async () => ({
      content: null,
      toolCalls: [
        {
          id: "call-loop",
          type: "function",
          function: { name: "buscar_documentos", arguments: "{}" },
        },
      ],
    }));

    mockedQuery.mockResolvedValue({
      matches: [],
      total: 0,
      insights: createEmptyInsights(),
    });

    const result = await runDocumentoCopilotAgent(
      { messages: [{ role: "user", text: "documentos" }] },
      auth,
    );

    expect(mockedChat).toHaveBeenCalledTimes(MAX_AGENT_TOOL_ITERATIONS);
    expect(result.reply).toContain("Não encontrei documentos");
    expect(result.total).toBe(0);
  });

  it("manda o historico da conversa (ate 10 turnos) para o modelo", async () => {
    mockedChat.mockResolvedValueOnce({ content: "ok", toolCalls: [] });

    const messages = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as const,
      text: `mensagem ${i}`,
    }));

    await runDocumentoCopilotAgent({ messages }, auth);

    const sentMessages = mockedChat.mock.calls[0][0].messages;
    const nonSystemMessages = sentMessages.filter((m) => m.role !== "system");
    expect(nonSystemMessages).toHaveLength(10);
    expect(nonSystemMessages[0]).toMatchObject({ content: "mensagem 2" });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/documentosCopilotAgent.test.ts`
Expected: FAIL com "Cannot find module '@/lib/documentosCopilotAgent'"

- [ ] **Step 3: Criar `src/lib/documentosCopilotAgent.ts`**

```ts
import {
  type AzureOpenAiChatMessage,
  type AzureOpenAiTool,
  type AzureOpenAiToolCall,
  callAzureOpenAiChat,
} from "@/lib/azureOpenAi";
import {
  DOCUMENTO_COPILOT_STATUS,
  DOCUMENTO_COPILOT_TYPES,
  buildSearchSummary,
  createEmptyInsights,
  queryDocumentoCandidates,
  stripKnownFilters,
  type DocumentoCopilotFilters,
  type DocumentoCopilotInsights,
  type DocumentoCopilotMatch,
  type DocumentoCopilotResponse,
} from "@/lib/documentosCopilot";
import {
  buscarLojasPorNome,
  buscarPrestadoresPorNome,
} from "@/lib/documentosCopilotEntitySearch";
import {
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
  hasDocumentosAccess,
  type GerenteAccessRow,
} from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

export type DocumentoCopilotAgentMessage = {
  role: "user" | "assistant";
  text: string;
};

export type DocumentoCopilotAgentRequest = {
  messages: DocumentoCopilotAgentMessage[];
  currentFilters?: DocumentoCopilotFilters;
};

export const MAX_AGENT_TOOL_ITERATIONS = 5;
const MAX_HISTORY_MESSAGES = 10;

const AGENT_TOOLS: AzureOpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "buscar_documentos",
      description:
        "Busca documentos no sistema aplicando os filtros informados. Use depois de resolver lojaId/prestadorId com buscar_lojas/buscar_prestadores quando o usuario mencionar uma loja ou prestador.",
      parameters: {
        type: "object",
        properties: {
          termo: { type: "string", description: "Trecho de texto livre (nome, numero de documento, etc.)" },
          tipo: { type: "string", enum: Object.keys(DOCUMENTO_COPILOT_TYPES) },
          status: { type: "string", enum: [...DOCUMENTO_COPILOT_STATUS] },
          tipoLaudo: { type: "string", description: "Tipo de laudo, quando mencionado" },
          ano: { type: "string", description: "Ano no formato AAAA" },
          mes: { type: "string", description: "Mes no formato MM (01-12)" },
          lojaId: { type: "string", description: "ID exato da loja, obtido via buscar_lojas" },
          prestadorId: { type: "string", description: "ID exato do prestador, obtido via buscar_prestadores" },
          somenteAssinados: { type: "boolean" },
          somenteDisponiveisLote: { type: "boolean" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_lojas",
      description:
        "Procura lojas por nome ou codigo parecido com o termo informado. Use quando o usuario mencionar uma loja por nome, apelido ou codigo parcial.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termo de busca (nome ou codigo parcial da loja)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_prestadores",
      description:
        "Procura prestadores por nome parecido com o termo informado. Use quando o usuario mencionar um prestador por nome ou apelido.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termo de busca (nome parcial do prestador)" },
        },
        required: ["query"],
      },
    },
  },
];

const buildSystemPrompt = (currentFilters?: DocumentoCopilotFilters) => {
  const filtrosAtuais = currentFilters ? stripKnownFilters(currentFilters) : {};
  const partes = [
    "Você é um copiloto interno para encontrar documentos em um sistema corporativo.",
    "Você tem ferramentas: buscar_documentos, buscar_lojas e buscar_prestadores. Use quantas precisar, na ordem que fizer sentido, antes de responder.",
    "Se o usuário mencionar uma loja ou prestador por nome, apelido ou código (mesmo parcial), chame buscar_lojas ou buscar_prestadores primeiro para descobrir o ID exato — nunca invente um ID.",
    "Se buscar_lojas ou buscar_prestadores devolver mais de um resultado plausível e a pergunta não deixar claro qual é, pergunte ao usuário qual deles antes de chamar buscar_documentos.",
    "Nunca invente documentos, IDs ou dados fora do que as ferramentas devolveram. Nunca proponha executar uma ação (aplicar filtro, abrir documento, assinar) — você só busca e explica; quem decide agir é o usuário.",
    "Responda sempre em português do Brasil, de forma curta e direta, citando números relevantes (total encontrado, por exemplo) quando fizer sentido.",
    `Valores válidos de tipo: ${Object.keys(DOCUMENTO_COPILOT_TYPES).join(", ")}.`,
    `Valores válidos de status: ${DOCUMENTO_COPILOT_STATUS.join(", ")}.`,
  ];
  if (Object.keys(filtrosAtuais).length > 0) {
    partes.push(
      `A tela do usuário já está com estes filtros aplicados (contexto, não obrigação de usar): ${JSON.stringify(filtrosAtuais)}.`,
    );
  }
  return partes.join(" ");
};

type AgentContext = {
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
  userId: string;
  allowedPrestadores: string[];
  gerenteEntries: GerenteAccessRow[];
  canAccess: boolean;
};

type SearchOutcome = {
  filters: DocumentoCopilotFilters;
  matches: DocumentoCopilotMatch[];
  total: number;
  insights: DocumentoCopilotInsights;
};

const parseToolArguments = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

async function executeToolCall(
  toolCall: AzureOpenAiToolCall,
  ctx: AgentContext,
): Promise<{ content: string; searchOutcome?: SearchOutcome }> {
  const args = parseToolArguments(toolCall.function.arguments);

  if (toolCall.function.name === "buscar_documentos") {
    const filters = stripKnownFilters(args as DocumentoCopilotFilters);
    const { matches, total, insights } = await queryDocumentoCandidates({
      filters,
      userId: ctx.userId,
      allowedPrestadores: ctx.allowedPrestadores,
      gerenteEntries: ctx.gerenteEntries,
      canAccess: ctx.canAccess,
      supabaseAdmin: ctx.supabaseAdmin,
    });
    const resumoParaModelo = {
      total,
      amostra: matches.slice(0, 5).map((match) => ({
        id: match.id,
        tipo: match.tipo,
        status: match.status,
        identificacao: match.identificacao,
        lojaNome: match.lojaNome,
        prestadorNome: match.prestadorNome,
        created_at: match.created_at,
      })),
      porStatus: insights.porStatus,
      porLoja: insights.porLoja,
    };
    return {
      content: JSON.stringify(resumoParaModelo),
      searchOutcome: { filters, matches, total, insights },
    };
  }

  if (toolCall.function.name === "buscar_lojas") {
    const query = typeof args.query === "string" ? args.query : "";
    const lojas = await buscarLojasPorNome(query, ctx.supabaseAdmin);
    return { content: JSON.stringify({ lojas }) };
  }

  if (toolCall.function.name === "buscar_prestadores") {
    const query = typeof args.query === "string" ? args.query : "";
    const prestadores = await buscarPrestadoresPorNome(query, ctx.supabaseAdmin);
    return { content: JSON.stringify({ prestadores }) };
  }

  return {
    content: JSON.stringify({ erro: `Ferramenta desconhecida: ${toolCall.function.name}` }),
  };
}

export async function runDocumentoCopilotAgent(
  request: DocumentoCopilotAgentRequest,
  auth: { userId: string; email: string | null },
): Promise<DocumentoCopilotResponse> {
  const supabaseAdmin = createSupabaseAdminClient();
  const allowedPrestadores = await getAuthorizedPrestadorIds(auth.email, supabaseAdmin);
  const gerenteEntries = await getGerenteAccessEntries(auth.userId, auth.email, supabaseAdmin);
  const canAccess = await hasDocumentosAccess(auth.userId, auth.email, supabaseAdmin);

  const ctx: AgentContext = {
    supabaseAdmin,
    userId: auth.userId,
    allowedPrestadores,
    gerenteEntries,
    canAccess,
  };

  const history = request.messages.slice(-MAX_HISTORY_MESSAGES);
  const messages: AzureOpenAiChatMessage[] = [
    { role: "system", content: buildSystemPrompt(request.currentFilters) },
    ...history.map(
      (turn): AzureOpenAiChatMessage => ({ role: turn.role, content: turn.text }),
    ),
  ];

  let lastOutcome: SearchOutcome | null = null;
  let finalReply: string | null = null;

  for (let iteration = 0; iteration < MAX_AGENT_TOOL_ITERATIONS; iteration += 1) {
    const result = await callAzureOpenAiChat({
      messages,
      maxTokens: 700,
      tools: AGENT_TOOLS,
    });

    if (result.toolCalls.length === 0) {
      finalReply = result.content?.trim() || null;
      break;
    }

    messages.push({
      role: "assistant",
      content: result.content,
      tool_calls: result.toolCalls,
    });

    for (const toolCall of result.toolCalls) {
      const { content, searchOutcome } = await executeToolCall(toolCall, ctx);
      if (searchOutcome) {
        lastOutcome = searchOutcome;
      }
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content,
      });
    }
  }

  const filters = lastOutcome?.filters ?? {};
  const reply =
    finalReply ||
    (lastOutcome
      ? lastOutcome.matches.length > 0
        ? `Encontrei ${lastOutcome.matches.length} documento(s) que parecem corresponder à sua busca.`
        : "Não encontrei documentos com esses critérios. Posso ajustar a busca se você me disser mais um detalhe."
      : "Posso procurar por tipo, status, loja, prestador, mês ou um trecho do nome do documento. Me diga um detalhe a mais.");

  return {
    reply,
    summary: buildSearchSummary(filters),
    filters,
    results: lastOutcome?.matches ?? [],
    total: lastOutcome?.total ?? 0,
    insights: lastOutcome?.insights ?? createEmptyInsights(),
  } satisfies DocumentoCopilotResponse;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/documentosCopilotAgent.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: mesmo único erro esperado em `route.ts` (ainda não ajustado — Task 6).

- [ ] **Step 6: Commit**

```bash
git add src/lib/documentosCopilotAgent.ts src/lib/documentosCopilotAgent.test.ts
git commit -m "feat(copilot): loop de agente com tool-calling e busca de documentos"
```

---

## Task 5: Ligar `buscar_lojas`/`buscar_prestadores` ao loop

**Files:**
- Modify: `src/lib/documentosCopilotAgent.test.ts`

O dispatch de `buscar_lojas`/`buscar_prestadores` já foi escrito no Task 4 (dentro de `executeToolCall`) porque é mais simples implementar as 3 ferramentas juntas do que fatiar a função no meio. Este task garante que o comportamento composto — resolver a loja por nome parcial e SÓ DEPOIS buscar documentos com o id certo — está coberto por teste (é exatamente o cenário do bug original: "loja avenida").

- [ ] **Step 1: Adicionar os testes (falhando)**

No topo de `src/lib/documentosCopilotAgent.test.ts`, troque o import de `documentosCopilotEntitySearch` mockado para capturar as funções mockadas:

Old:
```ts
vi.mock("@/lib/documentosCopilotEntitySearch", () => ({
  buscarLojasPorNome: vi.fn(async () => []),
  buscarPrestadoresPorNome: vi.fn(async () => []),
}));
```

New:
```ts
vi.mock("@/lib/documentosCopilotEntitySearch", () => ({
  buscarLojasPorNome: vi.fn(async () => []),
  buscarPrestadoresPorNome: vi.fn(async () => []),
}));
```

(mantém igual — só garanta que o import abaixo também traga as funções mockadas)

Depois do bloco `import { callAzureOpenAiChat } from "@/lib/azureOpenAi";`, adicione:

```ts
import {
  buscarLojasPorNome,
  buscarPrestadoresPorNome,
} from "@/lib/documentosCopilotEntitySearch";

const mockedBuscarLojas = vi.mocked(buscarLojasPorNome);
const mockedBuscarPrestadores = vi.mocked(buscarPrestadoresPorNome);
```

E no `beforeEach`, adicione as duas linhas de reset:

Old:
```ts
beforeEach(() => {
  mockedChat.mockReset();
  mockedQuery.mockReset();
});
```

New:
```ts
beforeEach(() => {
  mockedChat.mockReset();
  mockedQuery.mockReset();
  mockedBuscarLojas.mockReset();
  mockedBuscarPrestadores.mockReset();
});
```

Ao final do `describe("runDocumentoCopilotAgent", ...)`, adicione os dois testes:

```ts
  it("resolve a loja por nome parcial antes de buscar documentos", async () => {
    mockedChat
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "buscar_lojas", arguments: JSON.stringify({ query: "avenida" }) },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: "call-2",
            type: "function",
            function: {
              name: "buscar_documentos",
              arguments: JSON.stringify({ lojaId: "loja-302" }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({ content: "Encontrei os documentos da loja Avenida.", toolCalls: [] });

    mockedBuscarLojas.mockResolvedValueOnce([
      { id: "loja-302", nome: "302 - Avenida Paulista", codigo: "302" },
    ]);
    mockedQuery.mockResolvedValueOnce({ matches: [], total: 0, insights: createEmptyInsights() });

    const result = await runDocumentoCopilotAgent(
      { messages: [{ role: "user", text: "notas fiscais da loja avenida" }] },
      auth,
    );

    expect(mockedBuscarLojas).toHaveBeenCalledWith("avenida", expect.anything());
    expect(mockedQuery.mock.calls[0][0].filters.lojaId).toBe("loja-302");
    expect(result.reply).toBe("Encontrei os documentos da loja Avenida.");
  });

  it("resolve o prestador por nome parcial quando a ferramenta e chamada", async () => {
    mockedChat
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "buscar_prestadores", arguments: JSON.stringify({ query: "dinamica" }) },
          },
        ],
      })
      .mockResolvedValueOnce({ content: "Achei o prestador Dinâmica Serviços.", toolCalls: [] });

    mockedBuscarPrestadores.mockResolvedValueOnce([
      { id: "prestador-1", nome: "Dinâmica Serviços" },
    ]);

    const result = await runDocumentoCopilotAgent(
      { messages: [{ role: "user", text: "documentos do prestador dinamica" }] },
      auth,
    );

    expect(mockedBuscarPrestadores).toHaveBeenCalledWith("dinamica", expect.anything());
    expect(result.reply).toBe("Achei o prestador Dinâmica Serviços.");
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/documentosCopilotAgent.test.ts`
Expected: PASS (6 testes) — o dispatch já existia desde o Task 4, então isso confirma o comportamento composto sem precisar mudar `documentosCopilotAgent.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/documentosCopilotAgent.test.ts
git commit -m "test(copilot): cobre resolucao de loja/prestador por nome antes da busca"
```

---

## Task 6: Endpoint aceita histórico de conversa

**Files:**
- Modify: `src/app/api/documentos/copilot/route.ts`

**Interfaces:**
- Consumes: `runDocumentoCopilotAgent`, `type DocumentoCopilotAgentMessage` de `@/lib/documentosCopilotAgent` (Task 4); `type DocumentoCopilotFilters` de `@/lib/documentosCopilot`.

- [ ] **Step 1: Reescrever `src/app/api/documentos/copilot/route.ts`**

```ts
import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import {
  runDocumentoCopilotAgent,
  type DocumentoCopilotAgentMessage,
} from "@/lib/documentosCopilotAgent";
import type { DocumentoCopilotFilters } from "@/lib/documentosCopilot";

export async function POST(request: Request) {
  try {
    const actor = await getActorFromRequest(request);
    const body = (await request.json().catch(() => ({}))) as {
      messages?: { role?: string; text?: string }[];
      currentFilters?: DocumentoCopilotFilters;
    };

    const messages: DocumentoCopilotAgentMessage[] = Array.isArray(body.messages)
      ? body.messages
          .filter(
            (item): item is { role: "user" | "assistant"; text: string } =>
              (item?.role === "user" || item?.role === "assistant") &&
              typeof item?.text === "string" &&
              item.text.trim().length > 0,
          )
          .map((item) => ({ role: item.role, text: item.text.trim() }))
      : [];

    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      throw new HttpError(400, "Informe uma pergunta para o copilot.");
    }

    const payload = await runDocumentoCopilotAgent(
      {
        messages,
        currentFilters: body.currentFilters,
      },
      {
        userId: actor.userId,
        email: actor.email,
      },
    );

    return NextResponse.json(payload);
  } catch (err) {
    console.error("Erro no copilot de documentos:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível consultar o copilot de documentos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros em nenhum arquivo do copiloto. O único erro esperado agora é dentro de `src/app/documentos/_components/DocumentosCopilot.tsx`, que ainda manda `{ message, currentFilters }` em vez de `{ messages, currentFilters }` — resolvido no Task 7.

- [ ] **Step 3: Rodar a suíte inteira de testes**

Run: `npx vitest run`
Expected: PASS em todos os arquivos (incluindo os pré-existentes, sem regressão).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/documentos/copilot/route.ts
git commit -m "feat(copilot): endpoint aceita historico de conversa"
```

---

## Task 7: Tela vira chat com histórico

**Files:**
- Modify: `src/app/documentos/_components/DocumentosCopilot.tsx`

**Interfaces:**
- Consumes: `runDocumentoCopilotAgent` via `POST /api/documentos/copilot` com body `{ messages: { role: "user" | "assistant"; text: string }[]; currentFilters: DocumentoCopilotFilters }`, resposta `DocumentoCopilotResponse` (Task 6).

- [ ] **Step 1: Reescrever `src/app/documentos/_components/DocumentosCopilot.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, LoaderCircle, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import type {
  DocumentoCopilotFilters,
  DocumentoCopilotInsights,
  DocumentoCopilotMatch,
} from "@/lib/documentosCopilot";

export type DocumentosCopilotProps = {
  currentFilters: DocumentoCopilotFilters;
};

type CopilotApiResponse = {
  reply: string;
  summary: string;
  filters: DocumentoCopilotFilters;
  results: DocumentoCopilotMatch[];
  total: number;
  insights: DocumentoCopilotInsights;
  error?: string;
};

type ChatTurn =
  | { id: string; role: "user"; text: string }
  | ({ id: string; role: "assistant" } & CopilotApiResponse);

const MAX_HISTORY_TURNS = 10;

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

const filterLabels: Record<keyof DocumentoCopilotFilters, string> = {
  termo: "Busca",
  tipo: "Tipo",
  tipoLaudo: "Tipo de laudo",
  status: "Status",
  ano: "Ano",
  mes: "Mês",
  lojaId: "Loja",
  prestadorId: "Prestador",
  somenteAssinados: "Assinados",
  somenteDisponiveisLote: "Lote",
};

const tipoLabels: Record<string, string> = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
  contratos: "Contratos",
  orcamentos: "Orçamentos",
};

const statusLabels: Record<string, string> = {
  pendente: "Pendente",
  em_analise: "Em análise",
  revisado: "Revisado",
  assinado: "Assinado",
};

const buildFilterChips = (filters: DocumentoCopilotFilters) => {
  return (Object.entries(filters) as [keyof DocumentoCopilotFilters, unknown][])
    .filter(([, value]) => {
      if (typeof value === "boolean") {
        return value;
      }
      return typeof value === "string" && value.trim().length > 0;
    })
    .map(([key, value]) => {
      let display = String(value);
      if (key === "tipo" && typeof value === "string") {
        display = tipoLabels[value] ?? value;
      }
      if (key === "status" && typeof value === "string") {
        display = statusLabels[value] ?? value;
      }
      if (typeof value === "boolean") {
        display =
          key === "somenteDisponiveisLote"
            ? "Disponíveis para lote"
            : "Somente assinados";
      }
      return {
        key,
        label: filterLabels[key] ?? key,
        value: display,
      };
    });
};

const buildDocumentosUrl = (filters: DocumentoCopilotFilters) => {
  const params = new URLSearchParams();
  const appendString = (key: string, value?: string) => {
    if (value?.trim()) {
      params.set(key, value.trim());
    }
  };

  appendString("identificacao", filters.termo);
  appendString("tipo", filters.tipo);
  appendString("tipoLaudo", filters.tipoLaudo);
  appendString("status", filters.status);
  appendString("ano", filters.ano);
  appendString("mes", filters.mes);
  appendString("lojaId", filters.lojaId);
  appendString("prestadorId", filters.prestadorId);
  if (filters.somenteAssinados) {
    params.set("somenteAssinados", "true");
  }
  if (filters.somenteDisponiveisLote) {
    params.set("somenteDisponiveisLote", "true");
  }
  params.set("source", "copilot");

  return `/documentos?${params.toString()}`;
};

function AssistantTurnCard({
  turn,
  onApplyFilters,
  onOpenDocumento,
}: {
  turn: Extract<ChatTurn, { role: "assistant" }>;
  onApplyFilters: (filters: DocumentoCopilotFilters) => void;
  onOpenDocumento: (id: string) => void;
}) {
  const insights = turn.insights;
  const maxStatus = Math.max(...(insights.porStatus.map((item) => item.total) ?? [0]), 1);
  const maxLoja = Math.max(...(insights.porLoja.map((item) => item.total) ?? [0]), 1);
  const maxTrend = Math.max(...(insights.tendenciaMensal.map((item) => item.total) ?? [0]), 1);
  const appliedFilterChips = buildFilterChips(turn.filters);

  return (
    <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Resposta
        </p>
        <p className="text-sm text-slate-100">{turn.reply}</p>
        <p className="text-xs leading-5 text-slate-300">{turn.summary}</p>
      </div>

      {appliedFilterChips.length > 0 && (
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-100">
                Filtros detectados
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {appliedFilterChips.map((chip) => (
                  <span
                    key={chip.key}
                    className="rounded-full border border-cyan-300/20 bg-slate-950/40 px-3 py-1 text-[11px] font-semibold text-cyan-50"
                  >
                    {chip.label}: {chip.value}
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onApplyFilters(turn.filters)}
              className="shrink-0 rounded-full bg-cyan-300 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200"
            >
              Aplicar na tela de documentos
            </button>
          </div>
        </div>
      )}

      {insights.totalDocumentos > 0 && (
        <div className="space-y-4 rounded-3xl border border-white/10 bg-slate-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Leitura rápida
              </p>
              <p className="text-[11px] text-slate-400">
                O copilot resumiu o cenário com base nos documentos encontrados.
              </p>
            </div>
            {insights.isTruncated && (
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold text-amber-100">
                Análise parcial
              </span>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">
                Documentos
              </p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {insights.totalDocumentos}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">
                Lojas
              </p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {insights.totalLojas}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">
                Pendentes
              </p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {insights.totalPendentes}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">
                Assinados
              </p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {insights.totalAssinados}
              </p>
            </div>
          </div>

          {insights.observacoes.length > 0 && (
            <div className="space-y-2 rounded-2xl border border-cyan-400/10 bg-cyan-400/5 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-100">
                Análise
              </p>
              <div className="space-y-1 text-sm text-slate-100">
                {insights.observacoes.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Por status
                </p>
                <p className="text-[11px] text-slate-500">
                  Distribuição do conjunto analisado
                </p>
              </div>
              <div className="mt-3 space-y-3">
                {insights.porStatus.map((item) => (
                  <div key={item.key}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-200">{item.label}</span>
                      <span className="font-semibold text-white">
                        {item.total} ({formatPercent(item.percentual)})
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-cyan-400"
                        style={{
                          width: `${Math.max((item.total / maxStatus) * 100, 6)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Por loja
                </p>
                <p className="text-[11px] text-slate-500">
                  Top 5 lojas mais recorrentes
                </p>
              </div>
              <div className="mt-3 space-y-3">
                {insights.porLoja.map((item) => (
                  <div key={item.key}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-slate-200">
                        {item.label}
                      </span>
                      <span className="shrink-0 font-semibold text-white">
                        {item.total}
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-emerald-400"
                        style={{
                          width: `${Math.max((item.total / maxLoja) * 100, 6)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {insights.tendenciaMensal.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Documentos por mês
                </p>
                <p className="text-[11px] text-slate-500">
                  Volume total em cada mês observado
                </p>
              </div>
              <div className="mt-4 flex items-end gap-2">
                {insights.tendenciaMensal.map((item) => (
                  <div key={item.key} className="flex-1 text-center">
                    <div className="flex h-24 items-end">
                      <div
                        className="w-full rounded-t-xl bg-sky-400/80"
                        style={{
                          height: `${Math.max((item.total / maxTrend) * 100, 6)}%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {item.label}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {item.total} docs
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Resultados
          </p>
          <p className="text-[11px] text-slate-500">
            {turn.results.length} encontrado(s)
          </p>
        </div>
        {turn.results.length > 0 ? (
          turn.results.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  {item.nome}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {item.identificacao}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenDocumento(item.id)}
                className="shrink-0 rounded-full border border-white/15 px-3 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-white/5"
              >
                Abrir
              </button>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-white/15 px-4 py-6 text-sm text-slate-300">
            Nenhum documento encontrado com essa busca.
          </div>
        )}
      </div>
    </div>
  );
}

export function DocumentosCopilot({ currentFilters }: DocumentosCopilotProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAccessToken = async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }
    const token = data.session?.access_token;
    if (!token) {
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    return token;
  };

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const userTurn: ChatTurn = { id: crypto.randomUUID(), role: "user", text: trimmed };
    const historyForRequest = [...turns, userTurn]
      .slice(-MAX_HISTORY_TURNS)
      .map((turn) => ({
        role: turn.role,
        text: turn.role === "user" ? turn.text : turn.reply,
      }));

    setTurns((prev) => [...prev, userTurn]);
    setMessage("");
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const res = await fetch("/api/documentos/copilot", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: historyForRequest,
          currentFilters,
        }),
      });

      const payload = (await res.json()) as CopilotApiResponse;
      if (!res.ok) {
        throw new Error(
          payload.error ?? "Não foi possível consultar o copilot.",
        );
      }

      setTurns((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", ...payload },
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível consultar o copilot.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFilters = (filters: DocumentoCopilotFilters) => {
    router.push(buildDocumentosUrl(filters));
  };

  const handleOpenDocumento = (id: string) => {
    router.push(`/documentos/${id}`);
  };

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,31,0.98),rgba(11,18,34,0.94))] text-white shadow-[0_22px_60px_rgba(2,6,23,0.45)]">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
          <Bot className="h-3.5 w-3.5" />
          Copiloto de documentos
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        {turns.length > 0 && (
          <div className="space-y-4">
            {turns.map((turn) =>
              turn.role === "user" ? (
                <div
                  key={turn.id}
                  className="ml-auto max-w-[85%] rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100"
                >
                  {turn.text}
                </div>
              ) : (
                <AssistantTurnCard
                  key={turn.id}
                  turn={turn}
                  onApplyFilters={handleApplyFilters}
                  onOpenDocumento={handleOpenDocumento}
                />
              ),
            )}
          </div>
        )}

        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Pergunta
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ex.: encontre as notas fiscais da loja 302 de março"
            className="mt-2 min-h-32 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void submit(message)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {loading ? "Buscando..." : "Perguntar ao copilot"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMessage("");
              setTurns([]);
              setError(null);
            }}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/5"
          >
            Nova conversa
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros em nenhum arquivo.

- [ ] **Step 3: Rodar a suíte inteira de testes**

Run: `npx vitest run`
Expected: PASS em todos os arquivos.

- [ ] **Step 4: Commit**

```bash
git add src/app/documentos/_components/DocumentosCopilot.tsx
git commit -m "feat(copilot): tela vira chat com historico de conversa"
```

---

## Task 8: Verificação manual ponta a ponta

**Files:** nenhum (só execução)

- [ ] **Step 1: Subir o servidor de desenvolvimento**

Run: `npm run dev` (em background)

- [ ] **Step 2: Cenário 1 — loja com nome parcial ambíguo**

Abra `/documentos`, no painel do copiloto pergunte algo que bata com mais de uma loja por um termo curto (ex: um termo que aparece em duas lojas reais da base). Esperado: o agente responde pedindo para especificar qual loja, sem trazer documentos de todas.

- [ ] **Step 3: Cenário 2 — loja com nome parcial não ambíguo (regressão do bug original)**

Pergunte "notas fiscais mais recentes da loja avenida" (ou o nome real de uma loja da base). Esperado: a lista de resultados contém **só** documentos daquela loja — confirma que o fix de `documentosCopilot.ts` (filtro de loja aplicado de verdade na query) continua funcionando dentro do novo fluxo de agente.

- [ ] **Step 4: Cenário 3 — pergunta de acompanhamento usando o histórico**

Depois da resposta do cenário 2, pergunte "e quantas estão pendentes?" sem repetir o nome da loja. Esperado: o agente entende que a pergunta é sobre a mesma loja (usa o histórico da conversa) e responde com o recorte certo.

- [ ] **Step 5: Cenário 4 — "Nova conversa"**

Clique em "Nova conversa" e confirme que a tela zera (sem mensagens antigas) e uma nova pergunta funciona normalmente, sem herdar contexto da conversa anterior.

- [ ] **Step 6: Rodar typecheck e suíte de testes uma última vez**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS em tudo.
