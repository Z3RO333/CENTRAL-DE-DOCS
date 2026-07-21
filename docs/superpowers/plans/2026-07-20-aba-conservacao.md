# Aba "Conservação" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate all documents (retenção, laudos, NF, orçamentos, contratos) belonging to prestadores classified as "empresas conservadoras" into a dedicated admin-only tab, out of the general Documentos listing — same pattern already used for the "Contratos" tab, but keyed on the prestador's category instead of the document type.

**Architecture:** Add a structured `categoria` column on `prestadores` (`'conservacao' | 'outro'`, default `'outro'`), coexisting with the existing free-text `tipo_servico`. `GET /api/documentos` gains a `categoriaPrestador` query param: by default it now excludes any document whose prestador has `categoria = 'conservacao'` (mirroring the existing `contratos` exclusion), and returns only those when `categoriaPrestador=conservacao` is passed. A new admin-only page `src/app/documentos/conservacao/page.tsx` consumes that param and lists every document type for those prestadores, reusing the existing `DocumentActions` / `DocumentDetailsDrawer` components. A "Valor" column (sourced from `dados.valor`, already collected on the orçamento form) is added to both the general Documentos listing and the new tab for any `tipo === "orcamentos"` row, so managers can compare values without opening each document.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + `@supabase/supabase-js` via a service-role admin client on the server), Tailwind CSS, Vitest.

## Global Constraints

- No changes to the `orcamentos_internos` module or its approval workflow — out of scope (spec section "Fora de escopo").
- No new AI evaluation of documents — out of scope.
- The new tab is visible only to `isAdmin` (same restriction as `/documentos/contratos`).
- `tipo_servico` on `prestadores` stays untouched (free text); `categoria` is a new, separate column.
- Follow existing code style: no comments unless explaining a non-obvious "why"; reuse existing helpers instead of duplicating logic.

---

### Task 1: Migration — add `categoria` to `prestadores`

**Files:**
- Create: `supabase/migrations/202607201500_add_categoria_prestadores.sql`

**Interfaces:**
- Produces: `public.prestadores.categoria` column (`text`, `not null default 'outro'`, `check (categoria in ('conservacao','outro'))`) — consumed by Tasks 3 and 4.

- [ ] **Step 1: Write the migration**

```sql
-- Adiciona categoria estruturada ao prestador, para separar empresas
-- conservadoras (ex.: JanPro) dos demais fornecedores sem depender do
-- texto livre em tipo_servico.
alter table public.prestadores
  add column if not exists categoria text not null default 'outro';

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'prestadores'
      and constraint_name = 'prestadores_categoria_check'
  ) then
    alter table public.prestadores drop constraint prestadores_categoria_check;
  end if;

  alter table public.prestadores
    add constraint prestadores_categoria_check
    check (categoria in ('conservacao', 'outro'));
end $$;
```

- [ ] **Step 2: Apply the migration to the project's Supabase database**

Run this SQL in the Supabase SQL Editor for this project (there is no local Supabase CLI workflow in this repo — migrations are applied by running the file's contents directly, matching how every other file in `supabase/migrations/` is applied here).

- [ ] **Step 3: Verify**

In the Supabase SQL Editor, run:

```sql
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'prestadores' and column_name = 'categoria';
```

Expected: one row, `data_type = text`, `column_default` containing `'outro'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202607201500_add_categoria_prestadores.sql
git commit -m "feat(prestadores): adiciona categoria estruturada (conservacao/outro)"
```

---

### Task 2: Shared helpers — `getValorOrcamento` / `formatCurrencyBRL`

**Files:**
- Modify: `src/lib/documentosApiUtils.ts`
- Modify: `src/app/documentos/_lib/documentosShared.ts`
- Test: `src/lib/documentosApiUtils.test.ts`

**Interfaces:**
- Produces: `getValorOrcamento(dados: Record<string, unknown> | null): number | null` and `formatCurrencyBRL(value: number | null): string | null`, both exported from `@/lib/documentosApiUtils` and re-exported from `@/app/documentos/_lib/documentosShared` — consumed by Tasks 7 and 8.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/documentosApiUtils.test.ts` (append inside the existing `describe("documentosApiUtils", ...)` block, after the last `it(...)`):

```ts
  it("getValorOrcamento le numero de dados.valor", () => {
    expect(getValorOrcamento({ valor: 1234.5 })).toBe(1234.5);
  });

  it("getValorOrcamento converte string com ponto decimal", () => {
    expect(getValorOrcamento({ valor: "1234.50" })).toBe(1234.5);
  });

  it("getValorOrcamento converte string com virgula decimal", () => {
    expect(getValorOrcamento({ valor: "1234,50" })).toBe(1234.5);
  });

  it("getValorOrcamento retorna null quando valor ausente ou invalido", () => {
    expect(getValorOrcamento(null)).toBeNull();
    expect(getValorOrcamento({})).toBeNull();
    expect(getValorOrcamento({ valor: "abc" })).toBeNull();
  });

  it("formatCurrencyBRL formata em Real com duas casas decimais", () => {
    expect(formatCurrencyBRL(1234.5)).toBe(
      (1234.5).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    );
  });

  it("formatCurrencyBRL retorna null quando valor e null", () => {
    expect(formatCurrencyBRL(null)).toBeNull();
  });
```

Update the import at the top of the same file:

```ts
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  formatCurrencyBRL,
  getValorOrcamento,
  normalizeIds,
  resolveLimit,
  safeParseDados,
} from "@/lib/documentosApiUtils";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/documentosApiUtils.test.ts`
Expected: FAIL — `getValorOrcamento`/`formatCurrencyBRL` are not exported yet.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/documentosApiUtils.ts`:

```ts
export const getValorOrcamento = (
  dados: Record<string, unknown> | null,
): number | null => {
  const raw = dados?.valor;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw.trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const formatCurrencyBRL = (value: number | null): string | null => {
  if (value === null) {
    return null;
  }
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/documentosApiUtils.test.ts`
Expected: PASS (all tests in the file, including the new ones).

- [ ] **Step 5: Re-export from documentosShared for client pages**

In `src/app/documentos/_lib/documentosShared.ts`, add this line right after the `import { supabase } from "@/lib/supabaseClient";` line at the top:

```ts
export { getValorOrcamento, formatCurrencyBRL } from "@/lib/documentosApiUtils";
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/documentosApiUtils.ts src/lib/documentosApiUtils.test.ts src/app/documentos/_lib/documentosShared.ts
git commit -m "feat(documentos): adiciona helpers de valor de orcamento (getValorOrcamento/formatCurrencyBRL)"
```

---

### Task 3: `/api/prestadores` — support `categoria`

**Files:**
- Modify: `src/app/api/prestadores/route.ts`
- Modify: `src/hooks/usePrestadores.ts`

**Interfaces:**
- Consumes: DB column `prestadores.categoria` (Task 1).
- Produces: `Prestador.categoria: string` (in `usePrestadores.ts`), `CreatePrestadorInput.categoria?: string` — consumed by Task 5 (prestadores page UI).

- [ ] **Step 1: Update `PrestadorRow` type and `normalizePrestador`**

In `src/app/api/prestadores/route.ts`, replace:

```ts
type PrestadorRow = {
  id: string;
  nome: string;
  cnpj: string;
  tipo_servico: string;
  usuarios: string[] | null;
  created_at: string;
  created_by: string | null;
};
```

with:

```ts
type PrestadorRow = {
  id: string;
  nome: string;
  cnpj: string;
  tipo_servico: string;
  categoria: string;
  usuarios: string[] | null;
  created_at: string;
  created_by: string | null;
};
```

Replace:

```ts
function normalizePrestador(item: PrestadorRow) {
  return {
    id: item.id,
    nome: fixMojibakeText(item.nome),
    cnpj: item.cnpj,
    tipo_servico: fixMojibakeText(item.tipo_servico),
    usuarios: item.usuarios ?? [],
    created_at: item.created_at,
  };
}
```

with:

```ts
function normalizePrestador(item: PrestadorRow) {
  return {
    id: item.id,
    nome: fixMojibakeText(item.nome),
    cnpj: item.cnpj,
    tipo_servico: fixMojibakeText(item.tipo_servico),
    categoria: item.categoria,
    usuarios: item.usuarios ?? [],
    created_at: item.created_at,
  };
}
```

- [ ] **Step 2: Include `categoria` in the GET select and mapping**

Replace:

```ts
    let query = supabaseAdmin
      .from("prestadores")
      .select("id,nome,cnpj,tipo_servico,usuarios,created_at")
      .order("created_at", { ascending: false });

    if (assignedOnly && email) {
      query = query.contains("usuarios", [email]);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const prestadores =
      data?.map((item) =>
        normalizePrestador({
          id: item.id as string,
          nome: item.nome as string,
          cnpj: item.cnpj as string,
          tipo_servico: item.tipo_servico as string,
          usuarios: (item.usuarios as string[] | null) ?? [],
          created_at: item.created_at as string,
          created_by: null,
        }),
      ) ?? [];
```

with:

```ts
    let query = supabaseAdmin
      .from("prestadores")
      .select("id,nome,cnpj,tipo_servico,categoria,usuarios,created_at")
      .order("created_at", { ascending: false });

    if (assignedOnly && email) {
      query = query.contains("usuarios", [email]);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const prestadores =
      data?.map((item) =>
        normalizePrestador({
          id: item.id as string,
          nome: item.nome as string,
          cnpj: item.cnpj as string,
          tipo_servico: item.tipo_servico as string,
          categoria: item.categoria as string,
          usuarios: (item.usuarios as string[] | null) ?? [],
          created_at: item.created_at as string,
          created_by: null,
        }),
      ) ?? [];
```

- [ ] **Step 3: Accept `categoria` on POST (create)**

Replace:

```ts
    const body = (await request.json()) as {
      nome?: string;
      cnpj?: string;
      tipo_servico?: string;
      usuarios?: string[];
    };

    const nome = body.nome ? fixMojibakeText(body.nome.trim()) : undefined;
    const cnpj = body.cnpj?.trim();
    const tipoServico = body.tipo_servico
      ? fixMojibakeText(body.tipo_servico.trim())
      : undefined;
    const usuarios = normalizeEmails(body.usuarios ?? []);

    if (!nome) {
      throw new HttpError(400, "Informe o nome do prestador.");
    }
    if (!tipoServico) {
      throw new HttpError(400, "Informe o tipo de servico.");
    }
    if (!cnpj) {
      throw new HttpError(400, "Informe o CNPJ do prestador.");
    }
    if (usuarios.length === 0) {
      throw new HttpError(
        400,
        "Informe ao menos um e-mail autorizado para o prestador.",
      );
    }

    const { data, error } = await supabaseAdmin
      .from("prestadores")
      .insert({
        nome,
        cnpj,
        tipo_servico: tipoServico,
        usuarios,
        created_by: user.id,
      })
      .select("id,nome,cnpj,tipo_servico,usuarios,created_at")
      .single();
```

with:

```ts
    const body = (await request.json()) as {
      nome?: string;
      cnpj?: string;
      tipo_servico?: string;
      categoria?: string;
      usuarios?: string[];
    };

    const nome = body.nome ? fixMojibakeText(body.nome.trim()) : undefined;
    const cnpj = body.cnpj?.trim();
    const tipoServico = body.tipo_servico
      ? fixMojibakeText(body.tipo_servico.trim())
      : undefined;
    const categoria = body.categoria === "conservacao" ? "conservacao" : "outro";
    const usuarios = normalizeEmails(body.usuarios ?? []);

    if (!nome) {
      throw new HttpError(400, "Informe o nome do prestador.");
    }
    if (!tipoServico) {
      throw new HttpError(400, "Informe o tipo de servico.");
    }
    if (!cnpj) {
      throw new HttpError(400, "Informe o CNPJ do prestador.");
    }
    if (usuarios.length === 0) {
      throw new HttpError(
        400,
        "Informe ao menos um e-mail autorizado para o prestador.",
      );
    }

    const { data, error } = await supabaseAdmin
      .from("prestadores")
      .insert({
        nome,
        cnpj,
        tipo_servico: tipoServico,
        categoria,
        usuarios,
        created_by: user.id,
      })
      .select("id,nome,cnpj,tipo_servico,categoria,usuarios,created_at")
      .single();
```

- [ ] **Step 4: Accept `categoria` on PATCH (update)**

Replace:

```ts
    const body = (await request.json()) as {
      id?: string;
      emails?: string[];
      remove_emails?: string[];
    };

    const prestadorId = body.id?.trim();
    const novosEmails = normalizeEmails(body.emails ?? []);
    const removerEmails = normalizeEmails(body.remove_emails ?? []);

    if (!prestadorId) {
      throw new HttpError(400, "Informe o prestador.");
    }
    if (novosEmails.length === 0 && removerEmails.length === 0) {
      throw new HttpError(400, "Informe ao menos um e-mail.");
    }
```

with:

```ts
    const body = (await request.json()) as {
      id?: string;
      emails?: string[];
      remove_emails?: string[];
      categoria?: string;
    };

    const prestadorId = body.id?.trim();
    const novosEmails = normalizeEmails(body.emails ?? []);
    const removerEmails = normalizeEmails(body.remove_emails ?? []);
    const hasCategoriaUpdate = Object.prototype.hasOwnProperty.call(
      body,
      "categoria",
    );

    if (!prestadorId) {
      throw new HttpError(400, "Informe o prestador.");
    }
    if (
      novosEmails.length === 0 &&
      removerEmails.length === 0 &&
      !hasCategoriaUpdate
    ) {
      throw new HttpError(400, "Informe ao menos um e-mail ou a categoria.");
    }
    if (
      hasCategoriaUpdate &&
      body.categoria !== "conservacao" &&
      body.categoria !== "outro"
    ) {
      throw new HttpError(400, "Categoria invalida.");
    }
```

Then replace:

```ts
    const { data: prestadorData, error: prestadorError } = await supabaseAdmin
      .from("prestadores")
      .select("id,nome,cnpj,tipo_servico,usuarios,created_at")
      .eq("id", prestadorId)
      .single();

    if (prestadorError) {
      throw prestadorError;
    }

    const existentes = (prestadorData?.usuarios as string[] | null) ?? [];
    const usuarios = normalizeEmails([...existentes, ...novosEmails]).filter(
      (value) => !removerEmails.includes(value),
    );

    const { data, error } = await supabaseAdmin
      .from("prestadores")
      .update({ usuarios })
      .eq("id", prestadorId)
      .select("id,nome,cnpj,tipo_servico,usuarios,created_at")
      .single();
```

with:

```ts
    const { data: prestadorData, error: prestadorError } = await supabaseAdmin
      .from("prestadores")
      .select("id,nome,cnpj,tipo_servico,categoria,usuarios,created_at")
      .eq("id", prestadorId)
      .single();

    if (prestadorError) {
      throw prestadorError;
    }

    const existentes = (prestadorData?.usuarios as string[] | null) ?? [];
    const usuarios = normalizeEmails([...existentes, ...novosEmails]).filter(
      (value) => !removerEmails.includes(value),
    );

    const updatePayload: { usuarios: string[]; categoria?: string } = {
      usuarios,
    };
    if (hasCategoriaUpdate) {
      updatePayload.categoria = body.categoria;
    }

    const { data, error } = await supabaseAdmin
      .from("prestadores")
      .update(updatePayload)
      .eq("id", prestadorId)
      .select("id,nome,cnpj,tipo_servico,categoria,usuarios,created_at")
      .single();
```

- [ ] **Step 5: Update `usePrestadores.ts` types**

In `src/hooks/usePrestadores.ts`, replace:

```ts
export type Prestador = {
  id: string;
  nome: string;
  cnpj: string;
  tipo_servico: string;
  usuarios: string[];
  created_at: string;
};

export type CreatePrestadorInput = {
  nome: string;
  cnpj: string;
  tipo_servico: string;
  usuarios: string[];
};
```

with:

```ts
export type Prestador = {
  id: string;
  nome: string;
  cnpj: string;
  tipo_servico: string;
  categoria: string;
  usuarios: string[];
  created_at: string;
};

export type CreatePrestadorInput = {
  nome: string;
  cnpj: string;
  tipo_servico: string;
  categoria?: string;
  usuarios: string[];
};
```

- [ ] **Step 6: Verify with the dev server**

Run: `npm run dev` (leave it running), then in another shell exercise the endpoint manually:

```bash
curl -s -X POST http://localhost:3000/api/prestadores \
  -H "Authorization: Bearer <admin-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"nome":"JanPro Teste","cnpj":"00.000.000/0000-00","tipo_servico":"Limpeza e Conservacao","categoria":"conservacao","usuarios":["teste@empresa.com"]}'
```

Expected: JSON response `{"prestador":{...,"categoria":"conservacao",...}}`. (Get `<admin-access-token>` from the browser's session after logging in as an admin — `supabase.auth.getSession()` in devtools console.)

- [ ] **Step 7: Commit**

```bash
git add src/app/api/prestadores/route.ts src/hooks/usePrestadores.ts
git commit -m "feat(prestadores): expoe categoria (conservacao/outro) na API"
```

---

### Task 4: `/api/documentos` — `categoriaPrestador` filter

**Files:**
- Modify: `src/app/api/documentos/route.ts`

**Interfaces:**
- Consumes: DB column `prestadores.categoria` (Task 1).
- Produces: query param `categoriaPrestador=conservacao` on `GET /api/documentos` — consumed by Task 7 (new page) and used implicitly (as the default-exclusion behavior) by the general Documentos listing.

- [ ] **Step 1: Add the exclusion/inclusion logic**

In `src/app/api/documentos/route.ts`, replace:

```ts
    let query = supabaseAdmin
      .from("formularios")
      .select(
        "id,tipo,status,arquivo_path,arquivo_assinado_path,created_at,dados,assinado_por,user_id,prestador_id",
        { count: "exact" },
      )
      .neq("tipo", "orcamentos_internos")
      .order("created_at", { ascending: false });

    if (tipoFilter !== "contratos") {
      query = query.neq("tipo", "contratos");
    }
```

with:

```ts
    let query = supabaseAdmin
      .from("formularios")
      .select(
        "id,tipo,status,arquivo_path,arquivo_assinado_path,created_at,dados,assinado_por,user_id,prestador_id",
        { count: "exact" },
      )
      .neq("tipo", "orcamentos_internos")
      .order("created_at", { ascending: false });

    if (tipoFilter !== "contratos") {
      query = query.neq("tipo", "contratos");
    }

    const categoriaPrestadorFilter = searchParams.get("categoriaPrestador");
    const {
      data: prestadoresConservacao,
      error: prestadoresConservacaoError,
    } = await supabaseAdmin
      .from("prestadores")
      .select("id")
      .eq("categoria", "conservacao");
    if (prestadoresConservacaoError) {
      throw prestadoresConservacaoError;
    }
    const conservacaoIds = ((prestadoresConservacao ?? []) as { id: string }[]).map(
      (item) => item.id,
    );

    if (categoriaPrestadorFilter === "conservacao") {
      query =
        conservacaoIds.length > 0
          ? query.in("prestador_id", conservacaoIds)
          : query.eq("prestador_id", "00000000-0000-0000-0000-000000000000");
    } else if (conservacaoIds.length > 0) {
      query = query.not("prestador_id", "in", `(${conservacaoIds.join(",")})`);
    }
```

- [ ] **Step 2: Verify with the dev server**

With `npm run dev` running and an admin access token:

```bash
curl -s "http://localhost:3000/api/documentos?limit=5" \
  -H "Authorization: Bearer <admin-access-token>" | head -c 2000
```

Expected: no document in `registros` has a `prestador_id` matching a prestador with `categoria='conservacao'` (check against the test prestador created in Task 3, Step 6, after attaching a document to it — this is easiest to verify after Task 7's page exists, so a lighter check for now is that the response is still valid JSON with `registros` and `total`).

```bash
curl -s "http://localhost:3000/api/documentos?categoriaPrestador=conservacao&limit=5" \
  -H "Authorization: Bearer <admin-access-token>" | head -c 2000
```

Expected: valid JSON with `registros` (empty array is fine if no conservation documents exist yet) and `total`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/documentos/route.ts
git commit -m "feat(documentos): filtra documentos de prestadores conservacao (categoriaPrestador)"
```

---

### Task 5: Prestadores page — manage `categoria`

**Files:**
- Modify: `src/app/prestadores/page.tsx`

**Interfaces:**
- Consumes: `Prestador.categoria`, `CreatePrestadorInput.categoria?` (Task 3).

- [ ] **Step 1: Add `categoria` to the create form state**

Replace:

```ts
  const [prestadorForm, setPrestadorForm] = useState({
    nome: "",
    tipoServico: "",
    cnpj: "",
    usuarios: "",
  });
```

with:

```ts
  const [prestadorForm, setPrestadorForm] = useState({
    nome: "",
    tipoServico: "",
    cnpj: "",
    categoria: "outro",
    usuarios: "",
  });
```

- [ ] **Step 2: Include `categoria` in the create submission**

Replace:

```ts
      const created = await createPrestador({
        nome: prestadorForm.nome.trim(),
        tipo_servico: prestadorForm.tipoServico.trim(),
        cnpj: prestadorForm.cnpj.trim(),
        usuarios: usuariosList,
      });
      setPrestadorFeedback({
        error: null,
        success: created
          ? `Prestador ${created.nome} cadastrado com sucesso!`
          : "Prestador cadastrado.",
      });
      setPrestadorForm({
        nome: "",
        tipoServico: "",
        cnpj: "",
        usuarios: "",
      });
```

with:

```ts
      const created = await createPrestador({
        nome: prestadorForm.nome.trim(),
        tipo_servico: prestadorForm.tipoServico.trim(),
        cnpj: prestadorForm.cnpj.trim(),
        categoria: prestadorForm.categoria,
        usuarios: usuariosList,
      });
      setPrestadorFeedback({
        error: null,
        success: created
          ? `Prestador ${created.nome} cadastrado com sucesso!`
          : "Prestador cadastrado.",
      });
      setPrestadorForm({
        nome: "",
        tipoServico: "",
        cnpj: "",
        categoria: "outro",
        usuarios: "",
      });
```

- [ ] **Step 3: Add the categoria select to the create modal**

Replace:

```tsx
                <label className="text-xs font-semibold text-slate-600">
                  Tipo de serviço
                  <input
                    type="text"
                    value={prestadorForm.tipoServico}
                    onChange={(event) =>
                      handlePrestadorFieldChange("tipoServico", event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    placeholder="Ex.: Laudos técnicos"
                    required
                  />
                </label>
```

with:

```tsx
                <label className="text-xs font-semibold text-slate-600">
                  Tipo de serviço
                  <input
                    type="text"
                    value={prestadorForm.tipoServico}
                    onChange={(event) =>
                      handlePrestadorFieldChange("tipoServico", event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    placeholder="Ex.: Laudos técnicos"
                    required
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Categoria
                  <select
                    value={prestadorForm.categoria}
                    onChange={(event) =>
                      handlePrestadorFieldChange("categoria", event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  >
                    <option value="outro">Outro</option>
                    <option value="conservacao">Conservação/Limpeza</option>
                  </select>
                  <span className="text-[11px] font-normal text-slate-500">
                    Prestadores de conservação ficam separados na aba "Conservação".
                  </span>
                </label>
```

- [ ] **Step 4: Add a categoria editor to the details panel**

Replace:

```tsx
                    <p>
                      <span className="font-semibold text-slate-700">
                        Tipo de serviço:
                      </span>{" "}
                      {selectedPrestador.tipo_servico}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-700">CNPJ:</span>{" "}
                      {selectedPrestador.cnpj}
                    </p>
```

with:

```tsx
                    <p>
                      <span className="font-semibold text-slate-700">
                        Tipo de serviço:
                      </span>{" "}
                      {selectedPrestador.tipo_servico}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-700">CNPJ:</span>{" "}
                      {selectedPrestador.cnpj}
                    </p>
                    <label className="flex items-center gap-2">
                      <span className="font-semibold text-slate-700">Categoria:</span>
                      <select
                        value={selectedPrestador.categoria}
                        onChange={(event) =>
                          void handleCategoriaChange(
                            selectedPrestador.id,
                            event.target.value,
                          )
                        }
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      >
                        <option value="outro">Outro</option>
                        <option value="conservacao">Conservação/Limpeza</option>
                      </select>
                    </label>
```

- [ ] **Step 5: Add the `handleCategoriaChange` handler**

Add this function right after `handleEmailsSubmit` (defined at line ~727 in the current file, immediately after its closing `};`):

```ts
  const handleCategoriaChange = async (prestadorId: string, categoria: string) => {
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("Sessão expirada. Faça login novamente.");
      }

      const response = await fetch("/api/prestadores", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: prestadorId, categoria }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível atualizar a categoria.");
      }

      await refreshPrestadores();
    } catch (err) {
      setPrestadorFeedback({
        error:
          err instanceof Error
            ? err.message
            : "Não foi possível atualizar a categoria.",
        success: null,
      });
    }
  };
```

- [ ] **Step 6: Verify with the dev server**

Run `npm run dev`, log in as admin, open `/prestadores`:
1. Click "Cadastrar prestador", fill the form, set Categoria to "Conservação/Limpeza", save. Confirm the prestador is created without error.
2. Select that prestador in the list, open its details panel, change the Categoria select to "Outro" and back to "Conservação/Limpeza". Confirm no error toast appears and the value persists after a page refresh.

- [ ] **Step 7: Commit**

```bash
git add src/app/prestadores/page.tsx
git commit -m "feat(prestadores): permite definir categoria conservacao/outro no cadastro"
```

---

### Task 6: AppShell — "Conservação" nav item

**Files:**
- Modify: `src/components/AppShell.tsx`

**Interfaces:**
- Produces: `/documentos/conservacao` route link, visible only when `isAdmin && !documentsAccessLoading` — consumed by Task 7 (the page must exist at that path for the link to resolve).

- [ ] **Step 1: Import the icon**

Replace:

```ts
import {
  LayoutDashboard,
  FileText,
  Bot,
  LogOut,
  UserRound,
  BarChart3,
  ShieldCheck,
  Building2,
  Store,
  FolderOpen,
  HelpCircle,
  Menu,
  CircleAlert,
  MailWarning,
  FileCheck2,
  ClipboardSignature,
  FileSignature,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
```

with:

```ts
import {
  LayoutDashboard,
  FileText,
  Bot,
  LogOut,
  UserRound,
  BarChart3,
  ShieldCheck,
  Building2,
  Store,
  FolderOpen,
  HelpCircle,
  Menu,
  CircleAlert,
  MailWarning,
  FileCheck2,
  ClipboardSignature,
  FileSignature,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
```

- [ ] **Step 2: Add the nav entry and exclude the route from "Documentos" active-state**

Replace:

```ts
        {
          href: "/documentos",
          label: "Documentos",
          icon: FileText,
          isActive:
            pathname?.startsWith("/documentos") &&
            !pathname?.startsWith("/documentos/por-loja") &&
            !pathname?.startsWith("/documentos/pendencias") &&
            !pathname?.startsWith("/documentos/cobrancas") &&
            !pathname?.startsWith("/documentos/btracker") &&
            !pathname?.startsWith("/documentos/orcamentos-internos") &&
            !pathname?.startsWith("/documentos/contratos"),
          isVisible: canAccessDocuments,
        },
        {
          href: "/documentos/contratos",
          label: "Contratos",
          icon: FileSignature,
          isActive: pathname?.startsWith("/documentos/contratos"),
          isVisible: isAdmin && !documentsAccessLoading,
        },
```

with:

```ts
        {
          href: "/documentos",
          label: "Documentos",
          icon: FileText,
          isActive:
            pathname?.startsWith("/documentos") &&
            !pathname?.startsWith("/documentos/por-loja") &&
            !pathname?.startsWith("/documentos/pendencias") &&
            !pathname?.startsWith("/documentos/cobrancas") &&
            !pathname?.startsWith("/documentos/btracker") &&
            !pathname?.startsWith("/documentos/orcamentos-internos") &&
            !pathname?.startsWith("/documentos/contratos") &&
            !pathname?.startsWith("/documentos/conservacao"),
          isVisible: canAccessDocuments,
        },
        {
          href: "/documentos/contratos",
          label: "Contratos",
          icon: FileSignature,
          isActive: pathname?.startsWith("/documentos/contratos"),
          isVisible: isAdmin && !documentsAccessLoading,
        },
        {
          href: "/documentos/conservacao",
          label: "Conservação",
          icon: Sparkles,
          isActive: pathname?.startsWith("/documentos/conservacao"),
          isVisible: isAdmin && !documentsAccessLoading,
        },
```

- [ ] **Step 3: Verify with the dev server**

Run `npm run dev`, log in as admin: confirm "Conservação" appears in the sidebar under "Operação", right after "Contratos". Log in (or simulate) as a non-admin: confirm it does not appear. Clicking it should currently 404 (page created in Task 7).

- [ ] **Step 4: Commit**

```bash
git add src/components/AppShell.tsx
git commit -m "feat(nav): adiciona item Conservacao ao menu, restrito a admin"
```

---

### Task 7: New page `src/app/documentos/conservacao/page.tsx`

**Files:**
- Create: `src/app/documentos/conservacao/page.tsx`

**Interfaces:**
- Consumes: `GET /api/documentos?categoriaPrestador=conservacao` (Task 4), `DocumentActions`, `DocumentDetailsDrawer`, `getEditFields`, `getIdentificacaoConfig`, `getIdentificacaoValor`, `getSignedFileUrl`, `resolveSignedPdfPath`, `normalizeRegistroStatus`, `formatStatusLabel`, `getTipoDescricao`, `getDocumentoNome`, `TIPO_LABEL`, `getValorOrcamento`, `formatCurrencyBRL` (all already exported from `../_lib/documentosShared`, the last two added in Task 2).

- [ ] **Step 1: Create the page**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { DocumentActions } from "../_components/DocumentActions";
import { DocumentDetailsDrawer } from "../_components/DocumentDetailsDrawer";
import {
  type FormularioRecord,
  type EditField,
  TIPO_LABEL,
  getEditFields,
  getIdentificacaoConfig,
  getIdentificacaoValor,
  getSignedFileUrl,
  resolveSignedPdfPath,
  normalizeRegistroStatus,
  formatStatusLabel,
  getTipoDescricao,
  getDocumentoNome,
  getValorOrcamento,
  formatCurrencyBRL,
} from "../_lib/documentosShared";

const CATEGORIA_CONSERVACAO = "conservacao";

type PdfAction = { id: string; type: "open" | "download" } | null;

type EditDialogState = {
  registro: FormularioRecord;
  values: Record<string, string>;
};

const getPathParaVisualizacao = (registro: FormularioRecord) =>
  resolveSignedPdfPath(registro.arquivo_assinado_path) ??
  registro.arquivo_assinado_path ??
  registro.arquivo_path;

const downloadSignedUrlAsBlob = async (signedUrl: string, fileName: string) => {
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error("Não foi possível baixar o arquivo.");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};

export default function ConservacaoPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();
  const canAccess = isAdmin;
  const canManageDocuments = isAdmin;

  const [registros, setRegistros] = useState<FormularioRecord[]>([]);
  const [tipoFilter, setTipoFilter] = useState<string>("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pdfAction, setPdfAction] = useState<PdfAction>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedRegistro, setSelectedRegistro] = useState<FormularioRecord | null>(null);

  const [editDialog, setEditDialog] = useState<EditDialogState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [confirmRemove, setConfirmRemove] = useState<FormularioRecord | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
    if (!authLoading && user && !accessLoading && !canAccess) {
      router.replace("/documentos");
    }
  }, [accessLoading, authLoading, canAccess, router, user]);

  const getAccessToken = useCallback(async () => {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    return token;
  }, []);

  const carregarDocumentos = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const params = new URLSearchParams({
        categoriaPrestador: CATEGORIA_CONSERVACAO,
        limit: "500",
        offset: "0",
      });
      const response = await fetch(`/api/documentos?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json()) as {
        registros?: FormularioRecord[];
        error?: string;
      };
      if (!response.ok || !payload.registros) {
        throw new Error(payload.error ?? "Não foi possível carregar os documentos.");
      }
      setRegistros(payload.registros.map((r) => normalizeRegistroStatus(r)));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível carregar os documentos.",
      );
      setRegistros([]);
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, user]);

  useEffect(() => {
    if (user) void carregarDocumentos();
  }, [carregarDocumentos, user]);

  const tiposDisponiveis = Array.from(new Set(registros.map((r) => r.tipo))).sort();
  const registrosFiltrados =
    tipoFilter === "todos" ? registros : registros.filter((r) => r.tipo === tipoFilter);

  const abrirDocumento = async (registro: FormularioRecord) => {
    const path = getPathParaVisualizacao(registro);
    if (!path) {
      setError("Arquivo indisponível no momento.");
      return;
    }
    try {
      setPdfAction({ id: registro.id, type: "open" });
      setError(null);
      const signedUrl = await getSignedFileUrl(path);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("Erro ao abrir documento:", err);
      setError("Não foi possível abrir o PDF.");
    } finally {
      setPdfAction(null);
    }
  };

  const baixarDocumento = async (registro: FormularioRecord) => {
    const path = getPathParaVisualizacao(registro);
    if (!path) {
      setError("Arquivo indisponível no momento.");
      return;
    }
    try {
      setPdfAction({ id: registro.id, type: "download" });
      setError(null);
      const signedUrl = await getSignedFileUrl(path);
      const nome = getDocumentoNome(registro) || path.split("/").pop() || "documento.pdf";
      await downloadSignedUrlAsBlob(signedUrl, nome);
    } catch (err) {
      console.error("Erro ao baixar documento:", err);
      setError("Não foi possível baixar o PDF.");
    } finally {
      setPdfAction(null);
    }
  };

  const marcarComoRevisado = async (registro: FormularioRecord) => {
    if (!canManageDocuments) return;
    try {
      setReviewingId(registro.id);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/documentos", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: registro.id, status: "revisado" }),
      });
      const payload = (await response.json()) as {
        registro?: FormularioRecord;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível revisar o documento.");
      }
      setRegistros((prev) =>
        prev.map((item) =>
          item.id === registro.id
            ? normalizeRegistroStatus(payload.registro ?? { ...item, status: "revisado" })
            : item,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível revisar o documento.");
    } finally {
      setReviewingId(null);
    }
  };

  const abrirEdicao = (registro: FormularioRecord) => {
    if (!canManageDocuments) return;
    const campos = getEditFields(registro.tipo);
    const values = campos.reduce<Record<string, string>>((acc, campo) => {
      const raw = registro.dados?.[campo.name];
      acc[campo.name] = raw === null || raw === undefined ? "" : String(raw);
      return acc;
    }, {});
    setEditDialog({ registro, values });
  };

  const salvarEdicao = async () => {
    if (!editDialog) return;
    try {
      setSavingEdit(true);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/documentos", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: editDialog.registro.id,
          updates: editDialog.values,
        }),
      });
      const payload = (await response.json()) as {
        registro?: FormularioRecord;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível atualizar o documento.");
      }
      setRegistros((prev) =>
        prev.map((item) =>
          item.id === editDialog.registro.id
            ? normalizeRegistroStatus(
                payload.registro ?? {
                  ...item,
                  dados: { ...(item.dados ?? {}), ...editDialog.values },
                },
              )
            : item,
        ),
      );
      setEditDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar o documento.");
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmarRemocao = async () => {
    if (!confirmRemove) return;
    try {
      setDeletingId(confirmRemove.id);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch(
        `/api/documentos?id=${encodeURIComponent(confirmRemove.id)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível remover o documento.");
      }
      setRegistros((prev) => prev.filter((item) => item.id !== confirmRemove.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover o documento.");
    } finally {
      setDeletingId(null);
      setConfirmRemove(null);
    }
  };

  const editFields: EditField[] = editDialog ? getEditFields(editDialog.registro.tipo) : [];

  if (authLoading || accessLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando documentos de conservação...
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
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-slate-700" />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Conservação
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Documentos das empresas conservadoras, separados dos demais fornecedores.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={tipoFilter}
            onChange={(event) => setTipoFilter(event.target.value)}
            className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
          >
            <option value="todos">Todos os tipos</option>
            {tiposDisponiveis.map((tipo) => (
              <option key={tipo} value={tipo}>
                {TIPO_LABEL[tipo] ?? getTipoDescricao(tipo)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void carregarDocumentos()}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
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
          {loading && (
            <span className="inline-flex items-center gap-1">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Carregando
            </span>
          )}
        </div>

        {!loading && registrosFiltrados.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Nenhum documento de conservação encontrado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Documento</th>
                  <th className="px-4 py-3">Identificação</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {registrosFiltrados.map((registro) => {
                  const identificacaoConfig = getIdentificacaoConfig(registro.tipo);
                  const identificacao =
                    getIdentificacaoValor(registro) ??
                    `${identificacaoConfig.label} não informado`;
                  const nomeDocumento = getDocumentoNome(registro);
                  const valorOrcamento =
                    registro.tipo === "orcamentos"
                      ? formatCurrencyBRL(getValorOrcamento(registro.dados))
                      : null;
                  const opening = pdfAction?.id === registro.id && pdfAction.type === "open";
                  const downloading =
                    pdfAction?.id === registro.id && pdfAction.type === "download";

                  return (
                    <tr
                      key={registro.id}
                      className="cursor-pointer align-top hover:bg-slate-50"
                      onClick={() => {
                        setSelectedRegistro(registro);
                        setSelectedDocumentId(registro.id);
                      }}
                    >
                      <td className="px-4 py-3">
                        <p className="max-w-[220px] break-words font-semibold text-slate-900">
                          {nomeDocumento}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {identificacaoConfig.label}
                        </p>
                        <p className="text-sm font-medium text-slate-900">{identificacao}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {getTipoDescricao(registro.tipo)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-slate-600">
                        {valorOrcamento ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                          {formatStatusLabel(registro.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                        <DocumentActions
                          registro={registro}
                          canManageDocuments={canManageDocuments}
                          canReview={
                            registro.status !== "revisado" && registro.status !== "assinado"
                          }
                          canSign={false}
                          opening={opening}
                          downloading={downloading}
                          deleting={deletingId === registro.id}
                          reviewing={reviewingId === registro.id}
                          containerClassName="flex flex-wrap justify-end gap-2 text-[11px]"
                          onOpen={abrirDocumento}
                          onDownload={baixarDocumento}
                          onReview={marcarComoRevisado}
                          onEdit={abrirEdicao}
                          onRemove={(r) => setConfirmRemove(r)}
                          onSign={() => {}}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <DocumentDetailsDrawer
        documentId={selectedDocumentId}
        fallbackRegistro={selectedRegistro}
        isOpen={Boolean(selectedDocumentId)}
        canManageDocuments={canManageDocuments}
        pdfAction={pdfAction}
        reviewingId={reviewingId}
        onClose={() => {
          setSelectedDocumentId(null);
          setSelectedRegistro(null);
        }}
        onOpenPdf={(registro) => void abrirDocumento(registro)}
        onDownloadPdf={(registro) => void baixarDocumento(registro)}
        onEdit={(registro) => abrirEdicao(registro)}
        onReview={(registro) => void marcarComoRevisado(registro)}
        onSign={() => {}}
        onAppliedSuggestions={(registro) => {
          setRegistros((prev) =>
            prev.map((item) => (item.id === registro.id ? registro : item)),
          );
        }}
      />

      {editDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setEditDialog(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Editar documento</h2>
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {editFields.map((campo) => (
                <label
                  key={campo.name}
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  {campo.label}
                  {campo.type === "textarea" ? (
                    <textarea
                      value={editDialog.values[campo.name] ?? ""}
                      onChange={(event) =>
                        setEditDialog((prev) =>
                          prev
                            ? {
                                ...prev,
                                values: { ...prev.values, [campo.name]: event.target.value },
                              }
                            : prev,
                        )
                      }
                      className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                    />
                  ) : (
                    <input
                      type={
                        campo.type === "date"
                          ? "date"
                          : campo.type === "number"
                            ? "number"
                            : "text"
                      }
                      value={editDialog.values[campo.name] ?? ""}
                      onChange={(event) =>
                        setEditDialog((prev) =>
                          prev
                            ? {
                                ...prev,
                                values: { ...prev.values, [campo.name]: event.target.value },
                              }
                            : prev,
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
                    />
                  )}
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditDialog(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => void salvarEdicao()}
                className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
              >
                {savingEdit ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmRemove && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setConfirmRemove(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2 text-red-600">
              <h2 className="text-sm font-semibold">Remover documento</h2>
            </div>
            <p className="text-sm text-slate-600">
              Tem certeza que deseja remover este documento? Essa ação não pode ser
              desfeita.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRemove(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingId === confirmRemove.id}
                onClick={() => void confirmarRemocao()}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60"
              >
                {deletingId === confirmRemove.id ? "Removendo..." : "Remover"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify with the dev server**

Run `npm run dev`, log in as admin:
1. In `/prestadores`, confirm (or create, per Task 3/5) a prestador with `categoria = conservacao` — note its name.
2. In `/formulario/orcamentos` (or any other slug), submit a document choosing that prestador, filling `valor` with e.g. `1500.00`.
3. Go to `/documentos/conservacao`. Confirm the document just created appears in the table, with the correct "Tipo", and "Valor" showing `R$ 1.500,00`.
4. Go to `/documentos` (general list). Confirm that same document does **not** appear there.
5. Click the row in `/documentos/conservacao` — confirm the details drawer opens with the document's data.
6. Click "Confirmar revisão" — confirm the status changes to "Revisado".

- [ ] **Step 3: Commit**

```bash
git add src/app/documentos/conservacao/page.tsx
git commit -m "feat(documentos): adiciona aba Conservacao para prestadores categoria=conservacao"
```

---

### Task 8: "Valor" column for `tipo=orcamentos` in the general Documentos listing

**Files:**
- Modify: `src/app/documentos/page.tsx`

**Interfaces:**
- Consumes: `getValorOrcamento`, `formatCurrencyBRL` from `../_lib/documentosShared` (Task 2).

- [ ] **Step 1: Import the helpers**

Find the import block from `"./_lib/documentosShared"` near the top of the file and add `getValorOrcamento` and `formatCurrencyBRL` to it (keep the existing imports, just extend the list — do not reformat the rest of the import).

- [ ] **Step 2: Add the table header column**

Replace:

```tsx
                  <th className="w-[240px] px-4 py-3 text-left">Documento</th>
                  <th className="w-[300px] px-4 py-3 text-left">Identificação</th>
                  <th className="w-[140px] px-4 py-3 text-left">Tipo</th>
                  <th className="hidden w-[150px] px-4 py-3 text-left lg:table-cell">
                    Tipo de laudo
                  </th>
```

with:

```tsx
                  <th className="w-[240px] px-4 py-3 text-left">Documento</th>
                  <th className="w-[300px] px-4 py-3 text-left">Identificação</th>
                  <th className="w-[140px] px-4 py-3 text-left">Tipo</th>
                  <th className="hidden w-[110px] px-4 py-3 text-right lg:table-cell">
                    Valor
                  </th>
                  <th className="hidden w-[150px] px-4 py-3 text-left lg:table-cell">
                    Tipo de laudo
                  </th>
```

- [ ] **Step 3: Compute the value and render the table cell**

In the table `<tbody>` row-mapping block, find:

```tsx
                  const numeroNf = getNumeroNf(registro);
                  const numeroPedido = getNumeroPedido(registro);
                  const cnpjDocumento = getCnpjDocumento(registro);
                  const lojaNome = getLojaNome(registro);
```

(this is the occurrence inside the `<table>` section, around line 2409 — there is a second, near-identical occurrence in the cards section handled in Step 4) and replace with:

```tsx
                  const numeroNf = getNumeroNf(registro);
                  const numeroPedido = getNumeroPedido(registro);
                  const cnpjDocumento = getCnpjDocumento(registro);
                  const lojaNome = getLojaNome(registro);
                  const valorOrcamento =
                    registro.tipo === "orcamentos"
                      ? formatCurrencyBRL(getValorOrcamento(registro.dados))
                      : null;
```

Then find the "Tipo" cell:

```tsx
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {getTipoDescricao(registro.tipo)}
                      </td>
                      <td className="hidden px-4 py-3 text-xs leading-5 text-slate-500 lg:table-cell">
                        {registro.tipo === TIPO_ASSINAVEL && tipoLaudo
                          ? tipoLaudo
                          : "-"}
                      </td>
```

and replace with:

```tsx
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {getTipoDescricao(registro.tipo)}
                      </td>
                      <td className="hidden px-4 py-3 text-right text-xs text-slate-600 lg:table-cell">
                        {valorOrcamento ?? "-"}
                      </td>
                      <td className="hidden px-4 py-3 text-xs leading-5 text-slate-500 lg:table-cell">
                        {registro.tipo === TIPO_ASSINAVEL && tipoLaudo
                          ? tipoLaudo
                          : "-"}
                      </td>
```

- [ ] **Step 4: Add a "Valor" badge to the cards view**

In the cards-view mapping block, find:

```tsx
            const numeroNf = getNumeroNf(registro);
            const numeroPedido = getNumeroPedido(registro);
            const cnpjDocumento = getCnpjDocumento(registro);
            const lojaNome = getLojaNome(registro);
```

and replace with:

```tsx
            const numeroNf = getNumeroNf(registro);
            const numeroPedido = getNumeroPedido(registro);
            const cnpjDocumento = getCnpjDocumento(registro);
            const lojaNome = getLojaNome(registro);
            const valorOrcamento =
              registro.tipo === "orcamentos"
                ? formatCurrencyBRL(getValorOrcamento(registro.dados))
                : null;
```

Then find the badge cluster in the cards view:

```tsx
                      {cnpjDocumento && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">
                          CNPJ: {cnpjDocumento}
                        </span>
                      )}
                    </div>
```

(this occurrence is inside the cards-view block, immediately followed by `{edicaoInfo && (` in the surrounding code) and replace with:

```tsx
                      {cnpjDocumento && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">
                          CNPJ: {cnpjDocumento}
                        </span>
                      )}
                      {valorOrcamento && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">
                          Valor: {valorOrcamento}
                        </span>
                      )}
                    </div>
```

- [ ] **Step 5: Verify with the dev server**

Run `npm run dev`, log in as admin, go to `/documentos`:
1. Filter by Tipo = "Orçamentos". Confirm the table shows a "Valor" column (desktop width) with `R$ ...` for each row that has `dados.valor` set, and "-" for rows without it.
2. Switch to card view (mobile-width or the view toggle). Confirm a "Valor: R$ ..." badge appears on orçamento cards.
3. Filter by a different Tipo (e.g. "Notas Fiscais"). Confirm the Valor column shows "-" for all rows (since the column is specific to `tipo === "orcamentos"`).

- [ ] **Step 6: Commit**

```bash
git add src/app/documentos/page.tsx
git commit -m "feat(documentos): adiciona coluna Valor para documentos tipo orcamentos"
```

---

### Task 9: End-to-end verification against the spec's test plan

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass, including the new ones from Task 2.

- [ ] **Step 2: Run the production build**

```bash
npm run build
```

Expected: build succeeds with no TypeScript errors (this catches any signature mismatch introduced across Tasks 3–8, since `Prestador`, `FormularioRecord`, and the shared helpers are used across several files).

- [ ] **Step 3: Walk through the spec's test plan manually**

With `npm run dev` running and logged in as admin:
1. Cadastrar um documento de qualquer tipo para um prestador com `categoria='conservacao'` — confirmar que ele não aparece em `/documentos`, mas aparece em `/documentos/conservacao`.
2. Cadastrar um documento para um prestador `categoria='outro'` — confirmar que continua aparecendo em `/documentos` normalmente.
3. Confirmar que a coluna "Valor" aparece corretamente para documentos `tipo=orcamentos` tanto em `/documentos` quanto em `/documentos/conservacao`.
4. Logar como um usuário não-admin (ou usar o modo de simulação, se disponível) e confirmar que o item de menu "Conservação" não aparece e que acessar `/documentos/conservacao` diretamente redireciona para `/documentos`.

- [ ] **Step 4: Report results**

No commit for this task — it's verification only. If any step fails, go back to the relevant task, fix, and re-run the affected verification steps before proceeding.
