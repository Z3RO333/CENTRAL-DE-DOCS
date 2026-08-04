# Cadastro de Equipamentos por Loja — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o cadastro de equipamentos por loja (tabela, API, tela admin) e importar os equipamentos reais da planilha `VALORES CONTRATOS.xlsx` para popular o cadastro inicial.

**Architecture:** Uma tabela nova `equipamentos` (RLS habilitado sem policies — acesso só via service role pela API, igual `prestadores`/`lojas`), uma rota de API REST (`/api/equipamentos`) com auth via `hasDocumentosAccess` (mesmo padrão de `/api/prestadores`), um hook client-side (`useEquipamentos`) e uma tela admin nova em `/equipamentos`, seguindo exatamente a estrutura já usada em `/lojas` e `/prestadores`. A importação da planilha é uma operação pontual (script Python, executado uma vez pelo controlador da implementação com checkpoint de revisão humana antes de gravar no banco) — não é uma feature reutilizável do produto.

**Tech Stack:** Next.js App Router, Supabase (Postgres + service-role client), TypeScript, Vitest para testes de lib, Python/openpyxl para a extração pontual da planilha (ferramenta já validada disponível no ambiente).

## Global Constraints

- Projeto Supabase: `tqzvgqauvbknwdvbtvfr` ("formulario central").
- Sem dado financeiro/contratual (valor, reajuste, frequência de pagamento) — só o cadastro técnico do equipamento. Decisão explícita do usuário, ver `docs/superpowers/specs/2026-07-31-cadastro-equipamentos-design.md`.
- `tipo_equipamento` é texto livre (não FK para tabela de referência) — decisão de arquitetura do spec, evita tela de CRUD de tipos que não foi pedida.
- Sem operação de delete físico — só `status = 'inativo'` + `data_desativacao` (mesma filosofia de "desativar" já usada em outras entidades do sistema, ex. `formularios.status`).
- RLS habilitado na tabela nova, sem policies adicionais — mesmo padrão de `public.prestadores` (`supabase/migrations/202501061200_create_prestadores.sql`): acesso controlado inteiramente pela API Next.js via `hasDocumentosAccess`, nunca direto do client anônimo/autenticado.
- Escrita (criar/editar) restrita a admin (`hasDocumentosAccess`), mesmo padrão de `/api/prestadores` e `/api/lojas`.
- Nomes e mensagens em português, seguindo o padrão do restante do código.
- A importação da planilha (`VALORES CONTRATOS.xlsx`, em `C:\Users\21664\Downloads\`) ignora todas as colunas financeiras e não cria prestador novo quando não achar match — equipamento fica sem `prestador_id` nesse caso.

---

### Task 1: Migration — tabela `equipamentos`

**Files:**
- Create: `supabase/migrations/202607311300_create_equipamentos.sql`

**Interfaces:**
- Produces: tabela `public.equipamentos` com as colunas listadas no spec (seção "Modelo de dados"). Todas as tasks seguintes (API, hook, import) leem/escrevem essa tabela pelas colunas: `id, loja_id, tipo_equipamento, identificacao, marca, modelo, numero_serie, potencia, localizacao, prestador_id, documento_tipo_obrigatorio, data_instalacao, data_ativacao, data_desativacao, status, atributos, origem_importacao, created_by, created_at, updated_at`.

- [ ] **Step 1: Escrever a migration**

```sql
create table if not exists public.equipamentos (
  id uuid primary key default gen_random_uuid(),
  loja_id uuid not null references public.lojas (id) on delete cascade,
  tipo_equipamento text not null,
  identificacao text,
  marca text,
  modelo text,
  numero_serie text,
  potencia text,
  localizacao text,
  prestador_id uuid references public.prestadores (id) on delete set null,
  documento_tipo_obrigatorio text,
  data_instalacao date,
  data_ativacao date,
  data_desativacao date,
  status text not null default 'ativo' check (status in ('ativo', 'inativo')),
  atributos jsonb not null default '{}'::jsonb,
  origem_importacao text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists equipamentos_loja_id_idx on public.equipamentos (loja_id);
create index if not exists equipamentos_status_idx on public.equipamentos (status);
create index if not exists equipamentos_tipo_equipamento_idx on public.equipamentos (tipo_equipamento);

alter table public.equipamentos enable row level security;
-- Mesmo padrão de public.prestadores: acesso só via service role pela API,
-- nenhuma policy adicional é necessária para o funcionamento padrão.

create or replace function public.touch_equipamentos_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists equipamentos_touch_updated_at on public.equipamentos;
create trigger equipamentos_touch_updated_at
  before update on public.equipamentos
  for each row
  execute function public.touch_equipamentos_updated_at();
```

- [ ] **Step 2: Aplicar no Supabase**

Use a ferramenta MCP `apply_migration` (projeto `tqzvgqauvbknwdvbtvfr`, nome `create_equipamentos`) com o SQL acima.

- [ ] **Step 3: Verificar**

Via MCP `execute_sql`:
```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'equipamentos'
order by ordinal_position;
```
Esperado: 20 colunas, batendo com a lista acima. Confirme também que `status` tem CHECK e que os 3 índices existem:
```sql
select indexname from pg_indexes where tablename = 'equipamentos';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202607311300_create_equipamentos.sql
git commit -m "feat(db): cria tabela equipamentos"
```

---

### Task 2: `src/lib/equipamentosImport.ts` — normalização e matching de nome de unidade

**Files:**
- Create: `src/lib/equipamentosImport.ts`
- Test: `src/lib/equipamentosImport.test.ts`

**Interfaces:**
- Produces:
  - `normalizarNomeUnidade(nome: string): string` — maiúsculas, sem acento, sem prefixo "FARMA"/"BEMOL FARMA", espaços colapsados, trim.
  - `encontrarLojaCorrespondente(nomeUnidade: string, lojas: Array<{ id: string; nome: string; codigo: string | null }>): { id: string; nome: string } | null` — casa por nome normalizado exato; se não achar, tenta por `codigo` quando `nomeUnidade` for puramente numérico.

  Essas funções documentam o comportamento esperado de matching que a Task 6 (script de importação, em Python) precisa replicar manualmente — a Task 6 não importa este módulo (é um script `.mjs`/Python fora do bundler), mas deve produzir o mesmo resultado para os casos de teste abaixo. Verificar isso é responsabilidade de quem executa a Task 6.

- [ ] **Step 1: Escrever os testes que falham**

```typescript
import { describe, expect, it } from "vitest";
import {
  encontrarLojaCorrespondente,
  normalizarNomeUnidade,
} from "@/lib/equipamentosImport";

describe("normalizarNomeUnidade", () => {
  it("converte para maiusculas e remove acentos", () => {
    expect(normalizarNomeUnidade("Camapuã")).toBe("CAMAPUA");
    expect(normalizarNomeUnidade("Codajás")).toBe("CODAJAS");
  });

  it("remove o prefixo Farma / Bemol Farma", () => {
    expect(normalizarNomeUnidade("Farma Torquato")).toBe("TORQUATO");
    expect(normalizarNomeUnidade("Bemol Farma Nova Cidade")).toBe("NOVA CIDADE");
  });

  it("colapsa espacos e remove abreviacoes com ponto", () => {
    expect(normalizarNomeUnidade("P. Negra")).toBe("P NEGRA");
    expect(normalizarNomeUnidade("G.  Circular")).toBe("G CIRCULAR");
  });

  it("mantem o nome ja normalizado sem alteracao", () => {
    expect(normalizarNomeUnidade("MATRIZ")).toBe("MATRIZ");
  });
});

describe("encontrarLojaCorrespondente", () => {
  const lojas = [
    { id: "1", nome: "PONTA NEGRA", codigo: "114" },
    { id: "2", nome: "GRANDE CIRCULAR", codigo: "109" },
    { id: "3", nome: "BEMOL FARMA TORQUATO", codigo: "601" },
    { id: "4", nome: "NOVA CIDADE", codigo: "121" },
    { id: "5", nome: "CIDADE NOVA", codigo: "115" },
  ];

  it("acha match exato por nome normalizado", () => {
    expect(encontrarLojaCorrespondente("Nova Cidade", lojas)?.id).toBe("4");
    expect(encontrarLojaCorrespondente("Farma Torquato", lojas)?.id).toBe("3");
  });

  it("nao confunde Nova Cidade com Cidade Nova", () => {
    expect(encontrarLojaCorrespondente("Cidade Nova", lojas)?.id).toBe("5");
    expect(encontrarLojaCorrespondente("Nova Cidade", lojas)?.id).not.toBe("5");
  });

  it("retorna null quando nao ha match", () => {
    expect(encontrarLojaCorrespondente("Loja Inexistente", lojas)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm run test -- equipamentosImport`
Expected: FAIL — `Cannot find module '@/lib/equipamentosImport'`.

- [ ] **Step 3: Implementar**

```typescript
export function normalizarNomeUnidade(nome: string): string {
  const semAcento = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  const semPrefixo = semAcento
    .replace(/^BEMOL\s+FARMA\s+/, "")
    .replace(/^FARMA\s+/, "");

  return semPrefixo
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function encontrarLojaCorrespondente(
  nomeUnidade: string,
  lojas: Array<{ id: string; nome: string; codigo: string | null }>,
): { id: string; nome: string } | null {
  const alvo = normalizarNomeUnidade(nomeUnidade);

  const porNome = lojas.find((loja) => normalizarNomeUnidade(loja.nome) === alvo);
  if (porNome) {
    return { id: porNome.id, nome: porNome.nome };
  }

  if (/^\d+$/.test(nomeUnidade.trim())) {
    const porCodigo = lojas.find((loja) => loja.codigo === nomeUnidade.trim());
    if (porCodigo) {
      return { id: porCodigo.id, nome: porCodigo.nome };
    }
  }

  return null;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm run test -- equipamentosImport`
Expected: PASS — todos os 7 testes (4 de `normalizarNomeUnidade` + 3 de `encontrarLojaCorrespondente`) passam.

- [ ] **Step 5: Commit**

```bash
git add src/lib/equipamentosImport.ts src/lib/equipamentosImport.test.ts
git commit -m "feat: adiciona normalizacao e matching de nome de unidade para import de equipamentos"
```

---

### Task 3: API — `src/app/api/equipamentos/route.ts`

**Files:**
- Create: `src/app/api/equipamentos/route.ts`

**Interfaces:**
- Consumes: `getSessionUserFromRequest`, `hasDocumentosAccess`, `ApiHttpError` (de `@/lib/apiAuth`, já existem); `createSupabaseAdminClient` (já existe).
- Produces: `GET /api/equipamentos?lojaId=<uuid>` (lojaId opcional — sem ele, lista todos), `POST /api/equipamentos`, `PATCH /api/equipamentos`. Resposta em todos os casos: `{ equipamento }` (singular, no POST/PATCH) ou `{ equipamentos }` (array, no GET). Consumida pela Task 4 (`useEquipamentos`).

- [ ] **Step 1: Implementar a rota**

```typescript
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  ApiHttpError as HttpError,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";

const SELECT_COLUMNS =
  "id,loja_id,tipo_equipamento,identificacao,marca,modelo,numero_serie,potencia,localizacao,prestador_id,documento_tipo_obrigatorio,data_instalacao,data_ativacao,data_desativacao,status,atributos,origem_importacao,created_at,updated_at";

const STATUS_VALIDOS = ["ativo", "inativo"] as const;

type EquipamentoInput = {
  loja_id?: string;
  tipo_equipamento?: string;
  identificacao?: string | null;
  marca?: string | null;
  modelo?: string | null;
  numero_serie?: string | null;
  potencia?: string | null;
  localizacao?: string | null;
  prestador_id?: string | null;
  documento_tipo_obrigatorio?: string | null;
  data_instalacao?: string | null;
  data_ativacao?: string | null;
  data_desativacao?: string | null;
  status?: string;
  atributos?: Record<string, unknown>;
};

function sanitizeText(value: string | null | undefined): string | null {
  if (value === undefined) return null;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(403, "Voce nao possui permissao para consultar equipamentos.");
    }

    const { searchParams } = new URL(request.url);
    const lojaId = searchParams.get("lojaId")?.trim();

    let query = supabaseAdmin
      .from("equipamentos")
      .select(SELECT_COLUMNS)
      .order("tipo_equipamento", { ascending: true });

    if (lojaId) {
      query = query.eq("loja_id", lojaId);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    return NextResponse.json({ equipamentos: data ?? [] });
  } catch (err) {
    console.error("Erro ao buscar equipamentos:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel carregar os equipamentos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(403, "Voce nao possui permissao para cadastrar equipamentos.");
    }

    const body = (await request.json()) as EquipamentoInput;

    const lojaId = body.loja_id?.trim();
    const tipoEquipamento = sanitizeText(body.tipo_equipamento);

    if (!lojaId) {
      throw new HttpError(400, "Informe a loja do equipamento.");
    }
    if (!tipoEquipamento) {
      throw new HttpError(400, "Informe o tipo do equipamento.");
    }
    if (body.status !== undefined && !STATUS_VALIDOS.includes(body.status as never)) {
      throw new HttpError(400, "Status invalido.");
    }

    const { data, error } = await supabaseAdmin
      .from("equipamentos")
      .insert({
        loja_id: lojaId,
        tipo_equipamento: tipoEquipamento,
        identificacao: sanitizeText(body.identificacao),
        marca: sanitizeText(body.marca),
        modelo: sanitizeText(body.modelo),
        numero_serie: sanitizeText(body.numero_serie),
        potencia: sanitizeText(body.potencia),
        localizacao: sanitizeText(body.localizacao),
        prestador_id: body.prestador_id?.trim() || null,
        documento_tipo_obrigatorio: sanitizeText(body.documento_tipo_obrigatorio),
        data_instalacao: body.data_instalacao || null,
        data_ativacao: body.data_ativacao || null,
        data_desativacao: body.data_desativacao || null,
        status: body.status ?? "ativo",
        atributos: body.atributos ?? {},
        created_by: user.id,
      })
      .select(SELECT_COLUMNS)
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ equipamento: data });
  } catch (err) {
    console.error("Erro ao criar equipamento:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel cadastrar o equipamento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(403, "Voce nao possui permissao para atualizar equipamentos.");
    }

    const body = (await request.json()) as EquipamentoInput & { id?: string };
    const equipamentoId = body.id?.trim();
    if (!equipamentoId) {
      throw new HttpError(400, "Informe o equipamento.");
    }
    if (body.status !== undefined && !STATUS_VALIDOS.includes(body.status as never)) {
      throw new HttpError(400, "Status invalido.");
    }

    const updatePayload: Record<string, unknown> = {};
    const camposTexto: Array<keyof EquipamentoInput> = [
      "tipo_equipamento",
      "identificacao",
      "marca",
      "modelo",
      "numero_serie",
      "potencia",
      "localizacao",
      "documento_tipo_obrigatorio",
    ];
    for (const campo of camposTexto) {
      if (Object.prototype.hasOwnProperty.call(body, campo)) {
        updatePayload[campo] = sanitizeText(body[campo] as string | null | undefined);
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "loja_id") && body.loja_id) {
      updatePayload.loja_id = body.loja_id.trim();
    }
    if (Object.prototype.hasOwnProperty.call(body, "prestador_id")) {
      updatePayload.prestador_id = body.prestador_id?.trim() || null;
    }
    for (const campo of ["data_instalacao", "data_ativacao", "data_desativacao"] as const) {
      if (Object.prototype.hasOwnProperty.call(body, campo)) {
        updatePayload[campo] = body[campo] || null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      updatePayload.status = body.status;
    }
    if (Object.prototype.hasOwnProperty.call(body, "atributos")) {
      updatePayload.atributos = body.atributos ?? {};
    }

    if (Object.keys(updatePayload).length === 0) {
      throw new HttpError(400, "Informe ao menos um campo para atualizar.");
    }

    const { data, error } = await supabaseAdmin
      .from("equipamentos")
      .update(updatePayload)
      .eq("id", equipamentoId)
      .select(SELECT_COLUMNS)
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ equipamento: data });
  } catch (err) {
    console.error("Erro ao atualizar equipamento:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel atualizar o equipamento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Rodar a suite completa de testes**

Run: `npm run test`
Expected: PASS — nenhum teste existente quebrou (rota nova, sem teste próprio, seguindo o padrão de `/api/prestadores`, que também não tem).

- [ ] **Step 3: Rodar o typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/equipamentos/route.ts
git commit -m "feat: adiciona rota de API para cadastro de equipamentos"
```

---

### Task 4: Hook `src/hooks/useEquipamentos.ts`

**Files:**
- Create: `src/hooks/useEquipamentos.ts`

**Interfaces:**
- Consumes: `POST/GET/PATCH /api/equipamentos` (Task 3).
- Produces: `useEquipamentos(options?: { lojaId?: string; enabled?: boolean })` retornando `{ equipamentos, loading, error, refresh, createEquipamento, updateEquipamento }`, tipo `Equipamento` exportado. Consumido pela Task 5 (tela admin).

- [ ] **Step 1: Implementar o hook**

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type Equipamento = {
  id: string;
  loja_id: string;
  tipo_equipamento: string;
  identificacao: string | null;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  potencia: string | null;
  localizacao: string | null;
  prestador_id: string | null;
  documento_tipo_obrigatorio: string | null;
  data_instalacao: string | null;
  data_ativacao: string | null;
  data_desativacao: string | null;
  status: "ativo" | "inativo";
  atributos: Record<string, unknown>;
  origem_importacao: string | null;
  created_at: string;
  updated_at: string;
};

type UseEquipamentosOptions = {
  lojaId?: string;
  enabled?: boolean;
};

type EquipamentoInput = Partial<
  Omit<Equipamento, "id" | "created_at" | "updated_at" | "origem_importacao">
> & { loja_id: string; tipo_equipamento: string };

type EquipamentoUpdateInput = Partial<
  Omit<Equipamento, "id" | "created_at" | "updated_at" | "origem_importacao">
> & { id: string };

type UseEquipamentosResult = {
  equipamentos: Equipamento[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createEquipamento: (input: EquipamentoInput) => Promise<Equipamento | null>;
  updateEquipamento: (input: EquipamentoUpdateInput) => Promise<Equipamento | null>;
};

export function useEquipamentos(
  options: UseEquipamentosOptions = {},
): UseEquipamentosResult {
  const { lojaId, enabled = true } = options;
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getAccessToken = useCallback(async () => {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }
    const token = sessionData.session?.access_token;
    if (!token) {
      throw new Error("Sessao expirada. Faca login novamente.");
    }
    return token;
  }, []);

  const fetchEquipamentos = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) {
        setEquipamentos([]);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const url = lojaId
          ? `/api/equipamentos?lojaId=${encodeURIComponent(lojaId)}`
          : "/api/equipamentos";
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        });
        const payload = (await response.json()) as {
          equipamentos?: Equipamento[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Falha ao carregar equipamentos.");
        }
        if (signal?.aborted) {
          return;
        }
        setEquipamentos(payload.equipamentos ?? []);
      } catch (err) {
        if (signal?.aborted) {
          return;
        }
        setEquipamentos([]);
        setError(
          err instanceof Error ? err.message : "Falha ao carregar equipamentos.",
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [enabled, lojaId, getAccessToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchEquipamentos(controller.signal);
    return () => controller.abort();
  }, [fetchEquipamentos]);

  const createEquipamento = useCallback(
    async (input: EquipamentoInput) => {
      const token = await getAccessToken();
      const response = await fetch("/api/equipamentos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as {
        equipamento?: Equipamento;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao criar equipamento.");
      }
      if (payload.equipamento) {
        setEquipamentos((prev) => [payload.equipamento!, ...prev]);
      }
      return payload.equipamento ?? null;
    },
    [getAccessToken],
  );

  const updateEquipamento = useCallback(
    async (input: EquipamentoUpdateInput) => {
      const token = await getAccessToken();
      const response = await fetch("/api/equipamentos", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as {
        equipamento?: Equipamento;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao atualizar equipamento.");
      }
      if (payload.equipamento) {
        setEquipamentos((prev) =>
          prev.map((item) =>
            item.id === payload.equipamento!.id ? payload.equipamento! : item,
          ),
        );
      }
      return payload.equipamento ?? null;
    },
    [getAccessToken],
  );

  return {
    equipamentos,
    loading,
    error,
    refresh: fetchEquipamentos,
    createEquipamento,
    updateEquipamento,
  };
}
```

- [ ] **Step 2: Rodar o typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useEquipamentos.ts
git commit -m "feat: adiciona hook useEquipamentos"
```

---

### Task 5: Tela admin `/equipamentos` + entrada no menu

**Files:**
- Create: `src/app/equipamentos/page.tsx`
- Modify: `src/components/AppShell.tsx`

**Interfaces:**
- Consumes: `useEquipamentos` (Task 4), `useLojas` (já existe, `src/hooks/useLojas.ts`), `useDocumentsAccess` (já existe).
- Produces: rota `/equipamentos`, visível só para admin, listada no menu "Administração".

- [ ] **Step 1: Ler a tela de referência**

Leia `src/app/lojas/page.tsx` por completo antes de implementar — a tela nova segue a mesma estrutura (guard de auth/admin no topo, busca+filtro, tabela paginada, modal de criar/editar controlado por estado local, `useConfirmDialog` se precisar de confirmação). Não é para copiar campo por campo (os campos são diferentes), é para seguir o mesmo esqueleto de componente, os mesmos hooks de auth (`useAuth`, `useDocumentsAccess`) e o mesmo padrão de redirect (`!isAdmin` → `router.replace("/documentos")`).

- [ ] **Step 2: Implementar a tela**

Estrutura mínima obrigatória (adapte o styling ao padrão visual de `lojas/page.tsx`, mas a lógica abaixo é o requisito):

```typescript
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { useLojas } from "@/hooks/useLojas";
import { useEquipamentos, type Equipamento } from "@/hooks/useEquipamentos";

type FeedbackState = { kind: "success" | "error"; message: string } | null;

export default function EquipamentosPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();
  const { lojas } = useLojas({ enabled: isAdmin });
  const {
    equipamentos,
    loading: equipamentosLoading,
    createEquipamento,
    updateEquipamento,
  } = useEquipamentos({ enabled: isAdmin });

  const [lojaFilter, setLojaFilter] = useState<string>("todas");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [editing, setEditing] = useState<Equipamento | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [formLojaId, setFormLojaId] = useState("");
  const [formTipo, setFormTipo] = useState("");
  const [formIdentificacao, setFormIdentificacao] = useState("");
  const [formMarca, setFormMarca] = useState("");
  const [formModelo, setFormModelo] = useState("");
  const [formPotencia, setFormPotencia] = useState("");

  useEffect(() => {
    if (authLoading || accessLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isAdmin) {
      router.replace("/documentos");
    }
  }, [authLoading, accessLoading, user, isAdmin, router]);

  const tiposSugeridos = useMemo(
    () => Array.from(new Set(equipamentos.map((eq) => eq.tipo_equipamento))).sort(),
    [equipamentos],
  );

  const visibleEquipamentos = useMemo(
    () =>
      lojaFilter === "todas"
        ? equipamentos
        : equipamentos.filter((eq) => eq.loja_id === lojaFilter),
    [equipamentos, lojaFilter],
  );

  const resetForm = () => {
    setFormLojaId("");
    setFormTipo("");
    setFormIdentificacao("");
    setFormMarca("");
    setFormModelo("");
    setFormPotencia("");
  };

  const openCreate = () => {
    resetForm();
    setEditing(null);
    setIsCreateOpen(true);
  };

  const openEdit = (equipamento: Equipamento) => {
    setFormLojaId(equipamento.loja_id);
    setFormTipo(equipamento.tipo_equipamento);
    setFormIdentificacao(equipamento.identificacao ?? "");
    setFormMarca(equipamento.marca ?? "");
    setFormModelo(equipamento.modelo ?? "");
    setFormPotencia(equipamento.potencia ?? "");
    setEditing(equipamento);
    setIsCreateOpen(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      if (editing) {
        await updateEquipamento({
          id: editing.id,
          loja_id: formLojaId,
          tipo_equipamento: formTipo,
          identificacao: formIdentificacao || null,
          marca: formMarca || null,
          modelo: formModelo || null,
          potencia: formPotencia || null,
        });
        setFeedback({ kind: "success", message: "Equipamento atualizado." });
      } else {
        await createEquipamento({
          loja_id: formLojaId,
          tipo_equipamento: formTipo,
          identificacao: formIdentificacao || null,
          marca: formMarca || null,
          modelo: formModelo || null,
          potencia: formPotencia || null,
        });
        setFeedback({ kind: "success", message: "Equipamento cadastrado." });
      }
      setIsCreateOpen(false);
      resetForm();
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Falha ao salvar equipamento.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDesativar = async (equipamento: Equipamento) => {
    setFeedback(null);
    try {
      await updateEquipamento({
        id: equipamento.id,
        status: "inativo",
        data_desativacao: new Date().toISOString().slice(0, 10),
      });
      setFeedback({ kind: "success", message: "Equipamento desativado." });
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Falha ao desativar.",
      });
    }
  };

  if (authLoading || accessLoading || !isAdmin) {
    return null;
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Equipamentos</h1>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Novo equipamento
        </button>
      </div>

      {feedback && (
        <div
          className={`mb-4 rounded-lg px-4 py-2 text-sm ${
            feedback.kind === "success"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {feedback.message}
        </div>
      )}

      <select
        value={lojaFilter}
        onChange={(event) => setLojaFilter(event.target.value)}
        className="mb-4 rounded-lg border border-slate-300 px-3 py-2 text-sm"
      >
        <option value="todas">Todas as lojas</option>
        {lojas.map((loja) => (
          <option key={loja.id} value={loja.id}>
            {loja.nome}
          </option>
        ))}
      </select>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="py-2">Loja</th>
            <th className="py-2">Tipo</th>
            <th className="py-2">Identificação</th>
            <th className="py-2">Marca/Modelo</th>
            <th className="py-2">Status</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {equipamentosLoading ? (
            <tr>
              <td colSpan={6} className="py-4 text-center text-slate-500">
                Carregando...
              </td>
            </tr>
          ) : (
            visibleEquipamentos.map((equipamento) => {
              const loja = lojas.find((item) => item.id === equipamento.loja_id);
              return (
                <tr key={equipamento.id} className="border-b border-slate-100">
                  <td className="py-2">{loja?.nome ?? "—"}</td>
                  <td className="py-2">{equipamento.tipo_equipamento}</td>
                  <td className="py-2">{equipamento.identificacao ?? "—"}</td>
                  <td className="py-2">
                    {[equipamento.marca, equipamento.modelo].filter(Boolean).join(" / ") || "—"}
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        equipamento.status === "ativo"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {equipamento.status === "ativo" ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(equipamento)}
                      className="mr-2 text-blue-600 hover:underline"
                    >
                      Editar
                    </button>
                    {equipamento.status === "ativo" && (
                      <button
                        type="button"
                        onClick={() => void handleDesativar(equipamento)}
                        className="text-red-600 hover:underline"
                      >
                        Desativar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold">
              {editing ? "Editar equipamento" : "Novo equipamento"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-slate-600">Loja</label>
                <select
                  required
                  value={formLojaId}
                  onChange={(event) => setFormLojaId(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Selecione</option>
                  {lojas.map((loja) => (
                    <option key={loja.id} value={loja.id}>
                      {loja.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">Tipo de equipamento</label>
                <input
                  required
                  list="tipos-equipamento-sugeridos"
                  value={formTipo}
                  onChange={(event) => setFormTipo(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <datalist id="tipos-equipamento-sugeridos">
                  {tiposSugeridos.map((tipo) => (
                    <option key={tipo} value={tipo} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">Identificação</label>
                <input
                  value={formIdentificacao}
                  onChange={(event) => setFormIdentificacao(event.target.value)}
                  placeholder='Ex.: "Gerador 01"'
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-slate-600">Marca</label>
                  <input
                    value={formMarca}
                    onChange={(event) => setFormMarca(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-600">Modelo</label>
                  <input
                    value={formModelo}
                    onChange={(event) => setFormModelo(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">Potência</label>
                <input
                  value={formPotencia}
                  onChange={(event) => setFormPotencia(event.target.value)}
                  placeholder='Ex.: "150KVA"'
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Adicionar a entrada no menu**

Em `src/components/AppShell.tsx`, dentro do grupo `"Administração"` (mesmo array que já tem `/usuarios`, `/lojas`, `/prestadores` — ver linhas ~188-208 do arquivo atual), adicionar um item novo, importando o ícone `Wrench` de `lucide-react` junto com os outros ícones já importados no topo do arquivo:

```typescript
        {
          href: "/equipamentos",
          label: "Equipamentos",
          icon: Wrench,
          isActive: pathname?.startsWith("/equipamentos"),
          isVisible: isAdmin,
        },
```

- [ ] **Step 4: Rodar o typecheck e o lint**

Run: `npx tsc --noEmit -p .`
Expected: sem erros.

Run: `npx eslint src/app/equipamentos/page.tsx src/components/AppShell.tsx`
Expected: sem erros.

- [ ] **Step 5: Verificar manualmente**

Suba o dev server (`npm run dev`), logado como admin: acesse `/equipamentos` pelo menu, confirme que a tela carrega vazia (banco ainda sem dados até a Task 6 rodar), cadastre um equipamento de teste, edite, desative, confirme que o filtro por loja funciona.

- [ ] **Step 6: Commit**

```bash
git add src/app/equipamentos/page.tsx src/components/AppShell.tsx
git commit -m "feat: adiciona tela de administracao de equipamentos"
```

---

### Task 6: Importação da planilha `VALORES CONTRATOS.xlsx`

**Esta task é executada diretamente pelo controlador da implementação (não por um subagente dispatchado)** — envolve ler um arquivo fora do repositório, revisar uma lista de conferência com o usuário antes de gravar no banco, e aplicar SQL via ferramenta MCP do Supabase. Não é uma feature de código do produto (o spec já deixa isso explícito: "não vira uma tela... nem um importador genérico").

**Files:**
- Create (fora do repositório, arquivo de trabalho temporário): script Python de extração.

**Interfaces:**
- Consumes: `VALORES CONTRATOS.xlsx` (`C:\Users\21664\Downloads\VALORES CONTRATOS.xlsx`), a tabela `equipamentos` (Task 1), a tabela `lojas` e `prestadores` já existentes.
- Produces: linhas em `public.equipamentos` com `origem_importacao = 'planilha_valores_contratos'`.

- [ ] **Step 1: Escrever e rodar o script de extração**

O script replica manualmente a MESMA lógica de normalização validada pelos testes da Task 2 (maiúsculas, sem acento, remove prefixo "Farma"/"Bemol Farma", colapsa espaços, remove pontos de abreviação) — worth conferir contra os mesmos casos de teste antes de aplicar qualquer coisa no banco.

```python
import unicodedata
import re
import json
import openpyxl

def normalizar(nome):
    sem_acento = unicodedata.normalize("NFD", nome)
    sem_acento = "".join(c for c in sem_acento if unicodedata.category(c) != "Mn").upper()
    sem_prefixo = re.sub(r"^BEMOL\s+FARMA\s+", "", sem_acento)
    sem_prefixo = re.sub(r"^FARMA\s+", "", sem_prefixo)
    sem_prefixo = sem_prefixo.replace(".", "")
    return re.sub(r"\s+", " ", sem_prefixo).strip()

# Confere contra os mesmos casos de teste da Task 2 antes de seguir
casos_teste = [
    ("Camapuã", "CAMAPUA"),
    ("Farma Torquato", "TORQUATO"),
    ("Bemol Farma Nova Cidade", "NOVA CIDADE"),
    ("P. Negra", "P NEGRA"),
]
for entrada, esperado in casos_teste:
    resultado = normalizar(entrada)
    assert resultado == esperado, f"{entrada} -> {resultado}, esperado {esperado}"
print("Normalizacao OK, bate com os testes da Task 2.")

wb = openpyxl.load_workbook(r"C:\Users\21664\Downloads\VALORES CONTRATOS.xlsx", data_only=True)
abas = [n for n in wb.sheetnames if n not in ("DADOS GERAIS", "UNIDADES", "PAGAMENTOS", "Planilha3")]

matched = []
unmatched = []
for aba in abas:
    ws = wb[aba]
    header = [ws.cell(row=1, column=c).value for c in range(1, ws.max_column + 1)]
    def col(keys):
        for i, h in enumerate(header, start=1):
            if h and any(k in str(h) for k in keys):
                return i
        return None
    c_empresa = col(["Empresa", "EMPRESA"])
    c_unidade = col(["Unidade"])
    c_equip = col(["Equipamento", "EQUIPAMENTO"])
    c_marca = col(["Marca"])
    c_potencia = col(["Potência", "Pot\ufffdncia"])
    for r in range(2, ws.max_row + 1):
        unidade = ws.cell(row=r, column=c_unidade).value if c_unidade else None
        equip = ws.cell(row=r, column=c_equip).value if c_equip else None
        if not unidade or not equip:
            continue
        equip_str = str(equip).strip()
        if equip_str.upper() in ("N/C", "") or "DESATIVA" in str(ws.cell(row=r, column=c_marca).value or "").upper():
            continue
        row_data = {
            "aba": aba,
            "unidade_planilha": str(unidade).strip(),
            "unidade_normalizada": normalizar(str(unidade)),
            "empresa": (str(ws.cell(row=r, column=c_empresa).value).strip() if c_empresa and ws.cell(row=r, column=c_empresa).value else None),
            "tipo_equipamento": equip_str,
            "marca": (str(ws.cell(row=r, column=c_marca).value).strip() if c_marca and ws.cell(row=r, column=c_marca).value else None),
            "potencia": (str(ws.cell(row=r, column=c_potencia).value).strip() if c_potencia and ws.cell(row=r, column=c_potencia).value else None),
        }
        matched.append(row_data)

with open("equipamentos_extraidos.json", "w", encoding="utf-8") as f:
    json.dump(matched, f, ensure_ascii=False, indent=2)

print(f"Extraidas {len(matched)} linhas de equipamento em equipamentos_extraidos.json")
```

Rode com `python3 <script>.py` a partir de um diretório de trabalho (ex.: o scratchpad da sessão, não dentro do repositório do app).

- [ ] **Step 2: Casar `unidade_normalizada` com as lojas reais e separar conferência**

Usando a ferramenta MCP `execute_sql` (projeto `tqzvgqauvbknwdvbtvfr`), busque `select id, upper(unaccent(nome)) as nome_norm, nome, codigo from public.lojas` (ou, se a extensão `unaccent` não estiver disponível, traga `id, nome, codigo` puro e normalize no Python com a mesma função `normalizar`). Casa cada `unidade_normalizada` contra esse conjunto. Linhas sem match exato vão para uma lista separada — **não adivinhe o vínculo**.

- [ ] **Step 3: Apresentar a lista de conferência ao usuário**

Antes de gravar qualquer coisa no banco, mostre ao usuário: quantas linhas deram match automático, e a lista completa das que não deram (nome da unidade na planilha + aba de origem), para ele confirmar manualmente o vínculo ou decidir ignorar. Não prossiga para o Step 4 sem essa confirmação.

- [ ] **Step 4: Casar empresa com `prestadores` e aplicar os inserts**

Para cada linha com loja confirmada, tente casar `empresa` (normalizada: maiúsculas, sem acento, trim) contra `prestadores.nome` (mesma normalização). Sem match, grave sem `prestador_id`. Gere os `INSERT INTO public.equipamentos (...)` (ou monte o array e insira em lotes via `execute_sql`) com `origem_importacao = 'planilha_valores_contratos'`, `status = 'ativo'`. Aplique via MCP `execute_sql` ou `apply_migration` — dado que isso é população de dados, não schema, `execute_sql` é mais apropriado que uma migration versionada.

- [ ] **Step 5: Verificar o resultado**

```sql
select tipo_equipamento, count(*) from public.equipamentos group by 1 order by 2 desc;
select count(*) from public.equipamentos where prestador_id is null;
select count(*) from public.equipamentos where origem_importacao = 'planilha_valores_contratos';
```

Confirme que a contagem por tipo bate razoavelmente com o que foi visto na exploração inicial da planilha (Refrigeração ~40, Dedetização ~54, Gerador ~42-46, etc. — variação pequena esperada por causa de linhas "N/C"/"desativa" descartadas).

Não há commit de código nesta task — é população de dados em produção, não uma mudança de repositório.
