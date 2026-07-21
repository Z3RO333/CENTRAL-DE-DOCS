# Cadastro estruturado de NF por conservadora Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual-spreadsheet control of conservation-company (conservadora) invoices with a structured, deduplicated cadastro flow inside the app — a dedicated table, a dedicated submission form, a dedicated management sub-tab inside the existing Conservação area, and audit events on every create/status-change/delete.

**Architecture:** Follows the two-layer pattern already used by `orcamentos_internos`: a new relational table `notas_fiscais_conservacao` whose `id` is the same as the `formularios.id` it mirrors (shares the primary key, `on delete cascade`), reusing the existing storage/signed-URL infrastructure for the PDF. All reads/writes go through new dedicated API routes using the Supabase admin client (no RLS policies needed, same convention as `prestadores`). Every create/status-change/delete call writes an event to the existing `documentos_auditoria` table via `logDocumentoAuditEvent`.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + admin client), Tailwind CSS.

## Global Constraints

- No changes to the BTracker verification, 7-day deadline/alert engine, or dashboard — those are separate, later sub-projects (2, 3, 4). This plan only builds the cadastro and management flow.
- `status` on `notas_fiscais_conservacao` only has 3 values for now: `aguardando_verificacao`, `concluida`, `rejeitada`. BTracker-specific status values are added by a future migration in sub-project 3 — do not add them here.
- Duplicate key is `(prestador_id, numero_nf)` — a note is a duplicate if the same prestador already has a note with that exact number, regardless of loja.
- The generic notas fiscais form (`/formulario/notas_fiscais`, i.e. the `notas-fiscais` entry in `FORM_CONFIGS` in `src/app/formulario/[slug]/page.tsx`) must keep working exactly as-is for every prestador that is NOT `categoria = 'conservacao'`.
- JanPro (and every conservadora) stays a single prestador record — no per-regional-manager prestador records.
- The new management sub-tab uses the same access gate already built for the Conservação area: `isAdmin || isAprovadorInterno` (aprovadores = the fixed list in `orcamentos_internos_aprovadores`).
- Follow existing code style: no comments unless explaining a non-obvious "why"; reuse existing helpers instead of duplicating logic.

---

### Task 1: Migration — `notas_fiscais_conservacao` table

**Files:**
- Create: `supabase/migrations/202607211400_create_notas_fiscais_conservacao.sql`

**Interfaces:**
- Produces: `public.notas_fiscais_conservacao` table — consumed by every later task in this plan.

- [ ] **Step 1: Write the migration**

```sql
-- Cadastro estruturado de notas fiscais de empresas conservadoras,
-- substituindo o controle manual em planilha. Segue o mesmo padrao de
-- duas camadas usado em orcamentos_internos: o id desta tabela e o
-- mesmo id do registro espelho em public.formularios (tipo
-- 'notas_fiscais_conservacao'), reaproveitando storage/signed-urls.

create table if not exists public.notas_fiscais_conservacao (
  id uuid primary key references public.formularios(id) on delete cascade,
  prestador_id uuid not null references public.prestadores(id),
  loja_id uuid not null references public.lojas(id),
  numero_nf text not null,
  numero_pedido text,
  valor numeric,
  competencia text,
  data_recebimento date not null,
  observacoes text,
  status text not null default 'aguardando_verificacao'
    check (status in ('aguardando_verificacao', 'concluida', 'rejeitada')),
  motivo_status text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prestador_id, numero_nf)
);

create index if not exists notas_fiscais_conservacao_prestador_idx
  on public.notas_fiscais_conservacao (prestador_id);

create index if not exists notas_fiscais_conservacao_loja_idx
  on public.notas_fiscais_conservacao (loja_id);

create index if not exists notas_fiscais_conservacao_status_idx
  on public.notas_fiscais_conservacao (status);

create or replace function public.touch_notas_fiscais_conservacao_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notas_fiscais_conservacao_touch_updated_at
  on public.notas_fiscais_conservacao;

create trigger notas_fiscais_conservacao_touch_updated_at
  before update on public.notas_fiscais_conservacao
  for each row
  execute function public.touch_notas_fiscais_conservacao_updated_at();

alter table public.notas_fiscais_conservacao enable row level security;

-- As operacoes de leitura/escrita sao executadas pelo service role atraves
-- da API (/api/notas-fiscais-conservacao), portanto nenhuma policy adicional
-- e necessaria, seguindo o mesmo padrao de public.prestadores.
```

- [ ] **Step 2: Apply the migration**

Run this SQL in the Supabase SQL Editor for this project (there is no local Supabase CLI workflow in this repo — every file in `supabase/migrations/` is applied this way).

- [ ] **Step 3: Verify**

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'notas_fiscais_conservacao'
order by ordinal_position;
```

Expected: 14 rows (`id`, `prestador_id`, `loja_id`, `numero_nf`, `numero_pedido`, `valor`, `competencia`, `data_recebimento`, `observacoes`, `status`, `motivo_status`, `created_by`, `created_at`, `updated_at`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202607211400_create_notas_fiscais_conservacao.sql
git commit -m "feat(conservacao): cria tabela notas_fiscais_conservacao"
```

---

### Task 2: Exclude `notas_fiscais_conservacao` from the general Documentos listing

**Files:**
- Modify: `src/app/api/documentos/route.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: the general `/documentos` listing and the existing `/documentos/conservacao` "Documentos" tab no longer show `tipo = 'notas_fiscais_conservacao'` rows by default — consumed implicitly by Task 10's dedicated management view, which will fetch this tipo explicitly.

- [ ] **Step 1: Add the exclusion**

In `src/app/api/documentos/route.ts`, find:

```ts
    if (tipoFilter !== "contratos") {
      query = query.neq("tipo", "contratos");
    }
```

Replace with:

```ts
    if (tipoFilter !== "contratos") {
      query = query.neq("tipo", "contratos");
    }

    if (tipoFilter !== "notas_fiscais_conservacao") {
      query = query.neq("tipo", "notas_fiscais_conservacao");
    }
```

- [ ] **Step 2: Verify with a build**

Run: `npm run build`
Expected: succeeds with no new TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/documentos/route.ts
git commit -m "fix(documentos): exclui notas_fiscais_conservacao da listagem geral"
```

---

### Task 3: `POST /api/notas-fiscais-conservacao` — create

**Files:**
- Create: `src/app/api/notas-fiscais-conservacao/route.ts`

**Interfaces:**
- Consumes: `getActorFromRequest`, `ApiHttpError as HttpError`, `getAuthorizedPrestadorIds` from `@/lib/apiAuth`; `logDocumentoAuditEvent` from `@/lib/documentosAudit`; `normalizeText`, `parseValorTotal` from `@/lib/orcamentosInternos`; `parseCompetencia` from `@/lib/competencia`; `createSupabaseAdminClient` from `@/lib/supabaseAdminClient`.
- Produces: `POST /api/notas-fiscais-conservacao` — consumed by Task 7 (submission page). Response shape: `{ nota: NotaFiscalConservacaoRow }` where

```ts
type NotaFiscalConservacaoRow = {
  id: string;
  prestador_id: string;
  loja_id: string;
  numero_nf: string;
  numero_pedido: string | null;
  valor: number | null;
  competencia: string | null;
  data_recebimento: string;
  observacoes: string | null;
  status: "aguardando_verificacao" | "concluida" | "rejeitada";
  motivo_status: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
```

Request body: `{ prestadorId: string; lojaId: string; numeroNf: string; numeroPedido?: string; valor?: string | number; competencia?: string; dataRecebimento: string; observacoes?: string; arquivo: { path: string; name: string; type?: string; size?: number } }`.

- [ ] **Step 1: Write the route file**

```ts
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  ApiHttpError as HttpError,
  getActorFromRequest,
  getAuthorizedPrestadorIds,
} from "@/lib/apiAuth";
import { logDocumentoAuditEvent } from "@/lib/documentosAudit";
import { normalizeText, parseValorTotal } from "@/lib/orcamentosInternos";
import { parseCompetencia } from "@/lib/competencia";

export type NotaFiscalConservacaoRow = {
  id: string;
  prestador_id: string;
  loja_id: string;
  numero_nf: string;
  numero_pedido: string | null;
  valor: number | null;
  competencia: string | null;
  data_recebimento: string;
  observacoes: string | null;
  status: "aguardando_verificacao" | "concluida" | "rejeitada";
  motivo_status: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type NotaFiscalConservacaoInput = {
  prestadorId?: string;
  lojaId?: string;
  numeroNf?: string;
  numeroPedido?: string;
  valor?: string | number | null;
  competencia?: string;
  dataRecebimento?: string;
  observacoes?: string;
  arquivo?: { path?: string; name?: string; type?: string; size?: number };
};

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);

    if (!actor.realUserId) {
      throw new HttpError(401, "Sessão inválida.");
    }

    const body = (await request.json()) as NotaFiscalConservacaoInput;

    const prestadorId = normalizeText(body.prestadorId);
    const lojaId = normalizeText(body.lojaId);
    const numeroNf = normalizeText(body.numeroNf);
    const dataRecebimento = normalizeText(body.dataRecebimento);
    const arquivoPath = normalizeText(body.arquivo?.path);

    if (!prestadorId || !lojaId || !numeroNf || !dataRecebimento || !arquivoPath) {
      throw new HttpError(
        400,
        "Informe prestador, loja, número da NF, data de recebimento e o anexo.",
      );
    }

    if (!actor.isAdmin) {
      const allowedPrestadores = await getAuthorizedPrestadorIds(
        actor.email,
        supabaseAdmin,
      );
      if (!allowedPrestadores.includes(prestadorId)) {
        throw new HttpError(
          403,
          "Você não possui acesso para cadastrar notas para este prestador.",
        );
      }
    }

    const { data: prestador, error: prestadorError } = await supabaseAdmin
      .from("prestadores")
      .select("id,nome,categoria")
      .eq("id", prestadorId)
      .maybeSingle();
    if (prestadorError) {
      throw prestadorError;
    }
    if (!prestador) {
      throw new HttpError(404, "Prestador não encontrado.");
    }
    if (prestador.categoria !== "conservacao") {
      throw new HttpError(
        400,
        "Este prestador não é uma empresa de conservação.",
      );
    }

    const { data: loja, error: lojaError } = await supabaseAdmin
      .from("lojas")
      .select("id,nome,codigo")
      .eq("id", lojaId)
      .maybeSingle();
    if (lojaError) {
      throw lojaError;
    }
    if (!loja) {
      throw new HttpError(404, "Loja não encontrada.");
    }

    const competenciaRaw = normalizeText(body.competencia);
    const competencia = competenciaRaw
      ? parseCompetencia(competenciaRaw)?.label ?? null
      : null;
    if (competenciaRaw && !competencia) {
      throw new HttpError(400, "Competência inválida. Use o formato MM/AAAA.");
    }

    const { data: existente, error: existenteError } = await supabaseAdmin
      .from("notas_fiscais_conservacao")
      .select("id")
      .eq("prestador_id", prestadorId)
      .eq("numero_nf", numeroNf)
      .maybeSingle();
    if (existenteError) {
      throw existenteError;
    }
    if (existente) {
      throw new HttpError(
        409,
        "Já existe uma nota fiscal cadastrada com este número para este prestador.",
      );
    }

    const valor = parseValorTotal(body.valor);
    const numeroPedido = normalizeText(body.numeroPedido) || null;
    const observacoes = normalizeText(body.observacoes) || null;
    const nomeArquivo = normalizeText(body.arquivo?.name) || arquivoPath.split("/").pop() || "nota.pdf";

    const { data: formulario, error: formularioError } = await supabaseAdmin
      .from("formularios")
      .insert({
        user_id: actor.realUserId,
        tipo: "notas_fiscais_conservacao",
        status: "em_analise",
        arquivo_path: arquivoPath,
        prestador_id: prestadorId,
        dados: {
          loja_id: lojaId,
          loja_nome: loja.codigo ? `${loja.nome} - ${loja.codigo}` : loja.nome,
          prestador: prestador.nome,
          numero_nf: numeroNf,
          numero_pedido: numeroPedido,
          valor,
          competencia,
          data_recebimento: dataRecebimento,
          observacoes,
          nome_arquivo: nomeArquivo,
        },
      })
      .select("id")
      .single();
    if (formularioError || !formulario) {
      throw formularioError ?? new Error("Falha ao criar o documento.");
    }

    const id = formulario.id as string;

    const { data: nota, error: notaError } = await supabaseAdmin
      .from("notas_fiscais_conservacao")
      .insert({
        id,
        prestador_id: prestadorId,
        loja_id: lojaId,
        numero_nf: numeroNf,
        numero_pedido: numeroPedido,
        valor,
        competencia,
        data_recebimento: dataRecebimento,
        observacoes,
        created_by: actor.realUserId,
      })
      .select("*")
      .single();
    if (notaError) {
      if (notaError.code === "23505") {
        throw new HttpError(
          409,
          "Já existe uma nota fiscal cadastrada com este número para este prestador.",
        );
      }
      throw notaError;
    }
    if (!nota) {
      throw new Error("Falha ao criar a nota fiscal.");
    }

    await logDocumentoAuditEvent({
      supabaseAdmin,
      documentoId: id,
      eventType: "nota_conservacao_criada",
      actorId: actor.realUserId,
      actorEmail: actor.realEmail,
      metadata: { prestador_id: prestadorId, numero_nf: numeroNf },
    });

    return NextResponse.json({ nota: nota as NotaFiscalConservacaoRow });
  } catch (err) {
    console.error("Erro ao criar nota fiscal de conservação:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível criar a nota fiscal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify with a build**

Run: `npm run build`
Expected: succeeds with no new TypeScript errors.

- [ ] **Step 3: Manual verification note**

There is no live Supabase session available in this environment to exercise this endpoint with `curl`. Trace by hand instead: with a fake body missing `numeroNf`, the function throws `HttpError(400, ...)` before any database call (confirm by reading the code — the required-fields check runs before any `supabaseAdmin` call). Document this trace in the task report; full live verification happens once the submission page (Task 7) exists and can be exercised in a browser.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/notas-fiscais-conservacao/route.ts
git commit -m "feat(conservacao): adiciona POST /api/notas-fiscais-conservacao"
```

---

### Task 4: `GET /api/notas-fiscais-conservacao` — list

**Files:**
- Modify: `src/app/api/notas-fiscais-conservacao/route.ts`
- Modify: `src/lib/orcamentosInternos.ts`

**Interfaces:**
- Consumes: `getAprovadorEmails`, `normalizeEmail` (already exported from `src/lib/orcamentosInternos.ts`).
- Produces: `isAprovadorInterno(email, supabaseAdmin): Promise<boolean>`, newly exported from `src/lib/orcamentosInternos.ts` — consumed by Task 5, Task 6, and reusable by future sub-projects. `GET /api/notas-fiscais-conservacao` — consumed by Task 10 (management page). Response shape: `{ notas: NotaFiscalConservacaoComDetalhes[], total: number }` where

```ts
type NotaFiscalConservacaoComDetalhes = NotaFiscalConservacaoRow & {
  prestador_nome: string;
  loja_nome: string;
  arquivo_path: string;
};
```

`arquivo_path` comes from the mirrored `formularios` row — since `notas_fiscais_conservacao.id` IS `formularios.id` (shared primary key from Task 1), no join table is needed, just a second lookup by the same id set.

- [ ] **Step 1: Add the `isAprovadorInterno` helper**

In `src/lib/orcamentosInternos.ts`, find:

```ts
export async function getAprovadorEmails(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
) {
  const { data, error } = await supabaseAdmin
    .from("orcamentos_internos_aprovadores")
    .select("email");
  if (error) throw error;
  const emails = (data ?? [])
    .map((row) => normalizeEmail(row.email as string | null))
    .filter((email): email is string => Boolean(email));
  return new Set(emails);
}
```

Add this function right after it:

```ts
export async function isAprovadorInterno(
  email: string | null,
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }
  const aprovadores = await getAprovadorEmails(supabaseAdmin);
  return aprovadores.has(normalized);
}
```

- [ ] **Step 2: Add the GET handler**

In `src/app/api/notas-fiscais-conservacao/route.ts`, update the import block:

```ts
import { normalizeText, parseValorTotal } from "@/lib/orcamentosInternos";
```

to:

```ts
import {
  isAprovadorInterno,
  normalizeText,
  parseValorTotal,
} from "@/lib/orcamentosInternos";
```

Then add this function to the same file, above `export async function POST`:

```ts
export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);

    const isAprovador = await isAprovadorInterno(actor.email, supabaseAdmin);
    if (!actor.isAdmin && !isAprovador) {
      throw new HttpError(403, "Acesso restrito.");
    }

    const { searchParams } = new URL(request.url);
    const prestadorId = normalizeText(searchParams.get("prestadorId"));
    const lojaId = normalizeText(searchParams.get("lojaId"));
    const competencia = normalizeText(searchParams.get("competencia"));
    const status = normalizeText(searchParams.get("status"));
    const numeroNf = normalizeText(searchParams.get("numeroNf"));

    let query = supabaseAdmin
      .from("notas_fiscais_conservacao")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    if (prestadorId) {
      query = query.eq("prestador_id", prestadorId);
    }
    if (lojaId) {
      query = query.eq("loja_id", lojaId);
    }
    if (competencia) {
      query = query.eq("competencia", competencia);
    }
    if (status) {
      query = query.eq("status", status);
    }
    if (numeroNf) {
      query = query.ilike("numero_nf", `%${numeroNf}%`);
    }

    const { data, error, count } = await query;
    if (error) {
      throw error;
    }

    const notas = (data ?? []) as NotaFiscalConservacaoRow[];

    const prestadorIds = Array.from(new Set(notas.map((nota) => nota.prestador_id)));
    const lojaIds = Array.from(new Set(notas.map((nota) => nota.loja_id)));
    const notaIds = notas.map((nota) => nota.id);

    const [{ data: prestadoresData }, { data: lojasData }, { data: formulariosData }] =
      await Promise.all([
        prestadorIds.length > 0
          ? supabaseAdmin.from("prestadores").select("id,nome").in("id", prestadorIds)
          : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
        lojaIds.length > 0
          ? supabaseAdmin.from("lojas").select("id,nome,codigo").in("id", lojaIds)
          : Promise.resolve({ data: [] as { id: string; nome: string; codigo: string | null }[] }),
        notaIds.length > 0
          ? supabaseAdmin.from("formularios").select("id,arquivo_path").in("id", notaIds)
          : Promise.resolve({ data: [] as { id: string; arquivo_path: string }[] }),
      ]);

    const prestadorNomeById = new Map(
      (prestadoresData ?? []).map((item) => [item.id as string, item.nome as string]),
    );
    const lojaNomeById = new Map(
      (lojasData ?? []).map((item) => [
        item.id as string,
        item.codigo ? `${item.nome} - ${item.codigo}` : (item.nome as string),
      ]),
    );
    const arquivoPathById = new Map(
      (formulariosData ?? []).map((item) => [item.id as string, item.arquivo_path as string]),
    );

    const notasComDetalhes = notas.map((nota) => ({
      ...nota,
      prestador_nome: prestadorNomeById.get(nota.prestador_id) ?? "—",
      loja_nome: lojaNomeById.get(nota.loja_id) ?? "—",
      arquivo_path: arquivoPathById.get(nota.id) ?? "",
    }));

    return NextResponse.json({ notas: notasComDetalhes, total: count ?? notas.length });
  } catch (err) {
    console.error("Erro ao listar notas fiscais de conservação:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível listar as notas fiscais.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify with a build**

Run: `npm run build`
Expected: succeeds with no new TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/notas-fiscais-conservacao/route.ts src/lib/orcamentosInternos.ts
git commit -m "feat(conservacao): adiciona GET /api/notas-fiscais-conservacao e helper isAprovadorInterno"
```

---

### Task 5: `PATCH /api/notas-fiscais-conservacao/[id]` — status change

**Files:**
- Create: `src/app/api/notas-fiscais-conservacao/[id]/route.ts`

**Interfaces:**
- Consumes: `isAprovadorInterno` from `@/lib/orcamentosInternos` (Task 4).
- Produces: `PATCH /api/notas-fiscais-conservacao/[id]` — consumed by Task 10. Request body: `{ status: "concluida" | "rejeitada"; motivo?: string }`. Response: `{ nota: NotaFiscalConservacaoRow }`.

- [ ] **Step 1: Write the PATCH handler**

```ts
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { logDocumentoAuditEvent } from "@/lib/documentosAudit";
import { isAprovadorInterno, normalizeText } from "@/lib/orcamentosInternos";
import type { NotaFiscalConservacaoRow } from "../route";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);

    const isAprovador = await isAprovadorInterno(actor.email, supabaseAdmin);
    if (!actor.isAdmin && !isAprovador) {
      throw new HttpError(403, "Acesso restrito.");
    }

    const body = (await request.json()) as { status?: string; motivo?: string };
    const status = normalizeText(body.status);
    const motivo = normalizeText(body.motivo) || null;

    if (status !== "concluida" && status !== "rejeitada") {
      throw new HttpError(400, "Status inválido para esta operação.");
    }
    if (status === "rejeitada" && !motivo) {
      throw new HttpError(400, "Informe o motivo da rejeição.");
    }

    const { data: notaAtual, error: notaAtualError } = await supabaseAdmin
      .from("notas_fiscais_conservacao")
      .select("id,status")
      .eq("id", id)
      .maybeSingle();
    if (notaAtualError) {
      throw notaAtualError;
    }
    if (!notaAtual) {
      throw new HttpError(404, "Nota fiscal não encontrada.");
    }

    const { data: nota, error: notaError } = await supabaseAdmin
      .from("notas_fiscais_conservacao")
      .update({ status, motivo_status: motivo })
      .eq("id", id)
      .select("*")
      .single();
    if (notaError || !nota) {
      throw notaError ?? new Error("Falha ao atualizar a nota fiscal.");
    }

    await logDocumentoAuditEvent({
      supabaseAdmin,
      documentoId: id,
      eventType: "nota_conservacao_status_alterado",
      actorId: actor.realUserId,
      actorEmail: actor.realEmail,
      metadata: {
        from: notaAtual.status,
        to: status,
        ...(motivo ? { motivo } : {}),
      },
    });

    return NextResponse.json({ nota: nota as NotaFiscalConservacaoRow });
  } catch (err) {
    console.error("Erro ao atualizar nota fiscal de conservação:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível atualizar a nota fiscal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify with a build**

Run: `npm run build`
Expected: succeeds with no new TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/notas-fiscais-conservacao/[id]/route.ts"
git commit -m "feat(conservacao): adiciona PATCH /api/notas-fiscais-conservacao/[id]"
```

---

### Task 6: `DELETE /api/notas-fiscais-conservacao/[id]`

**Files:**
- Modify: `src/app/api/notas-fiscais-conservacao/[id]/route.ts`

**Interfaces:**
- Produces: `DELETE /api/notas-fiscais-conservacao/[id]?motivo=...` — consumed by Task 10.

- [ ] **Step 1: Add the DELETE handler**

Append to `src/app/api/notas-fiscais-conservacao/[id]/route.ts`:

```ts
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);

    const isAprovador = await isAprovadorInterno(actor.email, supabaseAdmin);
    if (!actor.isAdmin && !isAprovador) {
      throw new HttpError(403, "Acesso restrito.");
    }

    const { searchParams } = new URL(request.url);
    const motivo = normalizeText(searchParams.get("motivo"));
    if (!motivo) {
      throw new HttpError(400, "Informe o motivo da exclusão.");
    }

    const { data: nota, error: notaError } = await supabaseAdmin
      .from("notas_fiscais_conservacao")
      .select("id,numero_nf,prestador_id")
      .eq("id", id)
      .maybeSingle();
    if (notaError) {
      throw notaError;
    }
    if (!nota) {
      throw new HttpError(404, "Nota fiscal não encontrada.");
    }

    await logDocumentoAuditEvent({
      supabaseAdmin,
      documentoId: id,
      eventType: "nota_conservacao_excluida",
      actorId: actor.realUserId,
      actorEmail: actor.realEmail,
      metadata: {
        motivo,
        numero_nf: nota.numero_nf,
        prestador_id: nota.prestador_id,
      },
    });

    const { error: deleteError } = await supabaseAdmin
      .from("formularios")
      .delete()
      .eq("id", id);
    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Erro ao remover nota fiscal de conservação:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível remover a nota fiscal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

Note: deleting the `formularios` row cascades to `notas_fiscais_conservacao` via the `on delete cascade` foreign key from Task 1 — no separate delete needed for that table. The audit event is written **before** the delete so it survives even though `documentos_auditoria` has no FK requiring the document to still exist (confirm this by reading `documentos_auditoria`'s schema if in doubt — `documento_id` is not declared with `on delete cascade` back to `formularios`, so the audit row will remain after the document is gone, exactly as intended for an audit trail).

- [ ] **Step 2: Verify with a build**

Run: `npm run build`
Expected: succeeds with no new TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/notas-fiscais-conservacao/[id]/route.ts"
git commit -m "feat(conservacao): adiciona DELETE /api/notas-fiscais-conservacao/[id]"
```

---

### Task 7: Submission page `/formulario/notas-fiscais-conservacao`

**Files:**
- Create: `src/app/formulario/notas-fiscais-conservacao/page.tsx`

**Interfaces:**
- Consumes: `POST /api/notas-fiscais-conservacao` (Task 3), `PrestadorCombobox` from `../[slug]/_components/PrestadorCombobox`, `LojaCombobox` from `../[slug]/_components/LojaCombobox`, `usePrestadores` from `@/hooks/usePrestadores`, `useLojas` from `@/hooks/useLojas`, `parseCompetencia` from `@/lib/competencia`.

- [ ] **Step 1: Write the page**

```tsx
"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { usePrestadores } from "@/hooks/usePrestadores";
import { useLojas } from "@/hooks/useLojas";
import { parseCompetencia } from "@/lib/competencia";
import PrestadorCombobox from "../[slug]/_components/PrestadorCombobox";
import LojaCombobox from "../[slug]/_components/LojaCombobox";

export default function NotasFiscaisConservacaoPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { isAdmin } = useDocumentsAccess();
  const { prestadores, loading: prestadoresLoading } = usePrestadores({
    assignedOnly: !isAdmin,
  });
  const { lojas, loading: lojasLoading } = useLojas();

  const prestadoresConservacao = useMemo(
    () => prestadores.filter((item) => item.categoria === "conservacao"),
    [prestadores],
  );

  const [prestadorId, setPrestadorId] = useState("");
  const [lojaId, setLojaId] = useState("");
  const [numeroNf, setNumeroNf] = useState("");
  const [numeroPedido, setNumeroPedido] = useState("");
  const [valor, setValor] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [dataRecebimento, setDataRecebimento] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const getAccessToken = async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const token = data.session?.access_token;
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    return token;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!user) {
      setError("Sessão expirada. Faça login novamente.");
      router.push("/login");
      return;
    }
    if (!prestadorId || !lojaId || !numeroNf.trim() || !dataRecebimento) {
      setError("Preencha prestador, loja, número da NF e data de recebimento.");
      return;
    }
    if (!file) {
      setError("Anexe o PDF da nota fiscal.");
      return;
    }
    if (competencia.trim() && !parseCompetencia(competencia.trim())) {
      setError("Competência inválida. Use o formato MM/AAAA.");
      return;
    }

    setSubmitting(true);
    try {
      const ext = file.name.split(".").pop() ?? "pdf";
      const path = `${user.id}/notas_fiscais_conservacao/${Date.now()}.${ext}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("formularios")
        .upload(path, file);
      if (uploadError || !uploadData) {
        throw uploadError ?? new Error("Erro ao enviar o PDF.");
      }

      const token = await getAccessToken();
      const response = await fetch("/api/notas-fiscais-conservacao", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prestadorId,
          lojaId,
          numeroNf: numeroNf.trim(),
          numeroPedido: numeroPedido.trim() || undefined,
          valor: valor.trim() || undefined,
          competencia: competencia.trim() || undefined,
          dataRecebimento,
          observacoes: observacoes.trim() || undefined,
          arquivo: {
            path: uploadData.path ?? path,
            name: file.name,
            type: file.type,
            size: file.size,
          },
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível cadastrar a nota fiscal.");
      }

      setSuccess("Nota fiscal cadastrada com sucesso.");
      setPrestadorId("");
      setLojaId("");
      setNumeroNf("");
      setNumeroPedido("");
      setValor("");
      setCompetencia("");
      setDataRecebimento("");
      setObservacoes("");
      setFile(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível cadastrar a nota fiscal.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <header>
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-2 text-xs text-slate-500 hover:text-sky-600"
        >
          Voltar
        </button>
        <div className="flex items-center gap-2">
          <FilePlus2 className="h-5 w-5 text-slate-700" />
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Nota Fiscal — Conservação
          </h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Cadastre a nota fiscal de uma empresa conservadora para controle e auditoria.
        </p>
      </header>

      {error && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="max-w-2xl space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Prestador (conservadora)
          <div className="mt-1 font-normal normal-case tracking-normal">
            <PrestadorCombobox
              prestadores={prestadoresConservacao}
              value={prestadorId}
              onChange={setPrestadorId}
              loading={prestadoresLoading}
              required
            />
          </div>
        </label>

        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Loja
          <div className="mt-1 font-normal normal-case tracking-normal">
            <LojaCombobox
              lojas={lojas}
              value={lojaId}
              onChange={setLojaId}
              loading={lojasLoading}
              required
            />
          </div>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Número da NF
            <input
              type="text"
              value={numeroNf}
              onChange={(event) => setNumeroNf(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              required
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Número do pedido
            <input
              type="text"
              value={numeroPedido}
              onChange={(event) => setNumeroPedido(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Valor
            <input
              type="number"
              step="0.01"
              value={valor}
              onChange={(event) => setValor(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Competência
            <input
              type="text"
              placeholder="MM/AAAA"
              value={competencia}
              onChange={(event) => setCompetencia(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Data de recebimento
            <input
              type="date"
              value={dataRecebimento}
              onChange={(event) => setDataRecebimento(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              required
            />
          </label>
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Observações
          <textarea
            value={observacoes}
            onChange={(event) => setObservacoes(event.target.value)}
            className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>

        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          PDF da nota fiscal
          <input
            type="file"
            accept="application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-2 block w-full cursor-pointer text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-sky-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
          />
          {file && <p className="mt-1 text-xs text-slate-500">{file.name}</p>}
        </label>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {submitting ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verify with a build**

Run: `npm run build`
Expected: succeeds with no new TypeScript errors.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, log in, create (or use, per Task in the prior branch) a prestador with `categoria = 'conservacao'`, go to `/formulario/notas-fiscais-conservacao`, fill the form and submit. Confirm success message appears and the form resets. Submit the exact same prestador + número da NF again and confirm the 409 duplicate error message appears.

- [ ] **Step 4: Commit**

```bash
git add src/app/formulario/notas-fiscais-conservacao/page.tsx
git commit -m "feat(conservacao): adiciona formulario dedicado de NF para conservadoras"
```

---

### Task 8: Guard in the generic notas fiscais form

**Files:**
- Modify: `src/app/formulario/[slug]/page.tsx`

**Interfaces:**
- Consumes: `Prestador.categoria` (already present on the type returned by `usePrestadores`).

- [ ] **Step 1: Add the guard**

In `src/app/formulario/[slug]/page.tsx`, find the start of `handleSubmit`:

```ts
      if (!user) {
        setError("Sessão expirada. Faça login novamente.");
        router.push("/login");
        return;
      }

      if (
        config.slug === "retencao-trabalhista" ||
        config.slug === "notas-fiscais" ||
        config.slug === "registro-laudos"
      ) {
```

Replace with:

```ts
      if (!user) {
        setError("Sessão expirada. Faça login novamente.");
        router.push("/login");
        return;
      }

      if (config.slug === "notas-fiscais") {
        const prestadorSelecionado = prestadoresDisponiveis.find(
          (item) => item.id === selectedPrestadorId,
        );
        if (prestadorSelecionado?.categoria === "conservacao") {
          setError(
            "Este prestador é uma empresa de conservação. Cadastre esta nota em /formulario/notas-fiscais-conservacao.",
          );
          return;
        }
      }

      if (
        config.slug === "retencao-trabalhista" ||
        config.slug === "notas-fiscais" ||
        config.slug === "registro-laudos"
      ) {
```

- [ ] **Step 2: Verify with a build**

Run: `npm run build`
Expected: succeeds with no new TypeScript errors.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, go to `/formulario/notas-fiscais`, select a prestador with `categoria = 'conservacao'` in the prestador combobox, fill the rest of the form, attach a PDF, and submit. Confirm the error message appears and no document is created (no upload happens either — the guard runs before the upload loop). Then select a non-conservação prestador and confirm the form submits normally, unaffected.

- [ ] **Step 4: Commit**

```bash
git add "src/app/formulario/[slug]/page.tsx"
git commit -m "fix(formulario): bloqueia NF de conservadora no formulario generico"
```

---

### Task 9: Sub-nav inside Conservação + wire into the existing "Documentos" tab

**Files:**
- Create: `src/app/documentos/conservacao/_components/ConservacaoSubNav.tsx`
- Modify: `src/app/documentos/conservacao/page.tsx`

**Interfaces:**
- Produces: `<ConservacaoSubNav active="documentos" | "notas-fiscais" />` — consumed by Task 10 as well.

- [ ] **Step 1: Write the sub-nav component**

```tsx
"use client";

import Link from "next/link";

type ConservacaoSubNavProps = {
  active: "documentos" | "notas-fiscais";
};

export function ConservacaoSubNav({ active }: ConservacaoSubNavProps) {
  const tabs: { key: ConservacaoSubNavProps["active"]; label: string; href: string }[] = [
    { key: "documentos", label: "Documentos", href: "/documentos/conservacao" },
    {
      key: "notas-fiscais",
      label: "Notas Fiscais",
      href: "/documentos/conservacao/notas-fiscais",
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

- [ ] **Step 2: Wire it into the existing Conservação "Documentos" page**

In `src/app/documentos/conservacao/page.tsx`, find:

```tsx
import { DocumentActions } from "../_components/DocumentActions";
import { DocumentDetailsDrawer } from "../_components/DocumentDetailsDrawer";
```

Replace with:

```tsx
import { DocumentActions } from "../_components/DocumentActions";
import { DocumentDetailsDrawer } from "../_components/DocumentDetailsDrawer";
import { ConservacaoSubNav } from "./_components/ConservacaoSubNav";
```

Then find:

```tsx
        </div>
      </header>

      {error && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-100">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <span className="font-semibold">{registrosFiltrados.length} documento(s)</span>
```

Replace with:

```tsx
        </div>
      </header>

      <ConservacaoSubNav active="documentos" />

      {error && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-100">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <span className="font-semibold">{registrosFiltrados.length} documento(s)</span>
```

- [ ] **Step 3: Verify with a build**

Run: `npm run build`
Expected: succeeds with no new TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/documentos/conservacao/_components/ConservacaoSubNav.tsx src/app/documentos/conservacao/page.tsx
git commit -m "feat(conservacao): adiciona sub-navegacao (Documentos / Notas Fiscais)"
```

---

### Task 10: Management page `/documentos/conservacao/notas-fiscais`

**Files:**
- Create: `src/app/documentos/conservacao/notas-fiscais/page.tsx`

**Interfaces:**
- Consumes: `GET /api/notas-fiscais-conservacao`, `PATCH /api/notas-fiscais-conservacao/[id]`, `DELETE /api/notas-fiscais-conservacao/[id]` (Tasks 3–6), `ConservacaoSubNav` (Task 9), `useIsAprovadorInterno` from `@/hooks/useIsAprovadorInterno`, `getSignedFileUrl`/`resolveSignedPdfPath`/`formatCurrencyBRL` from `../../_lib/documentosShared`.

- [ ] **Step 1: Write the page**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { useIsAprovadorInterno } from "@/hooks/useIsAprovadorInterno";
import {
  getSignedFileUrl,
  resolveSignedPdfPath,
  formatCurrencyBRL,
} from "../../_lib/documentosShared";
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

const STATUS_BADGE: Record<NotaFiscalConservacao["status"], string> = {
  aguardando_verificacao: "bg-amber-50 text-amber-700",
  concluida: "bg-emerald-50 text-emerald-700",
  rejeitada: "bg-red-50 text-red-700",
};

export default function NotasFiscaisConservacaoManagementPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();
  const { isAprovadorInterno, loading: aprovadorLoading } = useIsAprovadorInterno();
  const canAccess = isAdmin || isAprovadorInterno;

  const [notas, setNotas] = useState<NotaFiscalConservacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [rejectDialog, setRejectDialog] = useState<NotaFiscalConservacao | null>(null);
  const [rejectMotivo, setRejectMotivo] = useState("");
  const [deleteDialog, setDeleteDialog] = useState<NotaFiscalConservacao | null>(null);
  const [deleteMotivo, setDeleteMotivo] = useState("");
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [pdfActionId, setPdfActionId] = useState<string | null>(null);

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
      const params = new URLSearchParams();
      if (statusFilter !== "todos") {
        params.set("status", statusFilter);
      }
      const response = await fetch(`/api/notas-fiscais-conservacao?${params}`, {
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
  }, [getAccessToken, statusFilter, user]);

  useEffect(() => {
    if (user && canAccess) void carregarNotas();
  }, [canAccess, carregarNotas, user]);

  const abrirPdf = async (nota: NotaFiscalConservacao) => {
    if (!nota.arquivo_path) return;
    try {
      setPdfActionId(nota.id);
      setError(null);
      const path = resolveSignedPdfPath(nota.arquivo_path) ?? nota.arquivo_path;
      const signedUrl = await getSignedFileUrl(path);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível abrir o PDF.");
    } finally {
      setPdfActionId(null);
    }
  };

  const baixarPdf = async (nota: NotaFiscalConservacao) => {
    if (!nota.arquivo_path) return;
    try {
      setPdfActionId(nota.id);
      setError(null);
      const path = resolveSignedPdfPath(nota.arquivo_path) ?? nota.arquivo_path;
      const signedUrl = await getSignedFileUrl(path);
      const response = await fetch(signedUrl);
      if (!response.ok) throw new Error("Não foi possível baixar o arquivo.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = nota.arquivo_path.split("/").pop() ?? "nota.pdf";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível baixar o PDF.");
    } finally {
      setPdfActionId(null);
    }
  };

  const alterarStatus = async (
    nota: NotaFiscalConservacao,
    status: "concluida" | "rejeitada",
    motivo?: string,
  ) => {
    try {
      setActioningId(nota.id);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch(`/api/notas-fiscais-conservacao/${nota.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status, motivo }),
      });
      const payload = (await response.json()) as {
        nota?: NotaFiscalConservacao;
        error?: string;
      };
      if (!response.ok || !payload.nota) {
        throw new Error(payload.error ?? "Não foi possível atualizar a nota fiscal.");
      }
      setNotas((prev) =>
        prev.map((item) => (item.id === nota.id ? payload.nota! : item)),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível atualizar a nota fiscal.",
      );
    } finally {
      setActioningId(null);
    }
  };

  const confirmarRejeicao = async () => {
    if (!rejectDialog || !rejectMotivo.trim()) return;
    await alterarStatus(rejectDialog, "rejeitada", rejectMotivo.trim());
    setRejectDialog(null);
    setRejectMotivo("");
  };

  const confirmarExclusao = async () => {
    if (!deleteDialog || !deleteMotivo.trim()) return;
    try {
      setActioningId(deleteDialog.id);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch(
        `/api/notas-fiscais-conservacao/${deleteDialog.id}?motivo=${encodeURIComponent(
          deleteMotivo.trim(),
        )}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível remover a nota fiscal.");
      }
      setNotas((prev) => prev.filter((item) => item.id !== deleteDialog.id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível remover a nota fiscal.",
      );
    } finally {
      setActioningId(null);
      setDeleteDialog(null);
      setDeleteMotivo("");
    }
  };

  if (authLoading || accessLoading || aprovadorLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando notas fiscais...
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
            Notas Fiscais — Conservação
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Controle das notas fiscais recebidas das empresas conservadoras.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
          >
            <option value="todos">Todos os status</option>
            <option value="aguardando_verificacao">Aguardando verificação</option>
            <option value="concluida">Concluída</option>
            <option value="rejeitada">Rejeitada</option>
          </select>
          <button
            type="button"
            onClick={() => void carregarNotas()}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        </div>
      </header>

      <ConservacaoSubNav active="notas-fiscais" />

      {error && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-100">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <span className="font-semibold">{notas.length} nota(s)</span>
          {loading && (
            <span className="inline-flex items-center gap-1">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Carregando
            </span>
          )}
        </div>

        {!loading && notas.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Nenhuma nota fiscal encontrada.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Conservadora</th>
                  <th className="px-4 py-3">Loja</th>
                  <th className="px-4 py-3">NF</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                  <th className="px-4 py-3">Competência</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {notas.map((nota) => (
                  <tr key={nota.id} className="align-top">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {nota.prestador_nome}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{nota.loja_nome}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {nota.numero_nf}
                      {nota.numero_pedido && (
                        <p className="text-[11px] text-slate-400">
                          Pedido: {nota.numero_pedido}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-600">
                      {formatCurrencyBRL(nota.valor) ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {nota.competencia ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGE[nota.status]}`}
                      >
                        {STATUS_LABEL[nota.status]}
                      </span>
                      {nota.motivo_status && (
                        <p className="mt-1 max-w-[200px] text-[11px] text-slate-400">
                          {nota.motivo_status}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2 text-[11px]">
                        <button
                          type="button"
                          disabled={pdfActionId === nota.id || !nota.arquivo_path}
                          onClick={() => void abrirPdf(nota)}
                          className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Ver PDF
                        </button>
                        <button
                          type="button"
                          disabled={pdfActionId === nota.id || !nota.arquivo_path}
                          onClick={() => void baixarPdf(nota)}
                          className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Baixar PDF
                        </button>
                        {nota.status === "aguardando_verificacao" && (
                          <>
                            <button
                              type="button"
                              disabled={actioningId === nota.id}
                              onClick={() => void alterarStatus(nota, "concluida")}
                              className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                            >
                              Concluir
                            </button>
                            <button
                              type="button"
                              disabled={actioningId === nota.id}
                              onClick={() => {
                                setRejectMotivo("");
                                setRejectDialog(nota);
                              }}
                              className="rounded-full border border-red-200 px-3 py-1 text-red-600 hover:bg-red-50 disabled:opacity-60"
                            >
                              Rejeitar
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          disabled={actioningId === nota.id}
                          onClick={() => {
                            setDeleteMotivo("");
                            setDeleteDialog(nota);
                          }}
                          className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {rejectDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setRejectDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              Rejeitar nota fiscal
            </h2>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Motivo
              <textarea
                value={rejectMotivo}
                onChange={(event) => setRejectMotivo(event.target.value)}
                className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectDialog(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!rejectMotivo.trim() || actioningId === rejectDialog.id}
                onClick={() => void confirmarRejeicao()}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60"
              >
                Rejeitar
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setDeleteDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              Remover nota fiscal
            </h2>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Motivo (obrigatório)
              <textarea
                value={deleteMotivo}
                onChange={(event) => setDeleteMotivo(event.target.value)}
                className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteDialog(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!deleteMotivo.trim() || actioningId === deleteDialog.id}
                onClick={() => void confirmarExclusao()}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify with a build**

Run: `npm run build`
Expected: succeeds with no new TypeScript errors.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, log in as admin or as one of the aprovadores (`jacenira@bemol.com.br`, `walterrodrigues@bemol.com.br`, `danieldamasceno@bemol.com.br`), go to `/documentos/conservacao/notas-fiscais`. Confirm the note created in Task 7's verification appears with status "Aguardando verificação". Click "Ver PDF" and confirm the attached PDF opens in a new tab. Click "Baixar PDF" and confirm it downloads. Click "Concluir" and confirm the status updates. Create another note, click "Rejeitar", try to confirm without typing a motivo (button should stay disabled), type a motivo, confirm, and check the status updates to "Rejeitada" with the motivo shown. Click "Excluir" on a note, confirm the same motivo-required behavior, confirm, and check the note disappears from the list. Log in as a user who is neither admin nor an aprovador and confirm this route redirects to `/documentos`.

- [ ] **Step 4: Commit**

```bash
git add src/app/documentos/conservacao/notas-fiscais/page.tsx
git commit -m "feat(conservacao): adiciona gestao de notas fiscais (concluir/rejeitar/excluir)"
```

---

### Task 11: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run
```

Expected: all existing tests still pass (this plan does not add new pure-function tests, since every new file in this plan either talks to the database/network or is a React page — consistent with this repo's existing convention of only unit-testing side-effect-free helpers).

- [ ] **Step 2: Run the production build**

```bash
npm run build
```

Expected: succeeds with no TypeScript errors, and the route table includes `/formulario/notas-fiscais-conservacao`, `/documentos/conservacao/notas-fiscais`, `/api/notas-fiscais-conservacao`.

- [ ] **Step 3: Walk through the spec's test plan manually**

With `npm run dev` running:
1. Cadastrar uma NF para um prestador categoria=conservação via `/formulario/notas-fiscais-conservacao` e confirmar que aparece em `/documentos/conservacao/notas-fiscais` com status inicial `aguardando_verificacao`.
2. Tentar cadastrar a mesma combinação prestador+número de NF novamente e confirmar que é rejeitado com mensagem clara, sem subir o arquivo (o erro aparece antes de qualquer upload, já que a checagem client-side de "arquivo selecionado" passa mas a chamada `fetch` para a API roda depois do upload — confirmar no Network tab do browser que o upload ocorreu mas o registro da nota falhou com 409; se preferir evitar o upload nesse caso, isso é um refinamento aceitável para uma iteração futura, não um requisito desta spec).
3. Tentar cadastrar uma NF de conservadora pelo formulário genérico (`/formulario/notas_fiscais`) e confirmar que é bloqueado com a mensagem apontando para o formulário novo.
4. Marcar uma nota como rejeitada sem motivo e confirmar que é bloqueado; marcar com motivo e confirmar que funciona.
5. Excluir uma nota sem motivo e confirmar que é bloqueado.
6. Confirmar que um usuário sem acesso à área Conservação não vê a sub-aba "Notas Fiscais" nem consegue acessar a rota diretamente.
7. Confirmar que a nota criada NÃO aparece na aba "Documentos" (listagem geral) nem na sub-aba "Documentos" dentro de Conservação.

- [ ] **Step 4: Report results**

No commit for this task — it's verification only. If any step fails, go back to the relevant task, fix, and re-run the affected verification steps before proceeding.
