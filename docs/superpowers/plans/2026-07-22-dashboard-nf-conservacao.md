# Dashboard de acompanhamento de NF por conservadora Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only dashboard inside the Conservação area showing aggregate stats over all notas fiscais already captured by sub-project 1 (cadastro) and classified by sub-project 2 (selo de prazo) — no new API, no new database columns, no chart library.

**Architecture:** A new page fetches the full, unfiltered list from the existing `GET /api/notas-fiscais-conservacao` and computes every aggregate in memory on the client. Visualizations reuse the plain `<div>` + Tailwind bar-chart pattern already used in `/dashboard/analises` (no charting library exists in this project).

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS.

## Global Constraints

- No BTracker-dependent metrics (registrada/não registrada, divergências, tempo médio até registro) — sub-projeto 3 hasn't been built yet; explicitly out of scope, deferred.
- No new npm dependency for charting — this repo has none (`recharts`/`chart.js`/etc. absent from `package.json`); mirror the existing `/dashboard/analises` div-based bar pattern.
- No new API route, no server-side aggregation — everything is computed client-side over the existing `GET /api/notas-fiscais-conservacao` response.
- Access gate: `isAdmin || isAprovadorInterno`, same as the sibling "Notas Fiscais" management page.
- Follow existing code style: no comments unless explaining a non-obvious "why".

---

### Task 1: Add "Dashboard" tab to `ConservacaoSubNav`

**Files:**
- Modify: `src/app/documentos/conservacao/_components/ConservacaoSubNav.tsx`

**Interfaces:**
- Produces: `active="dashboard"` becomes a valid value for `ConservacaoSubNav`'s `active` prop — consumed by Task 2.

- [ ] **Step 1: Update the component**

Replace the entire contents of `src/app/documentos/conservacao/_components/ConservacaoSubNav.tsx` with:

```tsx
"use client";

import Link from "next/link";

type ConservacaoSubNavProps = {
  active: "documentos" | "notas-fiscais" | "dashboard";
};

export function ConservacaoSubNav({ active }: ConservacaoSubNavProps) {
  const tabs: { key: ConservacaoSubNavProps["active"]; label: string; href: string }[] = [
    { key: "documentos", label: "Documentos", href: "/documentos/conservacao" },
    {
      key: "notas-fiscais",
      label: "Notas Fiscais",
      href: "/documentos/conservacao/notas-fiscais",
    },
    {
      key: "dashboard",
      label: "Dashboard",
      href: "/documentos/conservacao/dashboard",
    },
  ];

  return (
    <nav className="flex gap-2 border-b border-slate-200 pb-2">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            active === tab.key
              ? "bg-sky-600 text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Verify with a build**

Run: `npm run build`
Expected: succeeds. Note: this will show a TypeScript error at this point ONLY if some other file passes an `active` value outside the old two-value union — that shouldn't happen, since the two existing callers (`src/app/documentos/conservacao/page.tsx` with `active="documentos"` and `src/app/documentos/conservacao/notas-fiscais/page.tsx` with `active="notas-fiscais"`) both still satisfy the widened union. If the build fails, check those two call sites, but do not modify them — this task only widens the type and adds the third tab.

- [ ] **Step 3: Commit**

```bash
git add src/app/documentos/conservacao/_components/ConservacaoSubNav.tsx
git commit -m "feat(conservacao): adiciona aba Dashboard na sub-navegacao"
```

---

### Task 2: Dashboard page

**Files:**
- Create: `src/app/documentos/conservacao/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /api/notas-fiscais-conservacao` (returns `{ notas: NotaFiscalConservacao[], total: number }`, each nota shaped as below), `ConservacaoSubNav` (Task 1, `active="dashboard"`), `useIsAprovadorInterno` from `@/hooks/useIsAprovadorInterno`, `getSemaforoRecebimentoNota`/`formatCurrencyBRL` from `../../_lib/documentosShared`, `parseCompetencia` from `@/lib/competencia`.

```ts
type NotaFiscalConservacao = {
  id: string;
  prestador_id: string;
  prestador_nome: string;
  loja_id: string;
  loja_nome: string;
  numero_nf: string;
  numero_pedido: string | null;
  valor: number | null;
  competencia: string | null;
  data_recebimento: string;
  observacoes: string | null;
  status: "aguardando_verificacao" | "concluida" | "rejeitada";
  motivo_status: string | null;
  created_at: string;
  arquivo_path: string;
};
```

- [ ] **Step 1: Write the page**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { useIsAprovadorInterno } from "@/hooks/useIsAprovadorInterno";
import {
  getSemaforoRecebimentoNota,
  formatCurrencyBRL,
} from "../../_lib/documentosShared";
import { parseCompetencia } from "@/lib/competencia";
import { ConservacaoSubNav } from "../_components/ConservacaoSubNav";

type NotaFiscalConservacao = {
  id: string;
  prestador_id: string;
  prestador_nome: string;
  loja_id: string;
  loja_nome: string;
  numero_nf: string;
  numero_pedido: string | null;
  valor: number | null;
  competencia: string | null;
  data_recebimento: string;
  observacoes: string | null;
  status: "aguardando_verificacao" | "concluida" | "rejeitada";
  motivo_status: string | null;
  created_at: string;
  arquivo_path: string;
};

const STATUS_LABEL: Record<NotaFiscalConservacao["status"], string> = {
  aguardando_verificacao: "Aguardando verificação",
  concluida: "Concluída",
  rejeitada: "Rejeitada",
};

export default function ConservacaoDashboardPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();
  const { isAprovadorInterno, loading: aprovadorLoading } = useIsAprovadorInterno();
  const canAccess = isAdmin || isAprovadorInterno;

  const [notas, setNotas] = useState<NotaFiscalConservacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
    if (
      !authLoading &&
      user &&
      !accessLoading &&
      !aprovadorLoading &&
      !canAccess
    ) {
      router.replace("/documentos");
    }
  }, [accessLoading, aprovadorLoading, authLoading, canAccess, router, user]);

  const getAccessToken = useCallback(async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const token = data.session?.access_token;
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    return token;
  }, []);

  const carregarNotas = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/notas-fiscais-conservacao", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json()) as {
        notas?: NotaFiscalConservacao[];
        error?: string;
      };
      if (!response.ok || !payload.notas) {
        throw new Error(payload.error ?? "Não foi possível carregar as notas fiscais.");
      }
      setNotas(payload.notas);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível carregar as notas fiscais.",
      );
      setNotas([]);
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, user]);

  useEffect(() => {
    if (user && canAccess) void carregarNotas();
  }, [canAccess, carregarNotas, user]);

  const totalNotas = notas.length;

  const totalPorStatus = useMemo(() => {
    const acc: Record<NotaFiscalConservacao["status"], number> = {
      aguardando_verificacao: 0,
      concluida: 0,
      rejeitada: 0,
    };
    notas.forEach((nota) => {
      acc[nota.status] += 1;
    });
    return acc;
  }, [notas]);

  const valorTotal = useMemo(
    () => notas.reduce((sum, nota) => sum + (nota.valor ?? 0), 0),
    [notas],
  );

  const notasAtrasadas = useMemo(
    () =>
      notas.filter(
        (nota) =>
          getSemaforoRecebimentoNota(nota.data_recebimento, nota.status)?.status ===
          "vermelho",
      ),
    [notas],
  );

  const porConservadora = useMemo(() => {
    const map = new Map<
      string,
      { prestadorNome: string; total: number; valorTotal: number; atrasadas: number }
    >();
    notas.forEach((nota) => {
      const atual = map.get(nota.prestador_id) ?? {
        prestadorNome: nota.prestador_nome,
        total: 0,
        valorTotal: 0,
        atrasadas: 0,
      };
      atual.total += 1;
      atual.valorTotal += nota.valor ?? 0;
      if (
        getSemaforoRecebimentoNota(nota.data_recebimento, nota.status)?.status ===
        "vermelho"
      ) {
        atual.atrasadas += 1;
      }
      map.set(nota.prestador_id, atual);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [notas]);

  const rankingAtrasos = useMemo(
    () =>
      porConservadora
        .filter((item) => item.atrasadas > 0)
        .sort((a, b) => b.atrasadas - a.atrasadas)
        .slice(0, 10),
    [porConservadora],
  );

  const evolucaoMensal = useMemo(() => {
    const map = new Map<string, { ano: string; mes: string; label: string; total: number }>();
    notas.forEach((nota) => {
      const competencia = parseCompetencia(nota.competencia);
      if (!competencia) return;
      const key = `${competencia.ano}-${competencia.mes}`;
      const atual = map.get(key) ?? {
        ano: competencia.ano,
        mes: competencia.mes,
        label: competencia.label,
        total: 0,
      };
      atual.total += 1;
      map.set(key, atual);
    });
    return Array.from(map.values()).sort((a, b) =>
      a.ano === b.ano ? a.mes.localeCompare(b.mes) : a.ano.localeCompare(b.ano),
    );
  }, [notas]);

  const maxEvolucaoMensal = Math.max(1, ...evolucaoMensal.map((item) => item.total));

  if (authLoading || accessLoading || aprovadorLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando dashboard...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => router.back()}
            className="mb-2 text-xs text-slate-500 hover:text-sky-600"
          >
            Voltar
          </button>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Dashboard — Conservação
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Acompanhamento agregado das notas fiscais de empresas conservadoras.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void carregarNotas()}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </header>

      <ConservacaoSubNav active="dashboard" />

      {error && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Carregando dados...
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Total de notas
              </p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{totalNotas}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Valor total
              </p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">
                {formatCurrencyBRL(valorTotal) ?? "R$ 0,00"}
              </p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Notas atrasadas
              </p>
              <p className="mt-3 text-3xl font-semibold text-red-600">
                {notasAtrasadas.length}
              </p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Conservadoras ativas
              </p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">
                {porConservadora.length}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200 lg:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Evolução mensal de envios
              </p>
              {evolucaoMensal.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Sem dados de competência.</p>
              ) : (
                <div className="mt-6 flex items-end gap-3">
                  {evolucaoMensal.map((item) => (
                    <div
                      key={`${item.ano}-${item.mes}`}
                      className="flex flex-1 flex-col items-center"
                    >
                      <div className="flex h-36 w-full items-end rounded-xl bg-slate-100 p-1">
                        <div
                          className="w-full rounded-t-xl bg-gradient-to-t from-sky-500 via-sky-400 to-emerald-400"
                          style={{
                            height: `${Math.round((item.total / maxEvolucaoMensal) * 100)}%`,
                          }}
                        />
                      </div>
                      <p className="mt-2 text-xs font-semibold uppercase text-slate-500">
                        {item.label}
                      </p>
                      <p className="text-[11px] text-slate-400">{item.total} nota(s)</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Distribuição por status
              </p>
              <div className="mt-4 space-y-3">
                {(Object.keys(totalPorStatus) as NotaFiscalConservacao["status"][]).map(
                  (status) => {
                    const total = totalPorStatus[status];
                    const percentual =
                      totalNotas > 0 ? ((total / totalNotas) * 100).toFixed(1) : "0";
                    return (
                      <div key={status}>
                        <div className="flex items-center justify-between text-sm text-slate-600">
                          <span>{STATUS_LABEL[status]}</span>
                          <span className="font-semibold text-slate-900">
                            {total} ({percentual}%)
                          </span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-sky-400"
                            style={{
                              width: totalNotas === 0 ? "0%" : `${(total / totalNotas) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Total por conservadora
              </p>
              {porConservadora.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Nenhuma nota cadastrada.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  {porConservadora.map((item) => (
                    <div
                      key={item.prestadorNome}
                      className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-slate-900">
                        {item.prestadorNome}
                      </span>
                      <span className="text-xs text-slate-500">
                        {item.total} nota(s) · {formatCurrencyBRL(item.valorTotal) ?? "-"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Ranking de atrasos
              </p>
              {rankingAtrasos.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Nenhuma nota atrasada.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  {rankingAtrasos.map((item) => (
                    <div
                      key={item.prestadorNome}
                      className="flex items-center justify-between rounded-xl bg-red-50 px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-slate-900">
                        {item.prestadorNome}
                      </span>
                      <span className="text-xs font-semibold text-red-600">
                        {item.atrasadas} atrasada(s)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify with a build**

Run: `npm run build`
Expected: succeeds with no new TypeScript errors.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, log in as admin. Go to `/documentos/conservacao/dashboard`. Confirm the "Dashboard" tab is highlighted in the sub-nav, the four KPI cards render, and (with the notas created in earlier sub-projects' verification) the numbers match a manual count: total de notas, valor total, notas atrasadas (should match any nota with `data_recebimento` 7+ days ago and `status = aguardando_verificacao`), and "Total por conservadora" lists each distinct prestador with its count and summed valor. Log in as a user who is neither admin nor an aprovador and confirm this route redirects to `/documentos`.

- [ ] **Step 4: Commit**

```bash
git add src/app/documentos/conservacao/dashboard/page.tsx
git commit -m "feat(conservacao): adiciona dashboard de acompanhamento de NF"
```

---

### Task 3: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run
```

Expected: all existing tests still pass (this plan adds no new test files — every new/changed file is a React page or component, consistent with this repo's convention).

- [ ] **Step 2: Run the production build**

```bash
npm run build
```

Expected: succeeds with no TypeScript errors, and the route table includes `/documentos/conservacao/dashboard`.

- [ ] **Step 3: Walk through the spec's test plan manually**

With `npm run dev` running:
1. Com pelo menos duas conservadoras e notas em diferentes status, confirmar que o total geral, a distribuição por status e o total por conservadora batem com a contagem manual dos dados.
2. Criar uma nota com `data_recebimento` de 8+ dias atrás e `status = aguardando_verificacao`: confirmar que ela conta no card "Notas atrasadas" e aparece no ranking de atrasos para o prestador correspondente.
3. Confirmar que a soma de "Valor total" corresponde à soma manual dos valores das notas visíveis.
4. Confirmar que a aba "Dashboard" aparece na sub-navegação e segue a mesma regra de acesso (admin + aprovadores) das demais abas de Conservação.

- [ ] **Step 4: Report results**

No commit for this task — it's verification only.
