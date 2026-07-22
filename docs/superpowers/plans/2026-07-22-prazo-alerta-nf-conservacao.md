# Selo de prazo (7 dias) para NF de conservadora Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a visual deadline badge ("Dentro do prazo" / "Atenção" / "Atrasada") on each nota fiscal still `aguardando_verificacao` in the Conservação "Notas Fiscais" management page, computed from `data_recebimento` — no database change, no email, no cron.

**Architecture:** A pure client-side helper mirrors the existing `getSemaforoVencimento` pattern already used for Contratos, reusing the same `SemaforoStatus` type and `SEMAFORO_BADGE` style map. Wired into the already-existing management table from sub-project 1 as one new column.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS.

## Global Constraints

- No database migration, no new API route, no email/notification of any kind — the badge is purely a derived display value.
- The badge only applies to notas with `status === "aguardando_verificacao"`; `concluida`/`rejeitada` notas show no badge ("-").
- Thresholds: 0–3 days since `data_recebimento` → verde "Dentro do prazo"; 4–6 days → amarelo "Atenção"; 7+ days → vermelho "Atrasada".
- Follow existing code style: no comments unless explaining a non-obvious "why". The sibling function `getSemaforoVencimento` in the same file has no unit test — this new function follows the same (untested) convention, since it also lives in `documentosShared.ts`, which cannot be unit-tested directly (it imports `@/lib/supabaseClient`, which throws under vitest without env vars — confirmed earlier in this project).

---

### Task 1: Add `getSemaforoRecebimentoNota` helper

**Files:**
- Modify: `src/app/documentos/_lib/documentosShared.ts`

**Interfaces:**
- Consumes: existing `SemaforoStatus` type and nothing else new.
- Produces: `getSemaforoRecebimentoNota(dataRecebimento: string | null, status: string): { status: SemaforoStatus; label: string } | null` — consumed by Task 2.

- [ ] **Step 1: Add the function**

In `src/app/documentos/_lib/documentosShared.ts`, find:

```ts
export const getSemaforoVencimento = (
  dataVencimento: string | null,
): { status: SemaforoStatus; label: string } => {
  if (!dataVencimento) {
    return { status: "indefinido", label: "Sem data" };
  }
  const vencimento = new Date(`${dataVencimento}T00:00:00`);
  if (Number.isNaN(vencimento.getTime())) {
    return { status: "indefinido", label: "Sem data" };
  }
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dias = Math.ceil((vencimento.getTime() - hoje.getTime()) / 86400000);
  if (dias < 0) {
    return { status: "vermelho", label: `Vencido há ${Math.abs(dias)}d` };
  }
  if (dias <= 14) {
    return {
      status: "vermelho",
      label: dias === 0 ? "Vence hoje" : `Vence em ${dias}d`,
    };
  }
  if (dias <= 60) {
    return { status: "amarelo", label: `Vence em ${dias}d` };
  }
  return { status: "verde", label: "Em dia" };
};
```

Add this new function right after it (after the closing `};`):

```ts
export const getSemaforoRecebimentoNota = (
  dataRecebimento: string | null,
  status: string,
): { status: SemaforoStatus; label: string } | null => {
  if (status !== "aguardando_verificacao") {
    return null;
  }
  if (!dataRecebimento) {
    return { status: "indefinido", label: "Sem data" };
  }
  const recebimento = new Date(`${dataRecebimento}T00:00:00`);
  if (Number.isNaN(recebimento.getTime())) {
    return { status: "indefinido", label: "Sem data" };
  }
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dias = Math.floor((hoje.getTime() - recebimento.getTime()) / 86400000);
  if (dias <= 3) {
    return { status: "verde", label: "Dentro do prazo" };
  }
  if (dias <= 6) {
    return { status: "amarelo", label: "Atenção" };
  }
  return { status: "vermelho", label: "Atrasada" };
};
```

- [ ] **Step 2: Verify with a build**

Run: `npm run build`
Expected: succeeds with no new TypeScript errors.

- [ ] **Step 3: Hand-trace (no automated test — see Global Constraints)**

Document in your report, computed by hand from the code above:
- `getSemaforoRecebimentoNota("2026-07-22", "aguardando_verificacao")` called on 2026-07-22 → `dias = 0` → `{ status: "verde", label: "Dentro do prazo" }`.
- `getSemaforoRecebimentoNota("2026-07-17", "aguardando_verificacao")` called on 2026-07-22 → `dias = 5` → `{ status: "amarelo", label: "Atenção" }`.
- `getSemaforoRecebimentoNota("2026-07-10", "aguardando_verificacao")` called on 2026-07-22 → `dias = 12` → `{ status: "vermelho", label: "Atrasada" }`.
- `getSemaforoRecebimentoNota("2026-07-10", "concluida")` → `null` (status check short-circuits before any date math).

- [ ] **Step 4: Commit**

```bash
git add src/app/documentos/_lib/documentosShared.ts
git commit -m "feat(conservacao): adiciona selo de prazo de recebimento (getSemaforoRecebimentoNota)"
```

---

### Task 2: Add "Prazo" column to the management table

**Files:**
- Modify: `src/app/documentos/conservacao/notas-fiscais/page.tsx`

**Interfaces:**
- Consumes: `getSemaforoRecebimentoNota`, `SEMAFORO_BADGE` from `../../_lib/documentosShared` (Task 1 for the former, already-exported for the latter).

- [ ] **Step 1: Update the import**

Find:

```ts
import {
  getSignedFileUrl,
  resolveSignedPdfPath,
  formatCurrencyBRL,
} from "../../_lib/documentosShared";
```

Replace with:

```ts
import {
  getSignedFileUrl,
  resolveSignedPdfPath,
  formatCurrencyBRL,
  getSemaforoRecebimentoNota,
  SEMAFORO_BADGE,
} from "../../_lib/documentosShared";
```

- [ ] **Step 2: Add the table header**

Find:

```tsx
                  <th className="px-4 py-3">Competência</th>
                  <th className="px-4 py-3">Status</th>
```

Replace with:

```tsx
                  <th className="px-4 py-3">Competência</th>
                  <th className="px-4 py-3">Prazo</th>
                  <th className="px-4 py-3">Status</th>
```

- [ ] **Step 3: Add the table cell**

Find:

```tsx
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {nota.competencia ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGE[nota.status]}`}
                      >
                        {STATUS_LABEL[nota.status]}
                      </span>
```

Replace with:

```tsx
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {nota.competencia ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const semaforo = getSemaforoRecebimentoNota(
                          nota.data_recebimento,
                          nota.status,
                        );
                        if (!semaforo) {
                          return <span className="text-xs text-slate-400">-</span>;
                        }
                        return (
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${SEMAFORO_BADGE[semaforo.status]}`}
                          >
                            {semaforo.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGE[nota.status]}`}
                      >
                        {STATUS_LABEL[nota.status]}
                      </span>
```

- [ ] **Step 4: Verify with a build**

Run: `npm run build`
Expected: succeeds with no new TypeScript errors.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, log in as admin, go to `/documentos/conservacao/notas-fiscais`. For a nota with `status = aguardando_verificacao` and `data_recebimento` set to today, confirm the "Prazo" column shows a green "Dentro do prazo" badge. For a `concluida` or `rejeitada` nota, confirm the column shows "-".

- [ ] **Step 6: Commit**

```bash
git add src/app/documentos/conservacao/notas-fiscais/page.tsx
git commit -m "feat(conservacao): adiciona coluna Prazo na gestao de notas fiscais"
```

---

### Task 3: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run
```

Expected: all existing tests still pass (this plan adds no new test files, consistent with the untested sibling `getSemaforoVencimento` — see Global Constraints).

- [ ] **Step 2: Run the production build**

```bash
npm run build
```

Expected: succeeds with no TypeScript errors.

- [ ] **Step 3: Walk through the spec's test plan manually**

With `npm run dev` running:
1. Nota com `data_recebimento` de hoje e `status = aguardando_verificacao`: selo verde "Dentro do prazo".
2. Nota com `data_recebimento` de 5 dias atrás: selo amarelo "Atenção".
3. Nota com `data_recebimento` de 8 dias atrás: selo vermelho "Atrasada".
4. Nota com `status = concluida` (qualquer data): sem selo, célula mostra "-".

- [ ] **Step 4: Report results**

No commit for this task — it's verification only.
