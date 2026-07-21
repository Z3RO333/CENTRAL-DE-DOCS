# Final review fix — NULL prestador_id exclusion bug

## What was implemented

File: `src/app/api/documentos/route.ts`, inside the `categoriaPrestadorFilter` block (default branch, no `categoriaPrestador` query param, with at least one `conservacao` prestador in the DB).

Before:
```ts
} else if (conservacaoIds.length > 0) {
  query = query.not("prestador_id", "in", `(${conservacaoIds.join(",")})`);
}
```

After:
```ts
} else if (conservacaoIds.length > 0) {
  query = query.or(
    `prestador_id.is.null,prestador_id.not.in.(${conservacaoIds.join(",")})`,
  );
}
```

Only this branch's body was changed. The `categoriaPrestadorFilter === "conservacao"` branch (`.in(...)` / sentinel-UUID fallback) was left untouched, as instructed — a conservação-only view correctly excludes NULL-prestador documents. No other filters, and no `DELETE`/`PATCH` handlers, were touched.

### Composition with the access-control `.or()` call

Verified in `node_modules/@supabase/postgrest-js/dist/cjs/PostgrestFilterBuilder.js`:

```js
or(filters, { foreignTable, referencedTable = foreignTable } = {}) {
    const key = referencedTable ? `${referencedTable}.or` : 'or';
    this.url.searchParams.append(key, `(${filters})`);
    return this;
}
```

It uses `URLSearchParams.append`, not `.set` — so each `.or()` call adds its own separate `or=(...)` query-string parameter rather than overwriting a prior one. PostgREST ANDs together multiple query parameters (including repeated `or` params), so the new `.or()` call for NULL-preservation composes as an AND with the pre-existing `query.or(accessOr.join(","))` access-control filter at line ~209 in the same file. This confirms the fix does not weaken or bypass non-admin access control — the two `.or()` groups combine as `(access-control conditions) AND (prestador_id IS NULL OR prestador_id NOT IN (conservação ids))`.

## Hand-traced scenarios (default listing, no `categoriaPrestador` param)

**(a) No conservação prestadores exist at all** (`conservacaoIds.length === 0`)
Neither `if` branch fires — `conservacaoIds.length > 0` is false, so the `else if` is skipped entirely. No filter is applied for this concern; behavior is identical to pre-feature code. All documents (NULL or not) pass through normally.

**(b) Document with `prestador_id = null`, conservação prestadores exist** (`conservacaoIds.length > 0`)
New `.or()` filter applies: `prestador_id.is.null,prestador_id.not.in.(id1,id2,...)`. First predicate `prestador_id IS NULL` evaluates to `true` for this row → OR result is `true` → row is **included**. This is the fix: previously `NOT (NULL IN (...))` evaluated to `NULL`, which `WHERE` treats as non-matching, so the row was silently dropped.

**(c) Document with `prestador_id` pointing to a conservação prestador**
`prestador_id IS NULL` → `false`. `prestador_id NOT IN (id1,id2,...)` → this id is a member of the list, so `IN` is `true`, `NOT IN` is `false`. OR of `false, false` → `false` → row is **excluded**. Correct: conservação-prestador documents must not appear in the default/general listing.

**(d) Document with `prestador_id` pointing to a non-conservação prestador**
`prestador_id IS NULL` → `false`. `prestador_id NOT IN (id1,id2,...)` → this id is not in the conservação list, so `IN` is `false`, `NOT IN` is `true`. OR of `false, true` → `true` → row is **included**. Correct: normal non-conservação prestador documents keep appearing in the general listing.

## Build result

`npm run build` completed successfully — TypeScript compiled with no errors, all 42 static/dynamic routes generated (including `/api/documentos` and `/documentos/conservacao`). Only unrelated `[baseline-browser-mapping]` staleness warnings appeared (pre-existing, unrelated to this change).

## Files changed

- `c:\formulario\app\src\app\api\documentos\route.ts` — 1 file, 3 insertions, 1 deletion.

## Concerns

None identified. The fix is scoped exactly to the described block; the access-control `.or()` composition was verified against the installed `postgrest-js` source rather than assumed. No other code paths in the file were touched.

## Commit

`470c000` — `fix(documentos): preserva documentos sem prestador na listagem geral`

## Fix: widen Conservação access to gerente_loja

### Background

Product decision from the final whole-branch review: both `admin` and `gerente_loja` users should be able to see the "Conservação" tab and page — not `fornecedor` or `colaborador`. Reasoning: once a prestador is marked `categoria='conservacao'`, its documents disappear from the general `/documentos` listing by design; a `gerente_loja` manager who was previously seeing that prestador's documents there (via `documentos_acesso`, `scope='gerente'`) would otherwise lose visibility entirely, since the Conservação tab had been built admin-only.

The backend (`/api/documentos`) required no change — non-admin callers already get `buildDocumentosAccessOr` applied as an independent AND'd filter regardless of the `categoriaPrestador` param, verified in an earlier review round. This fix is purely about UI visibility (nav item + page access gate), not access control.

### What was implemented

**1. `src/components/AppShell.tsx`** — the "Conservação" nav item's `isVisible`, following the exact pattern already used by `canAccessCobrancas` in the same file (line 57-58):

Before:
```ts
isVisible: isAdmin && !documentsAccessLoading,
```

After:
```ts
isVisible: (isAdmin || role === "gerente_loja") && !documentsAccessLoading,
```

`role` was already destructured from `useDocumentsAccess()` near the top of the component (line 45), alongside `isAdmin`, `modules`, and `loading: documentsAccessLoading` — no new destructuring needed.

**2. `src/app/documentos/conservacao/page.tsx`** — the page's access gate:

Before:
```ts
const { isAdmin, loading: accessLoading } = useDocumentsAccess();
const canAccess = isAdmin;
const canManageDocuments = isAdmin;
```

After:
```ts
const { isAdmin, role, loading: accessLoading } = useDocumentsAccess();
const canAccess = isAdmin || role === "gerente_loja";
const canManageDocuments = isAdmin;
```

`canManageDocuments` was deliberately left `isAdmin`-only — the product decision was that managers can *view* the Conservação tab, not edit/review/remove documents there. `canManageDocuments` gates the edit/review/remove buttons via `DocumentActions`/`DocumentDetailsDrawer` and is unrelated to the visibility fix. No other line in the file was touched.

### Hand-traced scenarios

**Nav item `isVisible` in `AppShell.tsx`** — `(isAdmin || role === "gerente_loja") && !documentsAccessLoading` (assuming `documentsAccessLoading === false` in all cases, i.e. access data has resolved):

- `isAdmin=true, role="admin"` → `(true || ...) && true` → **true** (visible) — unchanged from before.
- `isAdmin=false, role="gerente_loja"` → `(false || true) && true` → **true** (visible) — this is the fix; previously `isAdmin && ...` = `false`.
- `isAdmin=false, role="colaborador"` → `(false || false) && true` → **false** (hidden) — unchanged.
- `isAdmin=false, role="fornecedor"` → `(false || false) && true` → **false** (hidden) — unchanged.

**Page `canAccess` in `conservacao/page.tsx`** — `isAdmin || role === "gerente_loja"`:

- `isAdmin=true, role="admin"` → **true** (no redirect) — unchanged from before.
- `isAdmin=false, role="gerente_loja"` → **true** (no redirect) — this is the fix; previously `canAccess = isAdmin` = `false`, would have redirected.
- `isAdmin=false, role="colaborador"` → **false** (redirect fires, per the `useEffect` at line ~87: `if (!authLoading && user && !accessLoading && !canAccess) { ... }`) — unchanged.
- `isAdmin=false, role="fornecedor"` → **false** (redirect fires) — unchanged.

`canManageDocuments = isAdmin` is unaffected in all four scenarios — only `true` for the admin case, exactly as before, so gerente_loja users can view but not edit/review/remove documents on this page.

### Build result

`npm run build` completed successfully — TypeScript compiled with no errors, all routes generated including `/documentos/conservacao`. Only unrelated `[baseline-browser-mapping]` staleness warnings appeared (pre-existing, unrelated to this change).

### Files changed

- `src/components/AppShell.tsx` — nav item `isVisible` widened to include `gerente_loja`.
- `src/app/documentos/conservacao/page.tsx` — `canAccess` widened to include `gerente_loja`; `canManageDocuments` left `isAdmin`-only by design.

### Concerns

None identified. Change is scoped exactly to the two `isVisible`/`canAccess` expressions named in the task; `canManageDocuments`, the backend route, and all other logic in both files were left untouched.

### Commit

See below.

## Fix: clean up orphaned storage file on POST failure

### Background

Final whole-branch review finding: `src/app/formulario/notas-fiscais-conservacao/page.tsx` uploads the PDF to the `formularios` Supabase Storage bucket before calling `POST /api/notas-fiscais-conservacao`. If that request is rejected for any reason (409 duplicate `(prestador_id, numero_nf)`, 400 wrong prestador categoria, 404 loja not found, 400 invalid competência, or any other server-side rejection), nothing ever deletes the just-uploaded file, leaving it orphaned in storage. The server-side ordering was already correct (duplicate check happens before any DB write), but the client-side upload happens unconditionally before the API call.

Scope: only the client-side storage-orphan cleanup on a non-OK POST response. The separate, rarer race-condition case (the `formularios` row already created server-side before a 23505 duplicate hits on the `notas_fiscais_conservacao` insert) was already reviewed and accepted as an acceptable tradeoff in an earlier round and is out of scope here.

### What was implemented

File: `src/app/formulario/notas-fiscais-conservacao/page.tsx`, in `handleSubmit`, right after the `fetch("/api/notas-fiscais-conservacao", ...)` call.

Before:
```ts
const payload = (await response.json()) as { error?: string };
if (!response.ok) {
  throw new Error(payload.error ?? "Não foi possível cadastrar a nota fiscal.");
}
```

After:
```ts
const payload = (await response.json()) as { error?: string };
if (!response.ok) {
  const cleanupPath = uploadData.path ?? path;
  const { error: removeError } = await supabase.storage
    .from("formularios")
    .remove([cleanupPath]);
  if (removeError) {
    console.error("Erro ao limpar arquivo apos falha no cadastro:", removeError);
  }
  throw new Error(payload.error ?? "Não foi possível cadastrar a nota fiscal.");
}
```

`uploadData` and `path` were already in scope from the earlier `supabase.storage.from("formularios").upload(path, file)` call a few lines above (lines ~75-82). The cleanup uses the same `uploadData.path ?? path` fallback expression already used when building the `arquivo.path` field sent to the API, for consistency. A failure to remove the file only logs to `console.error` — it never replaces or masks the original `Error` thrown with `payload.error`, so the user always sees the real rejection reason (duplicate NF, wrong categoria, etc.) rather than a storage-cleanup error.

### Hand-traced scenarios

- **POST succeeds (`response.ok === true`)**: cleanup branch never runs; behavior unchanged from before the fix.
- **POST rejected (409/400/404/etc.)**: `remove([cleanupPath])` is awaited first. If it succeeds, the orphaned object is deleted from the `formularios` bucket before the `Error` is thrown and caught in the outer `catch`, which sets `error` state to `payload.error`. If `remove` itself fails (e.g. transient network issue), `removeError` is logged via `console.error` but the original `throw new Error(payload.error ?? ...)` still executes unconditionally afterward — the user-facing error message is unaffected either way.

### Build result

`npm run build` completed successfully — TypeScript compiled with no errors, all 46 static/dynamic routes generated (including `/formulario/notas-fiscais-conservacao` and `/api/notas-fiscais-conservacao`). Only unrelated `[baseline-browser-mapping]` staleness warnings appeared (pre-existing, unrelated to this change).

### Files changed

- `src/app/formulario/notas-fiscais-conservacao/page.tsx` — added storage cleanup in the non-OK POST branch of `handleSubmit`.

### Concerns

None identified. Change is scoped exactly to the `if (!response.ok)` branch described in the finding; the success path, the earlier upload call, and the rare server-side race-condition case (explicitly out of scope) were left untouched.

### Commit

See below.
