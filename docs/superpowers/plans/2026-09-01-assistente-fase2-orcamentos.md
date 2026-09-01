# Assistente virtual — Fase 2: Domínio orçamentos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adiciona o domínio "orçamentos internos" ao assistente virtual (base multi-domínio já entregue na Fase 1), reaproveitando as mesmas regras de acesso e filtros que a tela `/documentos/orcamentos-internos` e a API `GET /api/orcamentos-internos` já implementam.

**Architecture:** Um novo módulo `src/lib/assistenteDominioOrcamentos.ts` implementa a interface `AssistenteDominio` (de `src/lib/assistenteTypes.ts`, Fase 1), com uma tool `buscar_orcamentos` que consulta a tabela `orcamentos_internos` diretamente (não existe uma função de query pronta a reaproveitar, ao contrário de documentos), calcula insights com os helpers genéricos `buildInsightItems`/`buildTrendItems` (`src/lib/assistenteInsights.ts`, Fase 1), e replica o controle de acesso de `assertInternalActor`/`isAprovadorInterno` (`src/lib/orcamentosInternos.ts`). O domínio é registrado no core do agente (`src/lib/assistenteAgent.ts`) e o widget ganha de volta o atalho de Orçamentos.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (`@supabase/supabase-js`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-assistente-virtual-global-design.md` (seção "Fase 2 — Domínio orçamentos")

## Decisões de implementação (não estão explícitas na spec, registradas aqui)

- **`escopo` inválido ou ausente** vindo do modelo é tratado como `"meus"` (silencioso, sem erro) — só `"todos"` pedido por quem não é admin/aprovador gera erro serializado, conforme a spec pede explicitamente para esse caso.
- **Sem filtro nenhum é válido** (diferente de documentos, que exige pelo menos um filtro): perguntar "quais são meus orçamentos" sem mais nada é uma consulta legítima e já delimitada por natureza (`escopo: "meus"` por padrão restringe ao próprio usuário).
- **`filtrosUrl` aponta para `/documentos/orcamentos-internos` sem query params.** Diferente da tela de documentos, essa página **não lê filtros da URL** — todo o estado de filtro é local (`useState`), não `useSearchParams`. Construir uma URL com filtros seria um link que não faz nada além de abrir a tela. O botão "Aplicar na tela" no widget ainda funciona (leva à tela certa), só não pré-filtra. Isso é uma limitação da tela existente, não deste plano — não está no escopo desta fase modificar `orcamentos-internos/page.tsx` para ler a URL.
- **`termo` (busca por texto livre) é um filtro novo** que a tela/API atual não tem — implementado como `ilike` OR em `numero_orcamento`, `descricao`, `prestador_nome`, `loja_nome`, no mesmo espírito do texto livre de documentos.
- **Insights computados sobre até 500 registros** (`ORCAMENTOS_MAX_ROWS`), com `isTruncated` quando o total real excede isso — volume de orçamentos é bem menor que documentos, não precisa do loop de paginação que `queryDocumentoCandidates` usa para chegar a 1000.
- **Resultados exibidos: até 10** (`ORCAMENTO_RESULT_LIMIT`), igual à ideia de amostra limitada de documentos.

## Global Constraints

- Nenhuma tabela ou migração nova — reaproveita `orcamentos_internos` (já existe).
- Controle de acesso replica exatamente `assertInternalActor`: admin ou usuário com `getGerenteAccessEntries` não vazio → acesso interno; usuário só com `getAuthorizedPrestadorIds` não vazio (fornecedor externo) → **sem acesso ao domínio** (`podeAcessar` retorna `false`, o domínio inteiro some do agente pra esse usuário — nem tools nem prompt); qualquer outro → acesso interno normal.
- `escopo: "todos"` só é aceito de quem é admin ou está em `isAprovadorInterno(email)` — caso contrário, erro serializado orientando a usar `"meus"`, sem rodar a query.
- Fora de escopo (reforçado no prompt, herdado da regra geral do agente): nunca propor aprovar/rejeitar/enviar orçamento — só buscar e explicar.

---

### Task 1: Domínio orçamentos (`assistenteDominioOrcamentos.ts`)

**Files:**
- Create: `src/lib/assistenteDominioOrcamentos.ts`
- Test: `src/lib/assistenteDominioOrcamentos.test.ts`

**Interfaces:**
- Consumes: `AssistenteDominio`, `AssistenteContext`, `AssistenteInsights`, `AssistenteResultItem`, `AssistenteSearchOutcome`, `AssistenteToolResult` de `assistenteTypes.ts` (Fase 1); `buildInsightItems`, `buildTrendItems` de `assistenteInsights.ts` (Fase 1); `getAuthorizedPrestadorIds`, `getGerenteAccessEntries` de `apiAuth.ts`; `isAprovadorInterno`, `DECISAO_STATUS`, `normalizeEmail`, `parseValorTotal`, type `OrcamentoInternoStatus` de `orcamentosInternos.ts`; `ORCAMENTO_INTERNO_STATUSES`, `STATUS_LABEL` de `orcamentosInternosShared.ts`; `formatCurrencyBRL` de `documentosApiUtils.ts`.
- Produces: `dominioOrcamentos: AssistenteDominio` (`id: "orcamentos"`), consumido por `assistenteAgent.ts` (Task 2).

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/lib/assistenteDominioOrcamentos.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiAuth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/apiAuth")>("@/lib/apiAuth");
  return {
    ...actual,
    getAuthorizedPrestadorIds: vi.fn(async () => []),
    getGerenteAccessEntries: vi.fn(async () => []),
  };
});
vi.mock("@/lib/orcamentosInternos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/orcamentosInternos")>(
    "@/lib/orcamentosInternos",
  );
  return { ...actual, isAprovadorInterno: vi.fn(async () => false) };
});

import { getAuthorizedPrestadorIds, getGerenteAccessEntries } from "@/lib/apiAuth";
import { isAprovadorInterno } from "@/lib/orcamentosInternos";
import { dominioOrcamentos } from "@/lib/assistenteDominioOrcamentos";
import type { AssistenteContext } from "@/lib/assistenteTypes";

const mockedPrestadores = vi.mocked(getAuthorizedPrestadorIds);
const mockedGerente = vi.mocked(getGerenteAccessEntries);
const mockedAprovador = vi.mocked(isAprovadorInterno);

type FakeCall = { method: string; args: unknown[] };

function makeFakeQuery(result: { data: unknown[]; error: null; count: number }) {
  const calls: FakeCall[] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["select", "eq", "in", "gte", "lte", "or", "order"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.range = async () => result;
  return { builder, calls };
}

function makeCtx(overrides: Partial<AssistenteContext> = {}): {
  ctx: AssistenteContext;
  fromSpy: ReturnType<typeof vi.fn>;
  calls: FakeCall[];
} {
  const { builder, calls } = makeFakeQuery({ data: [], error: null, count: 0 });
  const fromSpy = vi.fn(() => builder);
  const ctx: AssistenteContext = {
    supabaseAdmin: { from: fromSpy } as never,
    userId: "user-1",
    email: "user@empresa.com",
    isAdmin: false,
    cache: new Map(),
    ...overrides,
  };
  return { ctx, fromSpy, calls };
}

beforeEach(() => {
  mockedPrestadores.mockReset().mockResolvedValue([]);
  mockedGerente.mockReset().mockResolvedValue([]);
  mockedAprovador.mockReset().mockResolvedValue(false);
});

describe("dominioOrcamentos.podeAcessar", () => {
  it("nega acesso a fornecedor externo (so tem prestador, sem gerente/admin)", async () => {
    mockedPrestadores.mockResolvedValueOnce(["prestador-1"]);
    const { ctx } = makeCtx();
    await expect(dominioOrcamentos.podeAcessar(ctx)).resolves.toBe(false);
  });

  it("permite acesso a colaborador interno comum (sem prestador nem gerente)", async () => {
    const { ctx } = makeCtx();
    await expect(dominioOrcamentos.podeAcessar(ctx)).resolves.toBe(true);
  });

  it("permite acesso a quem tem escopo de gerente", async () => {
    mockedGerente.mockResolvedValueOnce([
      { loja_id: "loja-1", prestador_id: null, can_view_all: false },
    ]);
    const { ctx } = makeCtx();
    await expect(dominioOrcamentos.podeAcessar(ctx)).resolves.toBe(true);
  });

  it("permite acesso a admin mesmo com prestador vinculado", async () => {
    mockedPrestadores.mockResolvedValueOnce(["prestador-1"]);
    const { ctx } = makeCtx({ isAdmin: true });
    await expect(dominioOrcamentos.podeAcessar(ctx)).resolves.toBe(true);
  });
});

describe("dominioOrcamentos.executarTool buscar_orcamentos", () => {
  it("usuario comum nunca recebe resultado de outro solicitante mesmo pedindo escopo todos", async () => {
    const { ctx, fromSpy } = makeCtx();
    const result = await dominioOrcamentos.executarTool("buscar_orcamentos", { escopo: "todos" }, ctx);
    expect(fromSpy).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toHaveProperty("erro");
    expect(result.outcome).toBeUndefined();
  });

  it("escopo padrao 'meus' restringe por solicitante_id mesmo sem pedir explicitamente", async () => {
    const { ctx, calls } = makeCtx();
    await dominioOrcamentos.executarTool("buscar_orcamentos", {}, ctx);
    const eqSolicitante = calls.filter(
      (c) => c.method === "eq" && c.args[0] === "solicitante_id" && c.args[1] === "user-1",
    );
    expect(eqSolicitante.length).toBeGreaterThan(0);
  });

  it("rejeita status invalido sem rodar a query", async () => {
    const { ctx, fromSpy } = makeCtx();
    const result = await dominioOrcamentos.executarTool(
      "buscar_orcamentos",
      { status: "nao_existe" },
      ctx,
    );
    expect(fromSpy).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toHaveProperty("erro");
  });

  it("aplica filtros de valor e data corretamente", async () => {
    const { ctx, calls } = makeCtx();
    await dominioOrcamentos.executarTool(
      "buscar_orcamentos",
      { valorMin: "100", valorMax: 500, dataInicio: "2026-01-01", dataFim: "2026-01-31" },
      ctx,
    );
    expect(calls).toContainEqual({ method: "gte", args: ["valor_total", 100] });
    expect(calls).toContainEqual({ method: "lte", args: ["valor_total", 500] });
    expect(calls).toContainEqual({ method: "gte", args: ["created_at", "2026-01-01"] });
    expect(calls).toContainEqual({ method: "lte", args: ["created_at", "2026-01-31T23:59:59"] });
  });

  it("retorna insights com soma de valor_total e mapeia resultados", async () => {
    const { builder, calls } = makeFakeQuery({
      data: [
        {
          id: "orc-1",
          numero_orcamento: "ORC-10",
          prestador_nome: "Fornecedor Teste",
          loja_id: "loja-1",
          loja_nome: "Loja 1",
          status: "aguardando_aprovacao",
          valor_total: 150.5,
          created_at: "2026-01-05T00:00:00.000Z",
          arquivo_original_path: "orc/original.pdf",
          arquivo_assinado_path: null,
          solicitante_id: "user-1",
          gestor_email: "gestor@empresa.com",
        },
      ],
      error: null,
      count: 1,
    });
    const fromSpy = vi.fn(() => builder);
    const ctx: AssistenteContext = {
      supabaseAdmin: { from: fromSpy } as never,
      userId: "user-1",
      email: "user@empresa.com",
      isAdmin: false,
      cache: new Map(),
    };

    const result = await dominioOrcamentos.executarTool("buscar_orcamentos", {}, ctx);

    expect(result.outcome).toBeDefined();
    const outcome = result.outcome!;
    expect(outcome.dominio).toBe("orcamentos");
    expect(outcome.total).toBe(1);
    expect(outcome.results).toEqual([
      {
        id: "orc-1",
        titulo: "ORC-10 — Fornecedor Teste",
        subtitulo: expect.stringContaining("Aguardando aprovação"),
        abrirArquivoPath: "orc/original.pdf",
      },
    ]);
    expect(outcome.insights.totais).toEqual(
      expect.arrayContaining([{ key: "valorTotal", label: "Valor total", valor: 150.5 }]),
    );
    void calls;
  });
});

describe("dominioOrcamentos.descricaoPrompt", () => {
  it("inclui os filtros atuais da tela quando o dominio do contexto e orcamentos", () => {
    const { ctx } = makeCtx({
      currentContext: { dominio: "orcamentos", filtros: { status: "rascunho" } },
    });
    const prompt = dominioOrcamentos.descricaoPrompt(ctx);
    expect(prompt).toContain("rascunho");
  });

  it("nao inclui filtros quando o contexto e de outro dominio", () => {
    const { ctx } = makeCtx({
      currentContext: { dominio: "documentos", filtros: { status: "pendente" } },
    });
    const prompt = dominioOrcamentos.descricaoPrompt(ctx);
    expect(prompt).not.toContain("pendente");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/assistenteDominioOrcamentos.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `assistenteDominioOrcamentos.ts`**

```ts
import type { AzureOpenAiTool } from "@/lib/azureOpenAi";
import {
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
} from "@/lib/apiAuth";
import {
  DECISAO_STATUS,
  isAprovadorInterno,
  normalizeEmail,
  parseValorTotal,
  type OrcamentoInternoStatus,
} from "@/lib/orcamentosInternos";
import {
  ORCAMENTO_INTERNO_STATUSES,
  STATUS_LABEL,
} from "@/lib/orcamentosInternosShared";
import { formatCurrencyBRL } from "@/lib/documentosApiUtils";
import { buildInsightItems, buildTrendItems } from "@/lib/assistenteInsights";
import type {
  AssistenteContext,
  AssistenteDominio,
  AssistenteInsights,
  AssistenteResultItem,
  AssistenteSearchOutcome,
  AssistenteToolResult,
} from "@/lib/assistenteTypes";

const ORCAMENTOS_MAX_ROWS = 500;
const ORCAMENTO_RESULT_LIMIT = 10;

const TOOLS: AzureOpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "buscar_orcamentos",
      description:
        "Busca orcamentos internos aplicando os filtros informados. Use depois de resolver lojaId/prestadorId com buscar_lojas/buscar_prestadores quando o usuario mencionar uma loja ou prestador.",
      parameters: {
        type: "object",
        properties: {
          termo: {
            type: "string",
            description: "Trecho de texto livre (numero do orcamento, descricao, prestador ou loja)",
          },
          status: { type: "string", enum: [...ORCAMENTO_INTERNO_STATUSES] },
          lojaId: { type: "string", description: "ID exato da loja, obtido via buscar_lojas" },
          prestadorId: { type: "string", description: "ID exato do prestador, obtido via buscar_prestadores" },
          gestorEmail: { type: "string", description: "E-mail do gestor responsavel pela aprovacao" },
          dataInicio: { type: "string", description: "Data inicial no formato AAAA-MM-DD" },
          dataFim: { type: "string", description: "Data final no formato AAAA-MM-DD" },
          valorMin: { type: "number", description: "Valor minimo do orcamento" },
          valorMax: { type: "number", description: "Valor maximo do orcamento" },
          escopo: {
            type: "string",
            enum: ["meus", "aprovacao", "todos"],
            description:
              "meus = so os do proprio usuario (padrao); aprovacao = pendentes de decisao; todos = todos os orcamentos, restrito a administradores e aprovadores",
          },
        },
        required: [],
      },
    },
  },
];

type OrcamentosAccessInfo = { podeVerTudo: boolean; isInternal: boolean };

async function getOrcamentosAccessInfo(ctx: AssistenteContext): Promise<OrcamentosAccessInfo> {
  const cacheKey = "orcamentos:access";
  if (ctx.cache.has(cacheKey)) {
    return ctx.cache.get(cacheKey) as OrcamentosAccessInfo;
  }
  const [prestadores, gerenteEntries, isAprovador] = await Promise.all([
    getAuthorizedPrestadorIds(ctx.email, ctx.supabaseAdmin),
    getGerenteAccessEntries(ctx.userId, ctx.email, ctx.supabaseAdmin),
    isAprovadorInterno(ctx.email, ctx.supabaseAdmin),
  ]);
  const isFornecedorExterno = !ctx.isAdmin && gerenteEntries.length === 0 && prestadores.length > 0;
  const info: OrcamentosAccessInfo = {
    isInternal: !isFornecedorExterno,
    podeVerTudo: ctx.isAdmin || isAprovador,
  };
  ctx.cache.set(cacheKey, info);
  return info;
}

type OrcamentosFiltros = {
  escopo: "meus" | "aprovacao" | "todos";
  status?: OrcamentoInternoStatus;
  lojaId?: string;
  prestadorId?: string;
  gestorEmail?: string;
  dataInicio?: string;
  dataFim?: string;
  valorMin?: number;
  valorMax?: number;
  termo?: string;
};

type OrcamentoRow = {
  id: string;
  numero_orcamento: string;
  prestador_nome: string;
  loja_id: string | null;
  loja_nome: string | null;
  status: OrcamentoInternoStatus;
  valor_total: number | string | null;
  created_at: string;
  arquivo_original_path: string;
  arquivo_assinado_path: string | null;
  solicitante_id: string;
  gestor_email: string;
};

const sanitizeTermo = (termo: string) =>
  termo.replace(/[,()%]/g, " ").replace(/\s+/g, " ").trim();

function buildOrcamentosQuery(
  supabaseAdmin: AssistenteContext["supabaseAdmin"],
  filters: OrcamentosFiltros,
  info: { userId: string; podeVerTudo: boolean },
) {
  let query = supabaseAdmin
    .from("orcamentos_internos")
    .select(
      "id,numero_orcamento,prestador_nome,loja_id,loja_nome,status,valor_total,created_at,arquivo_original_path,arquivo_assinado_path,solicitante_id,gestor_email",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (!info.podeVerTudo) {
    query = query.eq("solicitante_id", info.userId);
  }
  if (filters.escopo === "meus") {
    query = query.eq("solicitante_id", info.userId);
  } else if (filters.escopo === "aprovacao") {
    query = query.in("status", ["aguardando_aprovacao", "em_analise_gestor", "reenviado"]);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.lojaId) {
    query = query.eq("loja_id", filters.lojaId);
  }
  if (filters.prestadorId) {
    query = query.eq("prestador_id", filters.prestadorId);
  }
  if (filters.gestorEmail) {
    query = query.eq("gestor_email", filters.gestorEmail);
  }
  if (filters.dataInicio) {
    query = query.gte("created_at", filters.dataInicio);
  }
  if (filters.dataFim) {
    query = query.lte("created_at", `${filters.dataFim}T23:59:59`);
  }
  if (filters.valorMin !== undefined) {
    query = query.gte("valor_total", filters.valorMin);
  }
  if (filters.valorMax !== undefined) {
    query = query.lte("valor_total", filters.valorMax);
  }
  if (filters.termo) {
    const termo = sanitizeTermo(filters.termo);
    query = query.or(
      `numero_orcamento.ilike.%${termo}%,descricao.ilike.%${termo}%,prestador_nome.ilike.%${termo}%,loja_nome.ilike.%${termo}%`,
    );
  }
  return query;
}

function buildOrcamentosSummary(filters: OrcamentosFiltros): string {
  const partes: string[] = [];
  if (filters.status) partes.push(`status ${STATUS_LABEL[filters.status] ?? filters.status}`);
  if (filters.lojaId) partes.push(`loja ${filters.lojaId}`);
  if (filters.prestadorId) partes.push(`prestador ${filters.prestadorId}`);
  if (filters.gestorEmail) partes.push(`gestor ${filters.gestorEmail}`);
  if (filters.dataInicio) partes.push(`a partir de ${filters.dataInicio}`);
  if (filters.dataFim) partes.push(`até ${filters.dataFim}`);
  if (filters.valorMin !== undefined) partes.push(`valor mínimo ${filters.valorMin}`);
  if (filters.valorMax !== undefined) partes.push(`valor máximo ${filters.valorMax}`);
  if (filters.termo) partes.push(`termo "${filters.termo}"`);
  partes.push(`escopo ${filters.escopo}`);
  return `Critérios usados: ${partes.join(", ")}.`;
}

function buildResultItem(row: OrcamentoRow): AssistenteResultItem {
  const valor = Number(row.valor_total) || 0;
  return {
    id: row.id,
    titulo: `${row.numero_orcamento} — ${row.prestador_nome}`,
    subtitulo: `${STATUS_LABEL[row.status] ?? row.status} · ${formatCurrencyBRL(valor) ?? "sem valor"}`,
    abrirArquivoPath: row.arquivo_assinado_path ?? row.arquivo_original_path,
  };
}

function buildObservacoes(input: {
  total: number;
  valorTotalSoma: number;
  isTruncated: boolean;
}): string[] {
  const frases: string[] = [];
  if (input.total > 0) {
    frases.push(`Foram encontrados ${input.total} orçamento(s) nesta leitura.`);
    frases.push(`Valor total somado: ${formatCurrencyBRL(input.valorTotalSoma)}.`);
  }
  if (input.isTruncated) {
    frases.push(`A análise considera no máximo ${ORCAMENTOS_MAX_ROWS} registros por consulta.`);
  }
  return frases;
}

async function executarBuscarOrcamentos(
  args: Record<string, unknown>,
  ctx: AssistenteContext,
): Promise<AssistenteToolResult> {
  const { podeVerTudo } = await getOrcamentosAccessInfo(ctx);

  const escopoRaw = typeof args.escopo === "string" ? args.escopo : "meus";
  const escopo: "meus" | "aprovacao" | "todos" =
    escopoRaw === "aprovacao" || escopoRaw === "todos" ? escopoRaw : "meus";

  if (escopo === "todos" && !podeVerTudo) {
    return {
      content: JSON.stringify({
        erro: "Escopo 'todos' é restrito a administradores e aprovadores. Tente novamente com escopo 'meus'.",
      }),
    };
  }

  let status: OrcamentoInternoStatus | undefined;
  if (typeof args.status === "string" && args.status.trim()) {
    const statusTrim = args.status.trim();
    if (!(ORCAMENTO_INTERNO_STATUSES as readonly string[]).includes(statusTrim)) {
      return {
        content: JSON.stringify({
          erro: `Status inválido. Valores válidos: ${ORCAMENTO_INTERNO_STATUSES.join(", ")}.`,
        }),
      };
    }
    status = statusTrim as OrcamentoInternoStatus;
  }

  const filters: OrcamentosFiltros = {
    escopo,
    status,
    lojaId: typeof args.lojaId === "string" ? args.lojaId.trim() || undefined : undefined,
    prestadorId: typeof args.prestadorId === "string" ? args.prestadorId.trim() || undefined : undefined,
    gestorEmail: normalizeEmail(typeof args.gestorEmail === "string" ? args.gestorEmail : null) ?? undefined,
    dataInicio: typeof args.dataInicio === "string" ? args.dataInicio.trim() || undefined : undefined,
    dataFim: typeof args.dataFim === "string" ? args.dataFim.trim() || undefined : undefined,
    valorMin: parseValorTotal(args.valorMin) ?? undefined,
    valorMax: parseValorTotal(args.valorMax) ?? undefined,
    termo: typeof args.termo === "string" ? args.termo.trim() || undefined : undefined,
  };

  const query = buildOrcamentosQuery(ctx.supabaseAdmin, filters, {
    userId: ctx.userId,
    podeVerTudo,
  });
  const { data, error, count } = await query.range(0, ORCAMENTOS_MAX_ROWS - 1);
  if (error) {
    throw error;
  }

  const rows = (data ?? []) as OrcamentoRow[];
  const total = count ?? rows.length;
  const isTruncated = total > ORCAMENTOS_MAX_ROWS;

  const porStatus = buildInsightItems(
    rows,
    (r) => r.status,
    (r) => STATUS_LABEL[r.status] ?? r.status,
    rows.length,
    4,
  );
  const porLoja = buildInsightItems(
    rows,
    (r) => r.loja_id ?? r.loja_nome ?? null,
    (r) => r.loja_nome?.trim() || r.loja_id?.trim() || "Sem loja vinculada",
    rows.length,
    5,
  );
  const tendenciaMensal = buildTrendItems(rows, (r) => r.created_at, 6);
  const valorTotalSoma = rows.reduce((acc, r) => acc + (Number(r.valor_total) || 0), 0);
  const totalAguardando = rows.filter((r) => DECISAO_STATUS.has(r.status)).length;
  const totalAprovados = rows.filter((r) => r.status === "aprovado_assinado").length;

  const insights: AssistenteInsights = {
    totais: [
      { key: "totalOrcamentos", label: "Orçamentos", valor: total },
      { key: "totalAguardandoAprovacao", label: "Aguardando aprovação", valor: totalAguardando },
      { key: "totalAprovados", label: "Aprovados", valor: totalAprovados },
      { key: "valorTotal", label: "Valor total", valor: Number(valorTotalSoma.toFixed(2)) },
    ],
    isTruncated,
    porStatus,
    porLoja,
    tendenciaMensal,
    observacoes: buildObservacoes({ total, valorTotalSoma, isTruncated }),
  };

  const outcome: AssistenteSearchOutcome = {
    dominio: "orcamentos",
    filters: filters as unknown as Record<string, unknown>,
    filtrosUrl: "/documentos/orcamentos-internos",
    summary: buildOrcamentosSummary(filters),
    results: rows.slice(0, ORCAMENTO_RESULT_LIMIT).map(buildResultItem),
    total,
    insights,
  };

  const resumoParaModelo = {
    filtrosAplicados: filters,
    total,
    amostra: rows.slice(0, 5).map((r) => ({
      id: r.id,
      numero_orcamento: r.numero_orcamento,
      prestador_nome: r.prestador_nome,
      status: r.status,
      valor_total: r.valor_total,
      loja_nome: r.loja_nome,
      created_at: r.created_at,
    })),
    porStatus,
    porLoja,
  };

  return { content: JSON.stringify(resumoParaModelo), outcome };
}

export const dominioOrcamentos: AssistenteDominio = {
  id: "orcamentos",
  tools: TOOLS,
  podeAcessar: async (ctx) => (await getOrcamentosAccessInfo(ctx)).isInternal,
  descricaoPrompt: (ctx) => {
    const partes = [
      "Para o domínio de orçamentos internos, você tem a ferramenta buscar_orcamentos, além de buscar_lojas e buscar_prestadores (compartilhadas entre domínios).",
      "Por padrão, escopo é 'meus' (só os orçamentos do próprio usuário). Use escopo 'aprovacao' para pendentes de decisão, e 'todos' só se o usuário pedir claramente ver de todo mundo — isso só funciona para administradores e aprovadores; se der erro, explique a restrição e tente de novo com 'meus'.",
      "Se o usuário mencionar uma loja ou prestador por nome, apelido ou código (mesmo parcial), chame buscar_lojas ou buscar_prestadores primeiro para descobrir o ID exato — nunca invente um ID.",
      `Valores válidos de status: ${ORCAMENTO_INTERNO_STATUSES.join(", ")}.`,
    ];
    if (ctx.currentContext?.dominio === "orcamentos" && Object.keys(ctx.currentContext.filtros).length > 0) {
      partes.push(
        `A tela do usuário já está com estes filtros aplicados (contexto, não obrigação de usar): ${JSON.stringify(ctx.currentContext.filtros)}.`,
      );
    }
    return partes.join(" ");
  },
  executarTool: async (nome, args, ctx) => {
    if (nome === "buscar_orcamentos") {
      return executarBuscarOrcamentos(args, ctx);
    }
    return { content: JSON.stringify({ erro: `Ferramenta desconhecida: ${nome}` }) };
  },
};
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/assistenteDominioOrcamentos.test.ts`
Expected: PASS (11 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistenteDominioOrcamentos.ts src/lib/assistenteDominioOrcamentos.test.ts
git commit -m "feat: adiciona dominio orcamentos ao assistente virtual"
```

---

### Task 2: Registrar o domínio e reativar o atalho no widget

**Files:**
- Modify: `src/lib/assistenteAgent.ts`
- Modify: `src/components/AssistenteWidget.tsx`

**Interfaces:**
- Consumes: `dominioOrcamentos` de `assistenteDominioOrcamentos.ts` (Task 1).

- [ ] **Step 1: Registrar o domínio no core do agente**

Em `src/lib/assistenteAgent.ts`, adicionar o import e incluir o domínio no array padrão:

```ts
import { dominioOrcamentos } from "@/lib/assistenteDominioOrcamentos";
```

```ts
const DOMINIOS_REGISTRADOS: AssistenteDominio[] = [dominioDocumentos, dominioOrcamentos];
```

- [ ] **Step 2: Reativar o chip de Orçamentos no widget**

Em `src/components/AssistenteWidget.tsx`, o array `CHIPS` hoje tem só a entrada de Documentos (reduzido na Fase 1 porque orçamentos ainda não existia). Adicionar de volta:

```ts
const CHIPS: { dominio: AssistenteDominioId; label: string; pergunta: string }[] = [
  { dominio: "documentos", label: "Documentos", pergunta: "Buscar documentos" },
  { dominio: "orcamentos", label: "Orçamentos", pergunta: "Consultar meus orçamentos" },
];
```

(O `ROUTE_DOMINIO` de detecção de contexto por rota já inclui `/documentos/orcamentos-internos` desde a Fase 1 — nenhuma mudança necessária ali.)

- [ ] **Step 3: Rodar a suíte de testes completa**

Run: `npm test`
Expected: todos os testes passam (nenhuma regressão nos testes existentes do agente/widget).

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: limpo.

- [ ] **Step 5: Verificar manualmente**

Run: `npm run dev`, logado como um usuário com acesso a orçamentos internos (colaborador interno, não fornecedor externo).
Expected: abrir o widget mostra os chips "Documentos" e "Orçamentos"; clicar em "Orçamentos" preenche "Consultar meus orçamentos"; enviar retorna uma resposta com os orçamentos do usuário (ou "não encontrei" se não houver nenhum) e, se houver resultados, os cards de insight (Orçamentos/Aguardando aprovação/Aprovados/Valor total) e a lista de resultados com botão "Ver arquivo".

- [ ] **Step 6: Commit**

```bash
git add src/lib/assistenteAgent.ts src/components/AssistenteWidget.tsx
git commit -m "feat: registra o dominio orcamentos no agente e no widget"
```

---

## Self-Review

- **Cobertura da spec (Fase 2):** tool `buscar_orcamentos` com todos os parâmetros especificados ✅; controle de acesso replicando `assertInternalActor`/`isAprovadorInterno` ✅ (domínio inteiro oculto para fornecedor externo; `escopo: "todos"` bloqueado para não admin/aprovador); reaproveitamento de `buscar_lojas`/`buscar_prestadores` (já compartilhados, nenhuma mudança necessária) ✅; insights via `assistenteInsights.ts` com soma de valor extra ✅; resultado com título/subtítulo/link conforme especificado (com a ressalva documentada sobre `filtrosUrl` sem query params, já que a tela não os lê) ✅; testes cobrindo os três cenários pedidos pela spec (escopo "todos" bloqueado, filtros de valor/data, insights com soma) ✅.
- **Placeholders:** nenhum — todo passo tem código completo.
- **Consistência de tipos:** `dominioOrcamentos: AssistenteDominio` usa exatamente os tipos de `assistenteTypes.ts` (Fase 1) sem redefinir nada; `AssistenteResultItem`/`AssistenteSearchOutcome`/`AssistenteInsights` usados com os mesmos nomes de campo que `assistenteAgent.ts` e `AssistenteWidget.tsx` já consomem — nenhuma mudança nesses dois arquivos além do registro do domínio e do chip.
