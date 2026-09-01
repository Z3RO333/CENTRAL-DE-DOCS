# Assistente virtual — Fase 1: Infraestrutura Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalizar o copiloto de documentos hard-coded em um agente multi-domínio (`assistenteAgent`), migrar o domínio "documentos" para essa base sem mudar sua regra de negócio, adicionar memória persistente por usuário, e substituir o card embutido/página dedicada por um widget flutuante disponível em todo o app.

**Architecture:** Um core genérico (`assistenteAgent.ts`) roda o loop de tool-calling contra o Azure OpenAI e despacha cada `tool_call` para o domínio dono daquela ferramenta, via um registro de domínios (`AssistenteDominio[]`). O domínio "documentos" é portado de `documentosCopilotAgent.ts`/`documentosCopilot.ts` sem alterar sua lógica de acesso ou query — só a forma muda (interface `AssistenteDominio`). A conversa persiste em uma tabela nova (`assistente_conversas`, uma linha por usuário). Um widget React novo (`AssistenteWidget.tsx`), montado no `AppShell`, substitui a página `/copilot` e o card `DocumentosCopilot.tsx`.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + `@supabase/supabase-js`), Azure OpenAI (function calling via `callAzureOpenAiChat`), Vitest, Tailwind CSS, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-01-assistente-virtual-global-design.md` (seção "Fase 1 — Infraestrutura")

## Global Constraints

- Nenhuma regra de negócio do domínio documentos muda (mesmos filtros, mesma query, mesmo controle de acesso) — só a forma migra para a interface `AssistenteDominio`.
- O agente nunca executa ações que alterem estado — só busca e explica (regra reforçada no prompt compartilhado).
- Histórico de conversa persiste só texto (`role`, `text`, `dominio?`, `criado_em`) — nunca `results`/`insights`/`filters` daquele turno.
- Mantém `MAX_AGENT_TOOL_ITERATIONS = 5` e `MAX_HISTORY_MESSAGES = 10` (mesmos valores de hoje).
- Testes de lib seguem o padrão Vitest existente (`environment: "node"`, mocks via `vi.mock`); não há testes automatizados de componente React neste repo — mudanças de UI são verificadas manualmente com o dev server.

---

### Task 1: Migração — tabela `assistente_conversas`

**Files:**
- Create: `supabase/migrations/202609011000_create_assistente_conversas.sql`

**Interfaces:**
- Produces: tabela `assistente_conversas(id, user_id, mensagens jsonb, atualizado_em, criado_em)`, usada por `assistenteConversas.ts` (Task 3).

- [ ] **Step 1: Escrever a migração**

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

- [ ] **Step 2: Aplicar a migração no ambiente local**

Run: `supabase db push` (ou o comando que o projeto já usa para aplicar migrações — confira `package.json`/README se houver script dedicado).
Expected: migração aplicada sem erro; `select * from assistente_conversas limit 1;` roda sem erro (tabela vazia).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202609011000_create_assistente_conversas.sql
git commit -m "feat: cria tabela assistente_conversas para memoria persistente do assistente"
```

---

### Task 2: Tipos compartilhados e insights genéricos

**Files:**
- Create: `src/lib/assistenteTypes.ts`
- Create: `src/lib/assistenteInsights.ts`
- Test: `src/lib/assistenteInsights.test.ts`

**Interfaces:**
- Produces:
  - `AssistenteDominioId = "documentos" | "orcamentos" | "cobrancas"`
  - `AssistenteContext { supabaseAdmin, userId, email, isAdmin, currentContext?, cache }`
  - `AssistenteInsightItem { key, label, total, percentual }`
  - `AssistenteTrendItem { key, label, total }`
  - `AssistenteInsights { totais: {key,label,valor}[], isTruncated, porStatus, porLoja, tendenciaMensal, observacoes }`
  - `AssistenteResultItem { id, titulo, subtitulo, url?, abrirArquivoPath? }`
  - `AssistenteSearchOutcome { dominio, filters, filtrosUrl, summary, results, total, insights }`
  - `AssistenteToolResult { content, outcome? }`
  - `AssistenteDominio { id, descricaoPrompt, tools, podeAcessar, executarTool }`
  - `buildInsightItems<T>(rows, getKey, getLabel, totalBase, limit?)`, `buildTrendItems<T>(rows, getDate, limit?)`

- [ ] **Step 1: Criar `assistenteTypes.ts`**

```ts
import type { AzureOpenAiTool } from "@/lib/azureOpenAi";
import type { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

export type AssistenteDominioId = "documentos" | "orcamentos" | "cobrancas";

export type AssistenteContext = {
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
  userId: string;
  email: string | null;
  isAdmin: boolean;
  currentContext?: { dominio: AssistenteDominioId; filtros: Record<string, unknown> };
  /** memo por turno para evitar recomputar acesso a cada tool_call */
  cache: Map<string, unknown>;
};

export type AssistenteInsightItem = {
  key: string;
  label: string;
  total: number;
  percentual: number;
};

export type AssistenteTrendItem = {
  key: string;
  label: string;
  total: number;
};

export type AssistenteInsightTotal = {
  key: string;
  label: string;
  valor: number;
};

export type AssistenteInsights = {
  totais: AssistenteInsightTotal[];
  isTruncated: boolean;
  porStatus: AssistenteInsightItem[];
  porLoja: AssistenteInsightItem[];
  tendenciaMensal: AssistenteTrendItem[];
  observacoes: string[];
};

export type AssistenteResultItem = {
  id: string;
  titulo: string;
  subtitulo: string;
  /** rota para abrir o item na tela do domínio, quando aplicável */
  url?: string | null;
  /** path de storage para abrir o arquivo assinado direto, quando aplicável */
  abrirArquivoPath?: string | null;
};

export type AssistenteSearchOutcome = {
  dominio: AssistenteDominioId;
  filters: Record<string, unknown>;
  filtrosUrl: string | null;
  summary: string;
  results: AssistenteResultItem[];
  total: number;
  insights: AssistenteInsights;
};

export type AssistenteToolResult = {
  content: string;
  outcome?: AssistenteSearchOutcome;
};

export type AssistenteDominio = {
  id: AssistenteDominioId;
  descricaoPrompt: (ctx: AssistenteContext) => string;
  tools: AzureOpenAiTool[];
  podeAcessar: (ctx: AssistenteContext) => Promise<boolean>;
  executarTool: (
    nome: string,
    args: Record<string, unknown>,
    ctx: AssistenteContext,
  ) => Promise<AssistenteToolResult>;
};

export const createEmptyAssistenteInsights = (): AssistenteInsights => ({
  totais: [],
  isTruncated: false,
  porStatus: [],
  porLoja: [],
  tendenciaMensal: [],
  observacoes: [],
});
```

- [ ] **Step 2: Escrever os testes de `assistenteInsights.ts` (falhando)**

```ts
// src/lib/assistenteInsights.test.ts
import { describe, expect, it } from "vitest";
import { buildInsightItems, buildTrendItems } from "@/lib/assistenteInsights";

type Row = { status: string; created_at: string };

describe("buildInsightItems", () => {
  it("agrupa por chave, ordena por total e calcula percentual", () => {
    const rows: Row[] = [
      { status: "pendente", created_at: "2026-01-01" },
      { status: "pendente", created_at: "2026-01-02" },
      { status: "assinado", created_at: "2026-01-03" },
    ];

    const result = buildInsightItems(
      rows,
      (row) => row.status,
      (row) => row.status,
      rows.length,
    );

    expect(result).toEqual([
      { key: "pendente", label: "pendente", total: 2, percentual: 66.7 },
      { key: "assinado", label: "assinado", total: 1, percentual: 33.3 },
    ]);
  });

  it("usa 'Não informado' quando a chave é nula/vazia", () => {
    const rows = [{ status: "", created_at: "2026-01-01" }];
    const result = buildInsightItems(
      rows,
      () => null,
      () => "ignorado",
      1,
    );
    expect(result[0].key).toBe("Não informado");
  });

  it("respeita o limite e ordena empates por label", () => {
    const rows: Row[] = [
      { status: "b", created_at: "2026-01-01" },
      { status: "a", created_at: "2026-01-01" },
      { status: "c", created_at: "2026-01-01" },
    ];
    const result = buildInsightItems(rows, (r) => r.status, (r) => r.status, 3, 2);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.key)).toEqual(["a", "b"]);
  });
});

describe("buildTrendItems", () => {
  it("retorna vazio quando não há linhas", () => {
    expect(buildTrendItems<Row>([], (r) => r.created_at)).toEqual([]);
  });

  it("agrupa por mês/ano a partir da primeira linha, preenchendo meses sem dados com zero", () => {
    const rows: Row[] = [
      { status: "x", created_at: "2026-03-15T00:00:00.000Z" },
      { status: "x", created_at: "2026-03-20T00:00:00.000Z" },
      { status: "x", created_at: "2026-01-05T00:00:00.000Z" },
    ];
    const result = buildTrendItems(rows, (r) => r.created_at, 3);
    expect(result).toHaveLength(3);
    expect(result[result.length - 1].total).toBe(2);
    expect(result.reduce((acc, item) => acc + item.total, 0)).toBe(3);
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/assistenteInsights.test.ts`
Expected: FAIL — `Cannot find module '@/lib/assistenteInsights'`.

- [ ] **Step 4: Criar `assistenteInsights.ts`**

```ts
import type { AssistenteInsightItem, AssistenteTrendItem } from "@/lib/assistenteTypes";

const getInsightLabel = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return "Não informado";
  }
  const trimmed = value.trim();
  return trimmed || "Não informado";
};

export function buildInsightItems<T>(
  rows: T[],
  getKey: (row: T) => string | null | undefined,
  getLabel: (row: T) => string,
  totalBase: number,
  limit = 5,
): AssistenteInsightItem[] {
  const grouped = new Map<string, { key: string; label: string; total: number }>();

  rows.forEach((row) => {
    const key = getInsightLabel(getKey(row));
    const current = grouped.get(key);
    if (current) {
      current.total += 1;
      return;
    }
    grouped.set(key, { key, label: getLabel(row), total: 1 });
  });

  return Array.from(grouped.values())
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((item) => ({
      key: item.key,
      label: item.label,
      total: item.total,
      percentual:
        totalBase > 0 ? Number(((item.total / totalBase) * 100).toFixed(1)) : 0,
    }));
}

export function buildTrendItems<T>(
  rows: T[],
  getDate: (row: T) => string,
  limit = 6,
): AssistenteTrendItem[] {
  if (rows.length === 0) {
    return [];
  }

  const grouped = new Map<string, number>();
  rows.forEach((row) => {
    const date = new Date(getDate(row));
    if (Number.isNaN(date.getTime())) {
      return;
    }
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  });

  const baseDate = new Date(getDate(rows[0]));
  if (Number.isNaN(baseDate.getTime())) {
    return [];
  }

  const points: { key: string; label: string }[] = [];
  const cursor = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  for (let index = 0; index < limit; index += 1) {
    const monthDate = new Date(
      cursor.getFullYear(),
      cursor.getMonth() - (limit - 1 - index),
      1,
    );
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
    points.push({
      key,
      label: monthDate
        .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
        .replace(".", ""),
    });
  }

  return points.map((point) => ({ ...point, total: grouped.get(point.key) ?? 0 }));
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/assistenteInsights.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 6: Commit**

```bash
git add src/lib/assistenteTypes.ts src/lib/assistenteInsights.ts src/lib/assistenteInsights.test.ts
git commit -m "feat: adiciona tipos compartilhados e insights genericos do assistente"
```

---

### Task 3: Persistência da conversa (`assistenteConversas.ts`)

**Files:**
- Create: `src/lib/assistenteConversas.ts`
- Test: `src/lib/assistenteConversas.test.ts`

**Interfaces:**
- Consumes: `AssistenteDominioId` de `assistenteTypes.ts` (Task 2).
- Produces: `AssistenteMensagem { role, text, dominio?, criado_em }`, `MAX_STORED_MESSAGES`, `getConversaMensagens(userId, supabaseAdmin)`, `appendConversaTurno(userId, { pergunta, resposta }, supabaseAdmin)`, `limparConversa(userId, supabaseAdmin)` — usados por `assistenteAgent.ts` (Task 5) e pelas rotas de API (Task 6).

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/lib/assistenteConversas.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  MAX_STORED_MESSAGES,
  appendConversaTurno,
  getConversaMensagens,
  limparConversa,
  type AssistenteMensagem,
} from "@/lib/assistenteConversas";

function makeFakeSupabase(initialMensagens: AssistenteMensagem[] | null) {
  const upsertCalls: unknown[] = [];
  const deleteCalls: string[] = [];

  const supabase = {
    from(table: string) {
      expect(table).toBe("assistente_conversas");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: initialMensagens ? { mensagens: initialMensagens } : null,
              error: null,
            }),
          }),
        }),
        upsert: async (payload: unknown) => {
          upsertCalls.push(payload);
          return { error: null };
        },
        delete: () => ({
          eq: async (_col: string, userId: string) => {
            deleteCalls.push(userId);
            return { error: null };
          },
        }),
      };
    },
  };

  return { supabase, upsertCalls, deleteCalls };
}

const msg = (text: string): AssistenteMensagem => ({
  role: "user",
  text,
  criado_em: "2026-01-01T00:00:00.000Z",
});

describe("getConversaMensagens", () => {
  it("devolve [] quando o usuario ainda nao tem conversa", async () => {
    const { supabase } = makeFakeSupabase(null);
    const result = await getConversaMensagens("user-1", supabase as never);
    expect(result).toEqual([]);
  });

  it("devolve as mensagens salvas", async () => {
    const { supabase } = makeFakeSupabase([msg("oi")]);
    const result = await getConversaMensagens("user-1", supabase as never);
    expect(result).toEqual([msg("oi")]);
  });
});

describe("appendConversaTurno", () => {
  it("faz upsert acrescentando pergunta e resposta ao final", async () => {
    const { supabase, upsertCalls } = makeFakeSupabase([msg("mensagem antiga")]);
    await appendConversaTurno(
      "user-1",
      { pergunta: msg("pergunta nova"), resposta: msg("resposta nova") },
      supabase as never,
    );
    expect(upsertCalls).toHaveLength(1);
    const payload = upsertCalls[0] as { user_id: string; mensagens: AssistenteMensagem[] };
    expect(payload.user_id).toBe("user-1");
    expect(payload.mensagens.map((m) => m.text)).toEqual([
      "mensagem antiga",
      "pergunta nova",
      "resposta nova",
    ]);
  });

  it("mantem no maximo MAX_STORED_MESSAGES mensagens (corta as mais antigas)", async () => {
    const antigas = Array.from({ length: MAX_STORED_MESSAGES }, (_, i) => msg(`m${i}`));
    const { supabase, upsertCalls } = makeFakeSupabase(antigas);
    await appendConversaTurno(
      "user-1",
      { pergunta: msg("nova pergunta"), resposta: msg("nova resposta") },
      supabase as never,
    );
    const payload = upsertCalls[0] as { mensagens: AssistenteMensagem[] };
    expect(payload.mensagens).toHaveLength(MAX_STORED_MESSAGES);
    expect(payload.mensagens[payload.mensagens.length - 1].text).toBe("nova resposta");
    expect(payload.mensagens[0].text).not.toBe("m0");
  });
});

describe("limparConversa", () => {
  it("apaga a linha do usuario", async () => {
    const { supabase, deleteCalls } = makeFakeSupabase([msg("oi")]);
    await limparConversa("user-1", supabase as never);
    expect(deleteCalls).toEqual(["user-1"]);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/assistenteConversas.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `assistenteConversas.ts`**

```ts
import type { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import type { AssistenteDominioId } from "@/lib/assistenteTypes";

export type AssistenteMensagem = {
  role: "user" | "assistant";
  text: string;
  dominio?: AssistenteDominioId;
  criado_em: string;
};

export const MAX_STORED_MESSAGES = 10;

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export async function getConversaMensagens(
  userId: string,
  supabaseAdmin: SupabaseAdmin,
): Promise<AssistenteMensagem[]> {
  const { data, error } = await supabaseAdmin
    .from("assistente_conversas")
    .select("mensagens")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data?.mensagens as AssistenteMensagem[] | null) ?? [];
}

export async function appendConversaTurno(
  userId: string,
  turno: { pergunta: AssistenteMensagem; resposta: AssistenteMensagem },
  supabaseAdmin: SupabaseAdmin,
): Promise<void> {
  const atuais = await getConversaMensagens(userId, supabaseAdmin);
  const proximas = [...atuais, turno.pergunta, turno.resposta].slice(
    -MAX_STORED_MESSAGES,
  );

  const { error } = await supabaseAdmin.from("assistente_conversas").upsert(
    {
      user_id: userId,
      mensagens: proximas,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw error;
  }
}

export async function limparConversa(
  userId: string,
  supabaseAdmin: SupabaseAdmin,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("assistente_conversas")
    .delete()
    .eq("user_id", userId);

  if (error) {
    throw error;
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/assistenteConversas.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistenteConversas.ts src/lib/assistenteConversas.test.ts
git commit -m "feat: adiciona persistencia da conversa do assistente"
```

---

### Task 4: Domínio documentos (`assistenteDominioDocumentos.ts`)

**Files:**
- Create: `src/lib/assistenteDominioDocumentos.ts`
- Test: `src/lib/assistenteDominioDocumentos.test.ts`

**Interfaces:**
- Consumes: `AssistenteDominio`, `AssistenteContext`, `AssistenteResultItem`, `AssistenteSearchOutcome`, `AssistenteInsights` de `assistenteTypes.ts`; `queryDocumentoCandidates`, `stripKnownFilters`, `DOCUMENTO_COPILOT_TYPES`, `DOCUMENTO_COPILOT_STATUS`, tipos `DocumentoCopilotFilters`/`DocumentoCopilotMatch`/`DocumentoCopilotInsights` de `documentosCopilot.ts` (não modificado); `getAuthorizedPrestadorIds`, `getGerenteAccessEntries`, `hasDocumentosAccess` de `apiAuth.ts`.
- Produces: `dominioDocumentos: AssistenteDominio` (`id: "documentos"`), consumido por `assistenteAgent.ts` (Task 5).

> Nota de implementação: `queryDocumentoCandidates` já calcula insights ricos (`porStatus`/`porTipo`/`porLoja`/`tendenciaMensal`) sobre até 1000 registros internamente — muito mais do que os poucos `matches` retornados para exibição. Para não arriscar regressão nesse cálculo (testado e em produção), este domínio **reaproveita esse resultado pronto** e só mapeia para o formato genérico `AssistenteInsights` (função `toAssistenteInsights`), em vez de recalcular com `buildInsightItems`/`buildTrendItems` a partir dos `matches` truncados. Os domínios novos das Fases 2/3 é que vão consumir `assistenteInsights.ts` diretamente.

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/lib/assistenteDominioDocumentos.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiAuth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/apiAuth")>("@/lib/apiAuth");
  return {
    ...actual,
    getAuthorizedPrestadorIds: vi.fn(async () => []),
    getGerenteAccessEntries: vi.fn(async () => []),
    hasDocumentosAccess: vi.fn(async () => true),
  };
});
vi.mock("@/lib/documentosCopilot", async () => {
  const actual = await vi.importActual<typeof import("@/lib/documentosCopilot")>(
    "@/lib/documentosCopilot",
  );
  return { ...actual, queryDocumentoCandidates: vi.fn() };
});

import { createEmptyInsights, queryDocumentoCandidates } from "@/lib/documentosCopilot";
import { dominioDocumentos } from "@/lib/assistenteDominioDocumentos";
import type { AssistenteContext } from "@/lib/assistenteTypes";

const mockedQuery = vi.mocked(queryDocumentoCandidates);

function makeCtx(overrides: Partial<AssistenteContext> = {}): AssistenteContext {
  return {
    supabaseAdmin: {} as never,
    userId: "user-1",
    email: "user@empresa.com",
    isAdmin: false,
    cache: new Map(),
    ...overrides,
  };
}

beforeEach(() => {
  mockedQuery.mockReset();
});

describe("dominioDocumentos.podeAcessar", () => {
  it("sempre permite (a query interna já filtra por escopo)", async () => {
    await expect(dominioDocumentos.podeAcessar(makeCtx())).resolves.toBe(true);
  });
});

describe("dominioDocumentos.executarTool buscar_documentos", () => {
  it("retorna erro quando nenhum filtro foi informado", async () => {
    const result = await dominioDocumentos.executarTool("buscar_documentos", {}, makeCtx());
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toHaveProperty("erro");
    expect(result.outcome).toBeUndefined();
  });

  it("busca documentos e mapeia para AssistenteResultItem/AssistenteInsights", async () => {
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
          lojaId: "loja-1",
          lojaNome: "Loja 1",
          prestadorId: null,
          prestadorNome: null,
          tipoLaudo: null,
          observacoes: null,
          arquivoPath: "notas_fiscais/nf1.pdf",
          arquivoAssinadoPath: null,
        },
      ],
      total: 1,
      insights: {
        ...createEmptyInsights(),
        totalDocumentos: 1,
        totalLojas: 1,
        totalPendentes: 1,
        porStatus: [{ key: "pendente", label: "Pendente", total: 1, percentual: 100 }],
      },
    });

    const result = await dominioDocumentos.executarTool(
      "buscar_documentos",
      { tipo: "notas_fiscais" },
      makeCtx(),
    );

    expect(result.outcome).toBeDefined();
    const outcome = result.outcome!;
    expect(outcome.dominio).toBe("documentos");
    expect(outcome.results).toEqual([
      {
        id: "doc-1",
        titulo: "nf1.pdf",
        subtitulo: "123 · Loja 1",
        abrirArquivoPath: "notas_fiscais/nf1.pdf",
      },
    ]);
    expect(outcome.total).toBe(1);
    expect(outcome.filtrosUrl).toBe("/documentos?tipo=notas_fiscais&source=assistente");
    expect(outcome.insights.totais).toEqual(
      expect.arrayContaining([{ key: "totalDocumentos", label: "Documentos", valor: 1 }]),
    );
  });
});

describe("dominioDocumentos.descricaoPrompt", () => {
  it("inclui os filtros atuais da tela quando o dominio do contexto e documentos", () => {
    const prompt = dominioDocumentos.descricaoPrompt(
      makeCtx({ currentContext: { dominio: "documentos", filtros: { status: "pendente" } } }),
    );
    expect(prompt).toContain("pendente");
  });

  it("nao inclui filtros quando o contexto e de outro dominio", () => {
    const prompt = dominioDocumentos.descricaoPrompt(
      makeCtx({ currentContext: { dominio: "orcamentos", filtros: { status: "rascunho" } } }),
    );
    expect(prompt).not.toContain("rascunho");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/assistenteDominioDocumentos.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `assistenteDominioDocumentos.ts`**

```ts
import type { AzureOpenAiTool } from "@/lib/azureOpenAi";
import {
  DOCUMENTO_COPILOT_STATUS,
  DOCUMENTO_COPILOT_TYPES,
  queryDocumentoCandidates,
  stripKnownFilters,
  type DocumentoCopilotFilters,
  type DocumentoCopilotInsights,
  type DocumentoCopilotMatch,
} from "@/lib/documentosCopilot";
import {
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
  hasDocumentosAccess,
  type GerenteAccessRow,
} from "@/lib/apiAuth";
import type {
  AssistenteContext,
  AssistenteDominio,
  AssistenteInsights,
  AssistenteResultItem,
  AssistenteSearchOutcome,
  AssistenteToolResult,
} from "@/lib/assistenteTypes";

const TOOLS: AzureOpenAiTool[] = [
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
];

type DocumentosAccessInfo = {
  allowedPrestadores: string[];
  gerenteEntries: GerenteAccessRow[];
  canAccess: boolean;
};

async function getDocumentosAccessInfo(ctx: AssistenteContext): Promise<DocumentosAccessInfo> {
  const cacheKey = "documentos:access";
  if (ctx.cache.has(cacheKey)) {
    return ctx.cache.get(cacheKey) as DocumentosAccessInfo;
  }
  const [allowedPrestadores, gerenteEntries, canAccess] = await Promise.all([
    getAuthorizedPrestadorIds(ctx.email, ctx.supabaseAdmin),
    getGerenteAccessEntries(ctx.userId, ctx.email, ctx.supabaseAdmin),
    hasDocumentosAccess(ctx.userId, ctx.email, ctx.supabaseAdmin),
  ]);
  const info: DocumentosAccessInfo = { allowedPrestadores, gerenteEntries, canAccess };
  ctx.cache.set(cacheKey, info);
  return info;
}

function buildDocumentosUrl(filters: DocumentoCopilotFilters): string {
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
  params.set("source", "assistente");
  return `/documentos?${params.toString()}`;
}

function buildSearchSummary(filters: DocumentoCopilotFilters): string {
  const partes: string[] = [];
  if (filters.tipo) partes.push(`tipo ${filters.tipo}`);
  if (filters.status) partes.push(`status ${filters.status}`);
  if (filters.tipoLaudo) partes.push(`tipo de laudo "${filters.tipoLaudo}"`);
  if (filters.ano) partes.push(`ano ${filters.ano}`);
  if (filters.mes) partes.push(`mês ${filters.mes}`);
  if (filters.lojaId) partes.push(`loja ${filters.lojaId}`);
  if (filters.prestadorId) partes.push(`prestador ${filters.prestadorId}`);
  if (filters.termo) partes.push(`termo "${filters.termo}"`);
  if (filters.somenteAssinados) partes.push("somente assinados");
  if (filters.somenteDisponiveisLote) partes.push("disponíveis para lote");
  return partes.length > 0
    ? `Critérios usados: ${partes.join(", ")}.`
    : "Sem filtros específicos, usei a intenção principal da pergunta.";
}

function buildResultItem(match: DocumentoCopilotMatch): AssistenteResultItem {
  return {
    id: match.id,
    titulo: match.nome,
    subtitulo: [match.identificacao, match.lojaNome].filter(Boolean).join(" · "),
    abrirArquivoPath: match.arquivoAssinadoPath ?? match.arquivoPath,
  };
}

function toAssistenteInsights(insights: DocumentoCopilotInsights): AssistenteInsights {
  return {
    totais: [
      { key: "totalDocumentos", label: "Documentos", valor: insights.totalDocumentos },
      { key: "totalLojas", label: "Lojas", valor: insights.totalLojas },
      { key: "totalPendentes", label: "Pendentes", valor: insights.totalPendentes },
      { key: "totalAssinados", label: "Assinados", valor: insights.totalAssinados },
    ],
    isTruncated: insights.isTruncated,
    porStatus: insights.porStatus,
    porLoja: insights.porLoja,
    tendenciaMensal: insights.tendenciaMensal,
    observacoes: insights.observacoes,
  };
}

async function executarBuscarDocumentos(
  args: Record<string, unknown>,
  ctx: AssistenteContext,
): Promise<AssistenteToolResult> {
  const filters = stripKnownFilters(args as DocumentoCopilotFilters);
  if (Object.keys(filters).length === 0) {
    return {
      content: JSON.stringify({
        erro:
          "Nenhum filtro foi informado. Peca ao usuario pelo menos um criterio (tipo, status, loja, prestador, mes/ano ou um trecho de texto) antes de buscar.",
      }),
    };
  }

  const { allowedPrestadores, gerenteEntries, canAccess } = await getDocumentosAccessInfo(ctx);
  const { matches, total, insights } = await queryDocumentoCandidates({
    filters,
    userId: ctx.userId,
    allowedPrestadores,
    gerenteEntries,
    canAccess,
    supabaseAdmin: ctx.supabaseAdmin,
  });

  const outcome: AssistenteSearchOutcome = {
    dominio: "documentos",
    filters,
    filtrosUrl: buildDocumentosUrl(filters),
    summary: buildSearchSummary(filters),
    results: matches.map(buildResultItem),
    total,
    insights: toAssistenteInsights(insights),
  };

  const resumoParaModelo = {
    filtrosAplicados: filters,
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

  return { content: JSON.stringify(resumoParaModelo), outcome };
}

export const dominioDocumentos: AssistenteDominio = {
  id: "documentos",
  tools: TOOLS,
  podeAcessar: async () => true,
  descricaoPrompt: (ctx) => {
    const partes = [
      "Para o domínio de documentos, você tem a ferramenta buscar_documentos, além de buscar_lojas e buscar_prestadores (compartilhadas entre domínios).",
      "Se o usuário mencionar uma loja ou prestador por nome, apelido ou código (mesmo parcial), chame buscar_lojas ou buscar_prestadores primeiro para descobrir o ID exato — nunca invente um ID.",
      "Se buscar_lojas ou buscar_prestadores devolver mais de um resultado plausível e a pergunta não deixar claro qual é, pergunte ao usuário qual deles antes de chamar buscar_documentos.",
      `Valores válidos de tipo: ${Object.keys(DOCUMENTO_COPILOT_TYPES).join(", ")}.`,
      `Valores válidos de status: ${DOCUMENTO_COPILOT_STATUS.join(", ")}.`,
    ];
    if (ctx.currentContext?.dominio === "documentos") {
      const filtrosAtuais = stripKnownFilters(ctx.currentContext.filtros as DocumentoCopilotFilters);
      if (Object.keys(filtrosAtuais).length > 0) {
        partes.push(
          `A tela do usuário já está com estes filtros aplicados (contexto, não obrigação de usar): ${JSON.stringify(filtrosAtuais)}.`,
        );
      }
    }
    return partes.join(" ");
  },
  executarTool: async (nome, args, ctx) => {
    if (nome === "buscar_documentos") {
      return executarBuscarDocumentos(args, ctx);
    }
    return { content: JSON.stringify({ erro: `Ferramenta desconhecida: ${nome}` }) };
  },
};
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/assistenteDominioDocumentos.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistenteDominioDocumentos.ts src/lib/assistenteDominioDocumentos.test.ts
git commit -m "feat: porta o dominio documentos para a interface AssistenteDominio"
```

---

### Task 5: Core do agente (`assistenteAgent.ts`)

**Files:**
- Create: `src/lib/assistenteAgent.ts`
- Test: `src/lib/assistenteAgent.test.ts`

**Interfaces:**
- Consumes: `AssistenteDominio`, `AssistenteContext`, `AssistenteSearchOutcome`, `AssistenteInsights`, `createEmptyAssistenteInsights`, `AssistenteDominioId` de `assistenteTypes.ts`; `dominioDocumentos` de `assistenteDominioDocumentos.ts`; `getConversaMensagens`/`appendConversaTurno`/`AssistenteMensagem` de `assistenteConversas.ts`; `callAzureOpenAiChat` de `azureOpenAi.ts`; `buscarLojasPorNome`/`buscarPrestadoresPorNome` de `documentosCopilotEntitySearch.ts`; `ApiHttpError` de `apiAuth.ts`.
- Produces: `MAX_AGENT_TOOL_ITERATIONS`, `AssistenteAgentAuth { userId, email, isAdmin }`, `AssistenteAgentRequest { pergunta, currentContext? }`, `AssistenteResponse { reply, dominio, summary, filters, filtrosUrl, results, total, insights }`, `runAssistenteAgent(request, auth, dominios?)` — usado pela rota `POST /api/assistente/chat` (Task 6).

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/lib/assistenteAgent.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/azureOpenAi", () => ({ callAzureOpenAiChat: vi.fn() }));
vi.mock("@/lib/supabaseAdminClient", () => ({ createSupabaseAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/documentosCopilotEntitySearch", () => ({
  buscarLojasPorNome: vi.fn(async () => []),
  buscarPrestadoresPorNome: vi.fn(async () => []),
}));
vi.mock("@/lib/assistenteConversas", () => ({
  getConversaMensagens: vi.fn(async () => []),
  appendConversaTurno: vi.fn(async () => undefined),
  MAX_STORED_MESSAGES: 10,
}));

import { callAzureOpenAiChat } from "@/lib/azureOpenAi";
import { appendConversaTurno, getConversaMensagens } from "@/lib/assistenteConversas";
import {
  buscarLojasPorNome,
  buscarPrestadoresPorNome,
} from "@/lib/documentosCopilotEntitySearch";
import { MAX_AGENT_TOOL_ITERATIONS, runAssistenteAgent } from "@/lib/assistenteAgent";
import { createEmptyAssistenteInsights, type AssistenteDominio } from "@/lib/assistenteTypes";

const mockedChat = vi.mocked(callAzureOpenAiChat);
const mockedGetHistorico = vi.mocked(getConversaMensagens);
const mockedAppend = vi.mocked(appendConversaTurno);
const mockedBuscarLojas = vi.mocked(buscarLojasPorNome);
const mockedBuscarPrestadores = vi.mocked(buscarPrestadoresPorNome);

const auth = { userId: "user-1", email: "user@empresa.com", isAdmin: false };

function fakeDominio(overrides: Partial<AssistenteDominio> = {}): AssistenteDominio {
  return {
    id: "documentos",
    tools: [
      {
        type: "function",
        function: { name: "ferramenta_teste", description: "teste", parameters: { type: "object", properties: {} } },
      },
    ],
    descricaoPrompt: () => "Regras do dominio de teste.",
    podeAcessar: async () => true,
    executarTool: async () => ({ content: "{}" }),
    ...overrides,
  };
}

beforeEach(() => {
  mockedChat.mockReset();
  mockedGetHistorico.mockReset().mockResolvedValue([]);
  mockedAppend.mockReset().mockResolvedValue(undefined);
  mockedBuscarLojas.mockReset();
  mockedBuscarPrestadores.mockReset();
});

describe("runAssistenteAgent", () => {
  it("retorna a resposta do modelo direto quando ele nao chama nenhuma ferramenta", async () => {
    mockedChat.mockResolvedValueOnce({ content: "Posso ajudar. Me diga um detalhe.", toolCalls: [] });

    const result = await runAssistenteAgent({ pergunta: "oi" }, auth, [fakeDominio()]);

    expect(result.reply).toBe("Posso ajudar. Me diga um detalhe.");
    expect(result.dominio).toBeNull();
    expect(result.results).toEqual([]);
    expect(result.insights).toEqual(createEmptyAssistenteInsights());
    expect(mockedAppend).toHaveBeenCalledTimes(1);
  });

  it("nao inclui dominios sem acesso nas tools nem no prompt", async () => {
    mockedChat.mockResolvedValueOnce({ content: "ok", toolCalls: [] });
    const dominioSemAcesso = fakeDominio({
      id: "cobrancas",
      podeAcessar: async () => false,
      descricaoPrompt: () => "NUNCA_DEVE_APARECER",
    });

    await runAssistenteAgent({ pergunta: "oi" }, auth, [fakeDominio(), dominioSemAcesso]);

    const sentSystemMessage = mockedChat.mock.calls[0][0].messages[0];
    expect(sentSystemMessage.content).not.toContain("NUNCA_DEVE_APARECER");
  });

  it("despacha um tool_call para o dominio dono da ferramenta e usa seu outcome na resposta", async () => {
    const outcome = {
      dominio: "documentos" as const,
      filters: { tipo: "notas_fiscais" },
      filtrosUrl: "/documentos?tipo=notas_fiscais",
      summary: "Critérios usados: tipo notas_fiscais.",
      results: [{ id: "doc-1", titulo: "nf1.pdf", subtitulo: "123" }],
      total: 1,
      insights: createEmptyAssistenteInsights(),
    };
    const executarTool = vi.fn(async () => ({ content: JSON.stringify({ total: 1 }), outcome }));

    mockedChat
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          { id: "call-1", type: "function", function: { name: "ferramenta_teste", arguments: "{}" } },
        ],
      })
      .mockResolvedValueOnce({ content: "Encontrei 1 nota fiscal.", toolCalls: [] });

    const result = await runAssistenteAgent(
      { pergunta: "notas fiscais" },
      auth,
      [fakeDominio({ executarTool })],
    );

    expect(executarTool).toHaveBeenCalledWith("ferramenta_teste", {}, expect.anything());
    expect(result.reply).toBe("Encontrei 1 nota fiscal.");
    expect(result.dominio).toBe("documentos");
    expect(result.results).toEqual(outcome.results);
    expect(result.filtrosUrl).toBe(outcome.filtrosUrl);
  });

  it("corta no maximo de iteracoes e ainda devolve uma resposta utilizavel", async () => {
    mockedChat.mockImplementation(async () => ({
      content: null,
      toolCalls: [
        { id: "call-loop", type: "function", function: { name: "ferramenta_teste", arguments: "{}" } },
      ],
    }));
    const executarTool = vi.fn(async () => ({
      content: JSON.stringify({ total: 0 }),
      outcome: {
        dominio: "documentos" as const,
        filters: {},
        filtrosUrl: null,
        summary: "Sem filtros aplicados.",
        results: [],
        total: 0,
        insights: createEmptyAssistenteInsights(),
      },
    }));

    const result = await runAssistenteAgent(
      { pergunta: "documentos" },
      auth,
      [fakeDominio({ executarTool })],
    );

    expect(mockedChat).toHaveBeenCalledTimes(MAX_AGENT_TOOL_ITERATIONS);
    expect(result.reply).toContain("Não encontrei resultados");
  });

  it("chama buscar_lojas diretamente (ferramenta compartilhada, nao pertence a nenhum dominio)", async () => {
    mockedChat
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          { id: "call-1", type: "function", function: { name: "buscar_lojas", arguments: JSON.stringify({ query: "avenida" }) } },
        ],
      })
      .mockResolvedValueOnce({ content: "Achei a loja Avenida.", toolCalls: [] });
    mockedBuscarLojas.mockResolvedValueOnce([{ id: "loja-302", nome: "302 - Avenida Paulista", codigo: "302" }]);

    const result = await runAssistenteAgent({ pergunta: "loja avenida" }, auth, [fakeDominio()]);

    expect(mockedBuscarLojas).toHaveBeenCalledWith("avenida", expect.anything());
    expect(result.reply).toBe("Achei a loja Avenida.");
  });

  it("persiste a pergunta e a resposta no historico ao final do turno", async () => {
    mockedChat.mockResolvedValueOnce({ content: "ok", toolCalls: [] });

    await runAssistenteAgent({ pergunta: "oi" }, auth, [fakeDominio()]);

    expect(mockedAppend).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        pergunta: expect.objectContaining({ role: "user", text: "oi" }),
        resposta: expect.objectContaining({ role: "assistant", text: "ok" }),
      }),
      expect.anything(),
    );
  });

  it("manda o historico persistido (ate 10 mensagens) para o modelo", async () => {
    mockedGetHistorico.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as const,
        text: `mensagem ${i}`,
        criado_em: "2026-01-01T00:00:00.000Z",
      })),
    );
    mockedChat.mockResolvedValueOnce({ content: "ok", toolCalls: [] });

    await runAssistenteAgent({ pergunta: "nova pergunta" }, auth, [fakeDominio()]);

    const sentMessages = mockedChat.mock.calls[0][0].messages;
    const nonSystemMessages = sentMessages.filter((m) => m.role !== "system");
    // 10 mensagens do historico (das 12, cortadas) + a pergunta nova
    expect(nonSystemMessages).toHaveLength(11);
    expect(nonSystemMessages[0]).toMatchObject({ content: "mensagem 2" });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/assistenteAgent.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `assistenteAgent.ts`**

```ts
import {
  callAzureOpenAiChat,
  type AzureOpenAiChatMessage,
  type AzureOpenAiTool,
} from "@/lib/azureOpenAi";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { ApiHttpError } from "@/lib/apiAuth";
import {
  appendConversaTurno,
  getConversaMensagens,
  type AssistenteMensagem,
} from "@/lib/assistenteConversas";
import {
  buscarLojasPorNome,
  buscarPrestadoresPorNome,
} from "@/lib/documentosCopilotEntitySearch";
import { dominioDocumentos } from "@/lib/assistenteDominioDocumentos";
import {
  createEmptyAssistenteInsights,
  type AssistenteContext,
  type AssistenteDominio,
  type AssistenteDominioId,
  type AssistenteInsights,
  type AssistenteResultItem,
  type AssistenteSearchOutcome,
} from "@/lib/assistenteTypes";

export const MAX_AGENT_TOOL_ITERATIONS = 5;
const MAX_HISTORY_MESSAGES = 10;

const DOMINIOS_REGISTRADOS: AssistenteDominio[] = [dominioDocumentos];

const INTRO_PROMPT =
  "Você é um assistente virtual interno do sistema. Nunca invente documentos, IDs ou dados fora do que as ferramentas devolveram. " +
  "Nunca proponha executar uma ação (aplicar filtro, abrir documento, disparar cobrança, aprovar orçamento) — você só busca e explica; " +
  "quem decide agir é o usuário. Responda sempre em português do Brasil, de forma curta e direta, citando números relevantes quando fizer sentido.";

const SHARED_TOOLS: AzureOpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "buscar_lojas",
      description:
        "Procura lojas por nome ou codigo parecido com o termo informado. Use quando o usuario mencionar uma loja por nome, apelido ou codigo parcial.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Termo de busca (nome ou codigo parcial da loja)" } },
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
        properties: { query: { type: "string", description: "Termo de busca (nome parcial do prestador)" } },
        required: ["query"],
      },
    },
  },
];

const SHARED_TOOL_NAMES = new Set(SHARED_TOOLS.map((tool) => tool.function.name));

export type AssistenteAgentAuth = {
  userId: string;
  email: string | null;
  isAdmin: boolean;
};

export type AssistenteAgentRequest = {
  pergunta: string;
  currentContext?: { dominio: AssistenteDominioId; filtros: Record<string, unknown> };
};

export type AssistenteResponse = {
  reply: string;
  dominio: AssistenteDominioId | null;
  summary: string;
  filters: Record<string, unknown>;
  filtrosUrl: string | null;
  results: AssistenteResultItem[];
  total: number;
  insights: AssistenteInsights;
};

const parseToolArguments = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export async function runAssistenteAgent(
  request: AssistenteAgentRequest,
  auth: AssistenteAgentAuth,
  dominios: AssistenteDominio[] = DOMINIOS_REGISTRADOS,
): Promise<AssistenteResponse> {
  const supabaseAdmin = createSupabaseAdminClient();
  const ctx: AssistenteContext = {
    supabaseAdmin,
    userId: auth.userId,
    email: auth.email,
    isAdmin: auth.isAdmin,
    currentContext: request.currentContext,
    cache: new Map(),
  };

  const acessiveisFlags = await Promise.all(dominios.map((dominio) => dominio.podeAcessar(ctx)));
  const acessiveis = dominios.filter((_, index) => acessiveisFlags[index]);

  const toolOwner = new Map<string, AssistenteDominio>();
  for (const dominio of acessiveis) {
    for (const tool of dominio.tools) {
      toolOwner.set(tool.function.name, dominio);
    }
  }

  const tools: AzureOpenAiTool[] = [...SHARED_TOOLS, ...acessiveis.flatMap((d) => d.tools)];
  const systemPrompt = [INTRO_PROMPT, ...acessiveis.map((d) => d.descricaoPrompt(ctx))].join(" ");

  const historico = await getConversaMensagens(auth.userId, supabaseAdmin);
  const perguntaMensagem: AssistenteMensagem = {
    role: "user",
    text: request.pergunta,
    criado_em: new Date().toISOString(),
  };

  const messages: AzureOpenAiChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...historico.slice(-MAX_HISTORY_MESSAGES).map(
      (m): AzureOpenAiChatMessage =>
        m.role === "user" ? { role: "user", content: m.text } : { role: "assistant", content: m.text },
    ),
    { role: "user", content: request.pergunta },
  ];

  let lastOutcome: AssistenteSearchOutcome | null = null;
  let finalReply: string | null = null;

  for (let iteration = 0; iteration < MAX_AGENT_TOOL_ITERATIONS; iteration += 1) {
    const result = await callAzureOpenAiChat({ messages, maxTokens: 700, tools });

    if (result.toolCalls.length === 0) {
      finalReply = result.content?.trim() || null;
      break;
    }

    messages.push({ role: "assistant", content: result.content, tool_calls: result.toolCalls });

    for (const toolCall of result.toolCalls) {
      const args = parseToolArguments(toolCall.function.arguments);
      let content: string;
      let outcome: AssistenteSearchOutcome | undefined;

      try {
        if (toolCall.function.name === "buscar_lojas") {
          const lojas = await buscarLojasPorNome(typeof args.query === "string" ? args.query : "", supabaseAdmin);
          content = JSON.stringify({ lojas });
        } else if (toolCall.function.name === "buscar_prestadores") {
          const prestadores = await buscarPrestadoresPorNome(
            typeof args.query === "string" ? args.query : "",
            supabaseAdmin,
          );
          content = JSON.stringify({ prestadores });
        } else {
          const dominio = toolOwner.get(toolCall.function.name);
          if (!dominio) {
            content = JSON.stringify({ erro: `Ferramenta desconhecida: ${toolCall.function.name}` });
          } else {
            const toolResult = await dominio.executarTool(toolCall.function.name, args, ctx);
            content = toolResult.content;
            outcome = toolResult.outcome;
          }
        }
      } catch (err) {
        if (err instanceof ApiHttpError) {
          throw err;
        }
        content = JSON.stringify({
          erro: "Nao foi possivel executar essa acao agora. Tente novamente ou ajuste o pedido.",
        });
      }

      if (outcome) {
        lastOutcome = outcome;
      }
      messages.push({ role: "tool", tool_call_id: toolCall.id, content });
    }
  }

  const reply =
    finalReply ||
    (lastOutcome
      ? lastOutcome.results.length > 0
        ? `Encontrei ${lastOutcome.results.length} resultado(s) que parecem corresponder à sua busca.`
        : "Não encontrei resultados com esses critérios. Posso ajustar a busca se você me disser mais um detalhe."
      : "Me diga um pouco mais sobre o que você precisa.");

  const respostaMensagem: AssistenteMensagem = {
    role: "assistant",
    text: reply,
    dominio: lastOutcome?.dominio,
    criado_em: new Date().toISOString(),
  };
  await appendConversaTurno(
    auth.userId,
    { pergunta: perguntaMensagem, resposta: respostaMensagem },
    supabaseAdmin,
  );

  return {
    reply,
    dominio: lastOutcome?.dominio ?? null,
    summary: lastOutcome?.summary ?? "Sem filtros aplicados.",
    filters: lastOutcome?.filters ?? {},
    filtrosUrl: lastOutcome?.filtrosUrl ?? null,
    results: lastOutcome?.results ?? [],
    total: lastOutcome?.total ?? 0,
    insights: lastOutcome?.insights ?? createEmptyAssistenteInsights(),
  };
}

export const isSharedToolName = (name: string) => SHARED_TOOL_NAMES.has(name);
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/assistenteAgent.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistenteAgent.ts src/lib/assistenteAgent.test.ts
git commit -m "feat: adiciona core generico do assistente com registro de dominios"
```

---

### Task 6: Rotas de API (`/api/assistente/chat`, `/api/assistente/historico`)

**Files:**
- Create: `src/app/api/assistente/chat/route.ts`
- Create: `src/app/api/assistente/historico/route.ts`

**Interfaces:**
- Consumes: `runAssistenteAgent` (Task 5), `getConversaMensagens`/`limparConversa` (Task 3), `getActorFromRequest`/`ApiHttpError` de `apiAuth.ts`, `createSupabaseAdminClient`.
- Produces: `POST /api/assistente/chat` → `AssistenteResponse`; `GET /api/assistente/historico` → `{ mensagens: AssistenteMensagem[] }`; `DELETE /api/assistente/historico` → `{ ok: true }`. Consumidos pelo widget (Task 7).

- [ ] **Step 1: Implementar `POST /api/assistente/chat`**

```ts
// src/app/api/assistente/chat/route.ts
import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { runAssistenteAgent } from "@/lib/assistenteAgent";
import type { AssistenteDominioId } from "@/lib/assistenteTypes";

const DOMINIOS_VALIDOS: AssistenteDominioId[] = ["documentos", "orcamentos", "cobrancas"];

export async function POST(request: Request) {
  try {
    const actor = await getActorFromRequest(request);
    if (!actor.userId) {
      throw new HttpError(400, "Assistente indisponível durante simulação de usuário.");
    }

    const body = (await request.json().catch(() => ({}))) as {
      pergunta?: string;
      currentContext?: { dominio?: string; filtros?: Record<string, unknown> };
    };

    const pergunta = typeof body.pergunta === "string" ? body.pergunta.trim() : "";
    if (!pergunta) {
      throw new HttpError(400, "Informe uma pergunta para o assistente.");
    }

    const dominioContexto = body.currentContext?.dominio;
    const currentContext =
      dominioContexto && DOMINIOS_VALIDOS.includes(dominioContexto as AssistenteDominioId)
        ? {
            dominio: dominioContexto as AssistenteDominioId,
            filtros: body.currentContext?.filtros ?? {},
          }
        : undefined;

    const payload = await runAssistenteAgent(
      { pergunta, currentContext },
      { userId: actor.userId, email: actor.email, isAdmin: actor.isAdmin },
    );

    return NextResponse.json(payload);
  } catch (err) {
    console.error("Erro no assistente virtual:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Não foi possível consultar o assistente.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Implementar `GET`/`DELETE /api/assistente/historico`**

```ts
// src/app/api/assistente/historico/route.ts
import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { getConversaMensagens, limparConversa } from "@/lib/assistenteConversas";

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    if (!actor.userId) {
      throw new HttpError(400, "Assistente indisponível durante simulação de usuário.");
    }
    const mensagens = await getConversaMensagens(actor.userId, supabaseAdmin);
    return NextResponse.json({ mensagens });
  } catch (err) {
    console.error("Erro ao carregar historico do assistente:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Não foi possível carregar o histórico.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    if (!actor.userId) {
      throw new HttpError(400, "Assistente indisponível durante simulação de usuário.");
    }
    await limparConversa(actor.userId, supabaseAdmin);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Erro ao limpar historico do assistente:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Não foi possível limpar o histórico.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verificar manualmente com o dev server**

Run: `npm run dev`, depois com a sessão logada no browser (DevTools → Application → copiar o `access_token` da sessão do Supabase, ou usar a própria aba autenticada):

```bash
curl -s -X POST http://localhost:3000/api/assistente/chat \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pergunta":"oi"}'
curl -s http://localhost:3000/api/assistente/historico -H "Authorization: Bearer $TOKEN"
curl -s -X DELETE http://localhost:3000/api/assistente/historico -H "Authorization: Bearer $TOKEN"
```

Expected: primeira chamada devolve um JSON com `reply`; a segunda mostra a mensagem salva; a terceira zera; uma nova chamada ao histórico devolve `{ "mensagens": [] }`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/assistente
git commit -m "feat: adiciona rotas de API do assistente (chat e historico)"
```

---

### Task 7: Widget flutuante (`AssistenteWidget.tsx`)

**Files:**
- Create: `src/components/AssistenteWidget.tsx`

**Interfaces:**
- Consumes: `POST /api/assistente/chat`, `GET/DELETE /api/assistente/historico` (Task 6); `AssistenteResponse`/`AssistenteDominioId`/`AssistenteInsights`/`AssistenteResultItem` (tipos, via um arquivo de tipos client-safe — reexporte de `@/lib/assistenteTypes`, que não importa nada server-only além de tipos); `supabase` de `@/lib/supabaseClient`; `getSignedFileUrl`, `resolveSignedPdfPath` de `@/app/documentos/_lib/documentosShared`.
- Produces: componente `AssistenteWidget` default export, montado pelo `AppShell` (Task 8).

- [ ] **Step 1: Implementar o componente**

```tsx
// src/components/AssistenteWidget.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Bot, LoaderCircle, Send, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import {
  getSignedFileUrl,
  resolveSignedPdfPath,
} from "@/app/documentos/_lib/documentosShared";
import type {
  AssistenteDominioId,
  AssistenteInsights,
  AssistenteResultItem,
} from "@/lib/assistenteTypes";

type AssistenteApiResponse = {
  reply: string;
  dominio: AssistenteDominioId | null;
  summary: string;
  filters: Record<string, unknown>;
  filtrosUrl: string | null;
  results: AssistenteResultItem[];
  total: number;
  insights: AssistenteInsights;
  error?: string;
};

type ChatTurn =
  | { id: string; role: "user"; text: string }
  | ({ id: string; role: "assistant" } & AssistenteApiResponse);

const ROUTE_DOMINIO: { prefix: string; dominio: AssistenteDominioId }[] = [
  { prefix: "/documentos/orcamentos-internos", dominio: "orcamentos" },
  { prefix: "/documentos/cobrancas", dominio: "cobrancas" },
  { prefix: "/documentos", dominio: "documentos" },
];

const CHIPS: { dominio: AssistenteDominioId; label: string; pergunta: string }[] = [
  { dominio: "documentos", label: "Documentos", pergunta: "Buscar documentos" },
  { dominio: "orcamentos", label: "Orçamentos", pergunta: "Consultar meus orçamentos" },
  { dominio: "cobrancas", label: "Cobranças", pergunta: "Ver pendências de cobrança" },
];

function detectarDominioDaRota(pathname: string | null): AssistenteDominioId | null {
  if (!pathname) return null;
  const match = ROUTE_DOMINIO.find((entry) => pathname.startsWith(entry.prefix));
  return match?.dominio ?? null;
}

export default function AssistenteWidget() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [historicoCarregado, setHistoricoCarregado] = useState(false);
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [turns]);

  const getAccessToken = async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const token = data.session?.access_token;
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    return token;
  };

  const carregarHistorico = async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/assistente/historico", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await res.json()) as {
        mensagens?: { role: "user" | "assistant"; text: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? "Não foi possível carregar o histórico.");
      const carregadas: ChatTurn[] = (payload.mensagens ?? []).map((m, index) =>
        m.role === "user"
          ? { id: `hist-${index}`, role: "user", text: m.text }
          : {
              id: `hist-${index}`,
              role: "assistant",
              reply: m.text,
              dominio: null,
              summary: "",
              filters: {},
              filtrosUrl: null,
              results: [],
              total: 0,
              insights: {
                totais: [],
                isTruncated: false,
                porStatus: [],
                porLoja: [],
                tendenciaMensal: [],
                observacoes: [],
              },
            },
      );
      setTurns(carregadas);
    } catch (err) {
      console.error("Erro ao carregar histórico do assistente:", err);
    } finally {
      setHistoricoCarregado(true);
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
    if (!historicoCarregado) {
      void carregarHistorico();
    }
  };

  const buildCurrentContext = () => {
    const dominio = detectarDominioDaRota(pathname);
    if (!dominio) return undefined;
    const filtros: Record<string, unknown> = {};
    searchParams.forEach((value, key) => {
      filtros[key] = value;
    });
    return { dominio, filtros };
  };

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userTurn: ChatTurn = { id: crypto.randomUUID(), role: "user", text: trimmed };
    setTurns((prev) => [...prev, userTurn]);
    setMessage("");
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const res = await fetch("/api/assistente/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pergunta: trimmed, currentContext: buildCurrentContext() }),
      });
      const payload = (await res.json()) as AssistenteApiResponse;
      if (!res.ok) throw new Error(payload.error ?? "Não foi possível consultar o assistente.");
      setTurns((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", ...payload }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível consultar o assistente.");
    } finally {
      setLoading(false);
    }
  };

  const handleNovaConversa = async () => {
    try {
      const token = await getAccessToken();
      await fetch("/api/assistente/historico", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error("Erro ao limpar histórico:", err);
    } finally {
      setTurns([]);
      setMessage("");
      setError(null);
    }
  };

  const handleAbrirArquivo = async (item: AssistenteResultItem) => {
    if (!item.abrirArquivoPath) return;
    const path = resolveSignedPdfPath(item.abrirArquivoPath) ?? item.abrirArquivoPath;
    try {
      setOpeningId(item.id);
      const signedUrl = await getSignedFileUrl(path);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("Erro ao abrir arquivo:", err);
      setError("Não foi possível abrir o arquivo.");
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {isOpen && (
        <div className="flex max-h-[70vh] w-[380px] max-w-[92vw] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl shadow-slate-400/20">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Bot className="h-4 w-4 text-sky-600" />
              Assistente
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Fechar assistente"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={bodyRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {turns.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {CHIPS.map((chip) => (
                  <button
                    key={chip.dominio}
                    type="button"
                    onClick={() => setMessage(chip.pergunta)}
                    className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}

            {turns.map((turn) =>
              turn.role === "user" ? (
                <div
                  key={turn.id}
                  className="ml-auto max-w-[85%] rounded-2xl bg-sky-600 px-3 py-2 text-sm text-white"
                >
                  {turn.text}
                </div>
              ) : (
                <div key={turn.id} className="space-y-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <p>{turn.reply}</p>
                  {turn.filtrosUrl && turn.results.length > 0 && (
                    <a
                      href={turn.filtrosUrl}
                      className="inline-block rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-500"
                    >
                      Aplicar na tela
                    </a>
                  )}
                  {turn.insights.totais.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      {turn.insights.totais.map((item) => (
                        <div key={item.key} className="rounded-xl bg-white px-2 py-1.5 text-center">
                          <p className="text-[10px] uppercase text-slate-400">{item.label}</p>
                          <p className="text-sm font-semibold text-slate-800">{item.valor}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {turn.results.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {turn.results.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 rounded-xl bg-white px-2.5 py-1.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-slate-800">{item.titulo}</p>
                            <p className="truncate text-[11px] text-slate-500">{item.subtitulo}</p>
                          </div>
                          {item.abrirArquivoPath ? (
                            <button
                              type="button"
                              disabled={openingId === item.id}
                              onClick={() => void handleAbrirArquivo(item)}
                              className="shrink-0 rounded-full border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                            >
                              {openingId === item.id ? "Abrindo..." : "Ver arquivo"}
                            </button>
                          ) : item.url ? (
                            <a
                              href={item.url}
                              className="shrink-0 rounded-full border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              Abrir
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>

          {error && <p className="px-4 pb-1 text-xs text-red-600">{error}</p>}

          <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-3">
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !loading) void submit(message);
              }}
              placeholder="Pergunte algo..."
              className="min-w-0 flex-1 rounded-full border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400"
            />
            <button
              type="button"
              onClick={() => void submit(message)}
              disabled={loading}
              className="rounded-full bg-sky-600 p-2 text-white hover:bg-sky-500 disabled:opacity-60"
              aria-label="Enviar"
            >
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          {turns.length > 0 && (
            <button
              type="button"
              onClick={() => void handleNovaConversa()}
              className="border-t border-slate-100 px-4 py-2 text-left text-xs font-semibold text-slate-500 hover:bg-slate-50"
            >
              Nova conversa
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : handleOpen())}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-600 text-white shadow-xl shadow-sky-900/20 transition hover:bg-sky-500"
        aria-label={isOpen ? "Fechar assistente" : "Abrir assistente"}
      >
        {isOpen ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verificar manualmente**

Run: `npm run dev`, abrir `http://localhost:3000/dashboard` logado.
Expected: bolha flutuante no canto inferior direito; abrir mostra os chips; enviar uma pergunta sobre documentos retorna resposta com cards; "Nova conversa" zera a thread e some do histórico ao recarregar a página.

- [ ] **Step 3: Commit**

```bash
git add src/components/AssistenteWidget.tsx
git commit -m "feat: adiciona widget flutuante do assistente"
```

---

### Task 8: Montar o widget e remover a página/card antigos

**Files:**
- Modify: `src/components/AppShell.tsx`
- Delete: `src/app/copilot/page.tsx`
- Delete: `src/app/documentos/_components/DocumentosCopilot.tsx`
- Modify: `src/components/AppShell.tsx` (nav: remover o item "Copiloto" que linkava para `/copilot`)

**Interfaces:**
- Consumes: `AssistenteWidget` (Task 7).

- [ ] **Step 1: Montar o widget no `AppShell`**

Em `src/components/AppShell.tsx`, adicionar o import:

```ts
import AssistenteWidget from "@/components/AssistenteWidget";
```

Renderizar condicionalmente logo antes do fechamento do componente (depois do bloco `{isHelpOpen ? ... : null}`, dentro do `return`, como último irmão da `div` raiz), só quando autenticado:

```tsx
      {isAuthenticated && !isLoading ? <AssistenteWidget /> : null}
    </div>
  );
}
```

(o `</div>` final já existia fechando a `div` raiz `className="relative min-h-screen overflow-hidden ..."` — o widget entra como irmão dela por último, antes desse fechamento.)

- [ ] **Step 2: Remover o item de navegação "Copiloto"**

Em `src/components/AppShell.tsx`, remover do array `navGroups[0].items` o objeto:

```ts
        {
          href: "/copilot",
          label: "Copiloto",
          icon: Bot,
          isActive: pathname?.startsWith("/copilot"),
          isVisible: canAccessDocuments,
        },
```

Remover também o import de `Bot` de `lucide-react` se não for mais usado em nenhum outro lugar do arquivo (verifique com busca antes de remover).

- [ ] **Step 3: Remover a rota e o componente antigos**

```bash
git rm src/app/copilot/page.tsx
git rm src/app/documentos/_components/DocumentosCopilot.tsx
```

Se a pasta `src/app/copilot/` ficar vazia após a remoção, remova a pasta também.

- [ ] **Step 4: Verificar manualmente**

Run: `npm run dev`
Expected: `/copilot` deixa de existir no menu; acessar `http://localhost:3000/copilot` diretamente resulta em 404 (comportamento padrão do Next.js para rota removida); o widget aparece em qualquer página autenticada, inclusive `/dashboard` e `/documentos`.

- [ ] **Step 5: Rodar a suíte de testes completa**

Run: `npm test`
Expected: todos os testes passam (nenhuma referência quebrada a `DocumentosCopilot` ou `/copilot`).

- [ ] **Step 6: Commit**

```bash
git add src/components/AppShell.tsx
git commit -m "feat: monta o widget do assistente no AppShell e remove pagina/card antigos"
```

---

### Task 9: Remover o agente antigo específico de documentos

**Files:**
- Delete: `src/lib/documentosCopilotAgent.ts`
- Delete: `src/lib/documentosCopilotAgent.test.ts`
- Delete: `src/app/api/documentos/copilot/route.ts`

**Interfaces:**
- Nenhuma — este código foi inteiramente substituído por `assistenteAgent.ts` + `assistenteDominioDocumentos.ts` + `/api/assistente/chat` (Tasks 4–6). `documentosCopilot.ts` (funções de query/insights) **não** é removido — continua em uso por `assistenteDominioDocumentos.ts`.

- [ ] **Step 1: Confirmar que nada mais referencia os arquivos antigos**

Run: `grep -rn "documentosCopilotAgent\|api/documentos/copilot" src`
Expected: nenhum resultado (fora dos próprios arquivos a remover).

- [ ] **Step 2: Remover os arquivos**

```bash
git rm src/lib/documentosCopilotAgent.ts src/lib/documentosCopilotAgent.test.ts
git rm -r src/app/api/documentos/copilot
```

- [ ] **Step 3: Rodar a suíte de testes completa**

Run: `npm test`
Expected: todos os testes passam.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove o agente de documentos legado, substituido pelo assistente generico"
```

---

## Self-Review

- **Cobertura da spec (Fase 1):** registro de domínios ✅ (Task 5), migração do domínio documentos sem mudar regra de negócio ✅ (Task 4, nota de implementação explícita sobre reaproveitar insights calculados), insights genéricos extraídos ✅ (Task 2 — usados a partir da Fase 2), persistência da conversa (uma linha por usuário, só texto, upsert com trim de 10 mensagens) ✅ (Task 1 e 3), endpoints `historico`/`chat` ✅ (Task 6), widget flutuante global com chips/contexto de rota/ações por item ✅ (Task 7), remoção do card/página antigos ✅ (Task 8), remoção do agente legado ✅ (Task 9).
- **Placeholders:** nenhum "TBD"/"implementar depois" — todo passo tem código completo.
- **Consistência de tipos:** `AssistenteDominio.executarTool` (Task 2) usado identicamente em `assistenteDominioDocumentos.ts` (Task 4) e despachado por nome em `assistenteAgent.ts` (Task 5); `AssistenteResponse` (Task 5) tem exatamente os campos que `AssistenteWidget.tsx` (Task 7) consome (`reply`, `dominio`, `filtrosUrl`, `results`, `insights.totais`); `AssistenteMensagem` (Task 3) é o shape devolvido por `GET /historico` (Task 6) e mapeado pelo widget.
