# Controle Mensal por Equipamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Painel que mostra, por equipamento cadastrado, quais meses do ano já têm documento e quais estão faltando, respeitando a frequência de cada equipamento (mensal/semestral/anual) e sem gerar pendência retroativa a antes do início da obrigatoriedade.

**Architecture:** Uma função Postgres (RPC) nova, `equipamentos_pendencias_ano`, no mesmo espírito da RPC `cobrancas_pendencias_ano` já existente, mas agregando por equipamento. Uma camada de serviço (`src/lib/controleEquipamentosService.ts`) chama essa RPC, reaproveitando `anoManaus`/`calcularMesLimite` já existentes em `cobrancasService.ts` (não duplica). Uma rota de API agrupa o resultado em Loja → Tipo de equipamento → Equipamento. Um hook client-side e uma tela nova, ambos espelhando a estrutura já usada pela tela de Cobranças (`useCobrancas`, `src/app/documentos/cobrancas/page.tsx`).

**Tech Stack:** Next.js App Router, Supabase (Postgres + RPC), TypeScript, Vitest.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-07-31-controle-mensal-equipamento-design.md`.
- Frequência por equipamento: `mensal` (todo mês), `semestral` (junho e dezembro), `anual` (dezembro) — sempre filtrado pelo mês-limite do ano de referência (mesma regra de `calcularMesLimite` já existente e testada em `cobrancasService.ts`, reaproveitada aqui, não reimplementada).
- Início da obrigatoriedade por equipamento: `data_ativacao` → `data_instalacao` → `created_at`, nessa ordem de prioridade. Nenhum mês anterior a essa data gera pendência.
- "Documento recebido" num mês = qualquer `formulario` com `equipamento_id` daquele equipamento e `dados->>competencia` no formato `MM/AAAA` batendo o mês/ano — **qualquer tipo de documento**, não só os tipos que a IA vincula automaticamente.
- Acesso restrito a admin/gestor (aprovador interno), mesmo padrão já usado em `/api/cobrancas/pendencias` (`isAdmin || isAprovadorInterno`) — não o padrão antigo de `gerente_loja` que a tela de Cobranças ainda usa no client (isso é uma inconsistência pré-existente fora do escopo deste plano; a tela nova deste plano já nasce com o padrão correto).
- Sem alertas por e-mail — fora de escopo (sub-projeto 6).
- Nomes e mensagens em português, seguindo o padrão do restante do código.

---

### Task 1: Migration — `frequencia` em `equipamentos` + RPC `equipamentos_pendencias_ano`

**Files:**
- Create: `supabase/migrations/202607311500_add_frequencia_equipamentos_e_rpc_pendencias.sql`

**Interfaces:**
- Produces: coluna `public.equipamentos.frequencia` (text, default `'mensal'`, CHECK em `'mensal'`, `'semestral'`, `'anual'`); função `public.equipamentos_pendencias_ano(p_ano integer, p_mes_limite integer default 12)` retornando uma linha por equipamento ativo com pendência. Consumida pela Task 2 (`levantarPendenciasEquipamentos`).

- [ ] **Step 1: Escrever a migration**

```sql
ALTER TABLE public.equipamentos
  ADD COLUMN frequencia text NOT NULL DEFAULT 'mensal'
  CHECK (frequencia IN ('mensal', 'semestral', 'anual'));

CREATE OR REPLACE FUNCTION public.equipamentos_pendencias_ano(
  p_ano        integer,
  p_mes_limite integer DEFAULT 12
)
RETURNS TABLE (
  equipamento_id       uuid,
  loja_id              uuid,
  loja_nome            text,
  tipo_equipamento     text,
  identificacao        text,
  frequencia           text,
  meses_com_documentos integer[],
  meses_pendentes      integer[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH equip AS (
    SELECT
      e.id AS equipamento_id,
      e.loja_id,
      l.nome AS loja_nome,
      e.tipo_equipamento,
      e.identificacao,
      e.frequencia,
      COALESCE(e.data_ativacao, e.data_instalacao, e.created_at::date) AS inicio
    FROM public.equipamentos e
    JOIN public.lojas l ON l.id = e.loja_id
    WHERE e.status = 'ativo'
  ),
  meses_devidos AS (
    SELECT eq.equipamento_id, s.mes
    FROM equip eq
    CROSS JOIN generate_series(1, p_mes_limite) AS s(mes)
    WHERE
      (eq.frequencia = 'mensal'
       OR (eq.frequencia = 'semestral' AND s.mes IN (6, 12))
       OR (eq.frequencia = 'anual' AND s.mes = 12))
      AND make_date(p_ano, s.mes, 1) >= date_trunc('month', eq.inicio)::date
  ),
  docs_ano AS (
    SELECT
      f.equipamento_id,
      split_part(f.dados->>'competencia', '/', 1)::integer AS mes
    FROM public.formularios f
    WHERE f.equipamento_id IS NOT NULL
      AND f.dados->>'competencia' ~ '^(0?[1-9]|1[0-2])/[0-9]{4}$'
      AND split_part(f.dados->>'competencia', '/', 2)::integer = p_ano
  )
  SELECT
    eq.equipamento_id,
    eq.loja_id,
    eq.loja_nome,
    eq.tipo_equipamento,
    eq.identificacao,
    eq.frequencia,
    COALESCE(
      array(
        SELECT DISTINCT da.mes
        FROM docs_ano da
        WHERE da.equipamento_id = eq.equipamento_id
        ORDER BY da.mes
      ),
      '{}'::integer[]
    ) AS meses_com_documentos,
    COALESCE(
      array(
        SELECT DISTINCT md.mes
        FROM meses_devidos md
        WHERE md.equipamento_id = eq.equipamento_id
          AND NOT EXISTS (
            SELECT 1 FROM docs_ano da2
            WHERE da2.equipamento_id = eq.equipamento_id AND da2.mes = md.mes
          )
        ORDER BY md.mes
      ),
      '{}'::integer[]
    ) AS meses_pendentes
  FROM equip eq
  WHERE EXISTS (
    SELECT 1
    FROM meses_devidos md
    WHERE md.equipamento_id = eq.equipamento_id
      AND NOT EXISTS (
        SELECT 1 FROM docs_ano da3
        WHERE da3.equipamento_id = eq.equipamento_id AND da3.mes = md.mes
      )
  );
$$;
```

- [ ] **Step 2: Aplicar no Supabase**

Use a ferramenta MCP `apply_migration` (projeto `tqzvgqauvbknwdvbtvfr`, nome `add_frequencia_equipamentos_e_rpc_pendencias`) com o SQL acima.

- [ ] **Step 3: Verificar a coluna**

Via MCP `execute_sql`:
```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'equipamentos' and column_name = 'frequencia';
```
Esperado: `text`, default `'mensal'::text`.

- [ ] **Step 4: Verificar a RPC com um caso de teste real**

Escolha um `equipamento_id` real de um equipamento `ativo` já importado (ex.: rode `select id, loja_id, tipo_equipamento, frequencia from public.equipamentos where status = 'ativo' limit 1;`). Rode:
```sql
select * from public.equipamentos_pendencias_ano(2026, 7);
```
Esperado: uma linha para cada equipamento ativo com pelo menos um mês pendente até o mês 7. Confirme visualmente que `meses_pendentes` não inclui nenhum mês anterior ao mês de `COALESCE(data_ativacao, data_instalacao, created_at)` desse equipamento (a maioria dos 139 importados não tem `data_ativacao`/`data_instalacao`, então o início efetivo é a data de importação/`created_at` — os meses antes disso não devem aparecer).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607311500_add_frequencia_equipamentos_e_rpc_pendencias.sql
git commit -m "feat(db): adiciona frequencia em equipamentos e RPC de pendencias mensais"
```

---

### Task 2: `src/lib/controleEquipamentosService.ts`

**Files:**
- Create: `src/lib/controleEquipamentosService.ts`
- Test: `src/lib/controleEquipamentosService.test.ts`

**Interfaces:**
- Consumes: `anoManaus`, `calcularMesLimite` (já existem e já são testadas em `src/lib/cobrancasService.ts` — importar, não duplicar); `createSupabaseAdminClient` (já existe).
- Produces:
  - `type Frequencia = "mensal" | "semestral" | "anual"`
  - `calcularMesesDevidos(frequencia: Frequencia, mesLimite: number): number[]` — função pura que documenta (e deve ser mantida em sincronia com) a lógica de meses devidos da RPC da Task 1: mensal retorna todos os meses de 1 até `mesLimite`; semestral retorna só 6 e 12 que estejam `<= mesLimite`; anual retorna só 12 se `<= mesLimite`.
  - `type PendenciaEquipamento = { equipamento_id: string; loja_id: string; loja_nome: string; tipo_equipamento: string; identificacao: string | null; frequencia: Frequencia; meses_com_documentos: number[]; meses_pendentes: number[]; total_esperado: number; total_recebido: number; total_faltante: number }`
  - `levantarPendenciasEquipamentos(ano?: number, supabase?: SupabaseClient): Promise<PendenciaEquipamento[]>`

  Consumida pela Task 3 (rota de API).

- [ ] **Step 1: Escrever os testes que falham**

```typescript
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calcularMesesDevidos,
  levantarPendenciasEquipamentos,
} from "@/lib/controleEquipamentosService";

describe("calcularMesesDevidos", () => {
  it("mensal retorna todos os meses ate o limite", () => {
    expect(calcularMesesDevidos("mensal", 4)).toEqual([1, 2, 3, 4]);
  });

  it("semestral retorna so junho e dezembro dentro do limite", () => {
    expect(calcularMesesDevidos("semestral", 12)).toEqual([6, 12]);
    expect(calcularMesesDevidos("semestral", 5)).toEqual([]);
    expect(calcularMesesDevidos("semestral", 7)).toEqual([6]);
  });

  it("anual retorna so dezembro dentro do limite", () => {
    expect(calcularMesesDevidos("anual", 12)).toEqual([12]);
    expect(calcularMesesDevidos("anual", 11)).toEqual([]);
  });

  it("limite zero retorna lista vazia para qualquer frequencia", () => {
    expect(calcularMesesDevidos("mensal", 0)).toEqual([]);
    expect(calcularMesesDevidos("semestral", 0)).toEqual([]);
    expect(calcularMesesDevidos("anual", 0)).toEqual([]);
  });
});

describe("levantarPendenciasEquipamentos", () => {
  it("mapeia as linhas da RPC e calcula os totais", async () => {
    const supabase = {
      rpc: async (nome: string, params: Record<string, unknown>) => {
        expect(nome).toBe("equipamentos_pendencias_ano");
        expect(params).toEqual({ p_ano: 2026, p_mes_limite: expect.any(Number) });
        return {
          data: [
            {
              equipamento_id: "eq-1",
              loja_id: "loja-1",
              loja_nome: "Loja Teste",
              tipo_equipamento: "Gerador",
              identificacao: "Gerador 01",
              frequencia: "mensal",
              meses_com_documentos: [1, 2],
              meses_pendentes: [3],
            },
          ],
          error: null,
        };
      },
    } as unknown as SupabaseClient;

    const pendencias = await levantarPendenciasEquipamentos(2026, supabase);

    expect(pendencias).toEqual([
      {
        equipamento_id: "eq-1",
        loja_id: "loja-1",
        loja_nome: "Loja Teste",
        tipo_equipamento: "Gerador",
        identificacao: "Gerador 01",
        frequencia: "mensal",
        meses_com_documentos: [1, 2],
        meses_pendentes: [3],
        total_esperado: 3,
        total_recebido: 2,
        total_faltante: 1,
      },
    ]);
  });

  it("propaga erro da RPC", async () => {
    const supabase = {
      rpc: async () => ({ data: null, error: new Error("falhou") }),
    } as unknown as SupabaseClient;

    await expect(levantarPendenciasEquipamentos(2026, supabase)).rejects.toThrow(
      "falhou",
    );
  });

  it("trata data/meses nulos da RPC como vazios", async () => {
    const supabase = {
      rpc: async () => ({
        data: [
          {
            equipamento_id: "eq-2",
            loja_id: "loja-1",
            loja_nome: "Loja Teste",
            tipo_equipamento: "Ar Condicionado",
            identificacao: null,
            frequencia: "mensal",
            meses_com_documentos: null,
            meses_pendentes: null,
          },
        ],
        error: null,
      }),
    } as unknown as SupabaseClient;

    const [pendencia] = await levantarPendenciasEquipamentos(2026, supabase);
    expect(pendencia.meses_com_documentos).toEqual([]);
    expect(pendencia.meses_pendentes).toEqual([]);
    expect(pendencia.total_esperado).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm run test -- controleEquipamentosService`
Expected: FAIL — `Cannot find module '@/lib/controleEquipamentosService'`.

- [ ] **Step 3: Implementar**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { anoManaus, calcularMesLimite } from "@/lib/cobrancasService";

export type Frequencia = "mensal" | "semestral" | "anual";

export function calcularMesesDevidos(
  frequencia: Frequencia,
  mesLimite: number,
): number[] {
  const meses: number[] = [];
  for (let mes = 1; mes <= mesLimite; mes++) {
    const devido =
      frequencia === "mensal" ||
      (frequencia === "semestral" && (mes === 6 || mes === 12)) ||
      (frequencia === "anual" && mes === 12);
    if (devido) {
      meses.push(mes);
    }
  }
  return meses;
}

export type PendenciaEquipamento = {
  equipamento_id: string;
  loja_id: string;
  loja_nome: string;
  tipo_equipamento: string;
  identificacao: string | null;
  frequencia: Frequencia;
  meses_com_documentos: number[];
  meses_pendentes: number[];
  total_esperado: number;
  total_recebido: number;
  total_faltante: number;
};

type RpcRow = {
  equipamento_id: string;
  loja_id: string;
  loja_nome: string;
  tipo_equipamento: string;
  identificacao: string | null;
  frequencia: string;
  meses_com_documentos: number[] | null;
  meses_pendentes: number[] | null;
};

export async function levantarPendenciasEquipamentos(
  ano?: number,
  supabase: SupabaseClient = createSupabaseAdminClient(),
): Promise<PendenciaEquipamento[]> {
  const anoRef = ano ?? anoManaus();
  const mesLimite = calcularMesLimite(anoRef);

  const { data, error } = await supabase.rpc("equipamentos_pendencias_ano", {
    p_ano: anoRef,
    p_mes_limite: mesLimite,
  });

  if (error) {
    throw error;
  }

  return ((data ?? []) as RpcRow[]).map((row) => {
    const mesesComDocumentos = row.meses_com_documentos ?? [];
    const mesesPendentes = row.meses_pendentes ?? [];
    return {
      equipamento_id: row.equipamento_id,
      loja_id: row.loja_id,
      loja_nome: row.loja_nome,
      tipo_equipamento: row.tipo_equipamento,
      identificacao: row.identificacao,
      frequencia: row.frequencia as Frequencia,
      meses_com_documentos: mesesComDocumentos,
      meses_pendentes: mesesPendentes,
      total_esperado: mesesComDocumentos.length + mesesPendentes.length,
      total_recebido: mesesComDocumentos.length,
      total_faltante: mesesPendentes.length,
    };
  });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm run test -- controleEquipamentosService`
Expected: PASS — todos os 7 testes (4 de `calcularMesesDevidos` + 3 de `levantarPendenciasEquipamentos`) passam.

- [ ] **Step 5: Rodar a suite completa**

Run: `npm run test`
Expected: PASS — nenhum teste existente quebrou.

- [ ] **Step 6: Commit**

```bash
git add src/lib/controleEquipamentosService.ts src/lib/controleEquipamentosService.test.ts
git commit -m "feat: adiciona servico de controle mensal por equipamento"
```

---

### Task 3: API `GET /api/controle-equipamentos/pendencias`

**Files:**
- Create: `src/app/api/controle-equipamentos/pendencias/route.ts`

**Interfaces:**
- Consumes: `levantarPendenciasEquipamentos`, `anoManaus` (Tasks 2, e `cobrancasService.ts` já existente); `getActorFromRequest`, `ApiHttpError` (já existem); `isAprovadorInterno` (já existe, `@/lib/orcamentosInternos`).
- Produces: `GET /api/controle-equipamentos/pendencias?ano=<ano>` retornando `{ ano, perfil, total_equipamentos_pendentes, total_pendencias, lojas: [{ loja_id, loja_nome, tipos: [{ tipo_equipamento, equipamentos: [...] }] }] }`. Consumida pela Task 4 (hook).

- [ ] **Step 1: Implementar a rota**

```typescript
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { getActorFromRequest, ApiHttpError as HttpError } from "@/lib/apiAuth";
import { anoManaus } from "@/lib/cobrancasService";
import { levantarPendenciasEquipamentos } from "@/lib/controleEquipamentosService";
import { isAprovadorInterno } from "@/lib/orcamentosInternos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EquipamentoResumo = {
  equipamento_id: string;
  identificacao: string | null;
  frequencia: string;
  meses_com_documentos: number[];
  meses_pendentes: number[];
  total_esperado: number;
  total_recebido: number;
  total_faltante: number;
};

type TipoResumo = {
  tipo_equipamento: string;
  equipamentos: EquipamentoResumo[];
};

type LojaResumo = {
  loja_id: string;
  loja_nome: string;
  tipos: TipoResumo[];
};

export async function GET(request: Request) {
  try {
    const supabase = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabase);
    const email = actor.email;

    const isAdmin = actor.isAdmin;
    const isGestor = isAdmin || (await isAprovadorInterno(email, supabase));

    if (!isGestor) {
      throw new HttpError(
        403,
        "Controle de equipamentos é restrito a administradores e gestores.",
      );
    }

    const { searchParams } = new URL(request.url);
    const anoParam = searchParams.get("ano");
    const anoNum = anoParam ? Number(anoParam) : NaN;
    const ano = Number.isFinite(anoNum) ? anoNum : undefined;

    const pendencias = await levantarPendenciasEquipamentos(ano, supabase);

    const porLoja: Record<string, LojaResumo> = {};

    for (const p of pendencias) {
      if (!porLoja[p.loja_id]) {
        porLoja[p.loja_id] = {
          loja_id: p.loja_id,
          loja_nome: p.loja_nome,
          tipos: [],
        };
      }
      const loja = porLoja[p.loja_id];

      let tipo = loja.tipos.find((t) => t.tipo_equipamento === p.tipo_equipamento);
      if (!tipo) {
        tipo = { tipo_equipamento: p.tipo_equipamento, equipamentos: [] };
        loja.tipos.push(tipo);
      }

      tipo.equipamentos.push({
        equipamento_id: p.equipamento_id,
        identificacao: p.identificacao,
        frequencia: p.frequencia,
        meses_com_documentos: p.meses_com_documentos,
        meses_pendentes: p.meses_pendentes,
        total_esperado: p.total_esperado,
        total_recebido: p.total_recebido,
        total_faltante: p.total_faltante,
      });
    }

    const lojas = Object.values(porLoja).sort((a, b) =>
      a.loja_nome.localeCompare(b.loja_nome),
    );

    return NextResponse.json({
      ano: ano ?? anoManaus(),
      perfil: isAdmin ? "admin" : "gestor",
      total_equipamentos_pendentes: pendencias.length,
      total_pendencias: pendencias.reduce((soma, p) => soma + p.total_faltante, 0),
      lojas,
    });
  } catch (err) {
    console.error("[controle-equipamentos/pendencias] Erro:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Erro ao consultar pendências de equipamentos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Rodar a suite completa e o typecheck**

Run: `npm run test`
Run: `npx tsc --noEmit -p .`
Expected: ambos limpos.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/controle-equipamentos/pendencias/route.ts
git commit -m "feat: adiciona rota de API para pendencias de controle mensal por equipamento"
```

---

### Task 4: Hook `src/hooks/useControleEquipamentos.ts`

**Files:**
- Create: `src/hooks/useControleEquipamentos.ts`

**Interfaces:**
- Consumes: `GET /api/controle-equipamentos/pendencias` (Task 3).
- Produces: `useControleEquipamentos(ano: number, enabled?: boolean)` retornando `{ data, loading, error, refresh }`, mesmo formato de `useCobrancas` (`src/hooks/useCobrancas.ts`). Consumido pela Task 5 (tela).

- [ ] **Step 1: Implementar o hook**

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type EquipamentoPendencia = {
  equipamento_id: string;
  identificacao: string | null;
  frequencia: "mensal" | "semestral" | "anual";
  meses_com_documentos: number[];
  meses_pendentes: number[];
  total_esperado: number;
  total_recebido: number;
  total_faltante: number;
};

export type TipoPendencia = {
  tipo_equipamento: string;
  equipamentos: EquipamentoPendencia[];
};

export type LojaPendenciaEquipamento = {
  loja_id: string;
  loja_nome: string;
  tipos: TipoPendencia[];
};

export type ControleEquipamentosResponse = {
  ano: number;
  perfil: "admin" | "gestor";
  total_equipamentos_pendentes: number;
  total_pendencias: number;
  lojas: LojaPendenciaEquipamento[];
};

type UseControleEquipamentosResult = {
  data: ControleEquipamentosResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useControleEquipamentos(
  ano: number,
  enabled = true,
): UseControleEquipamentosResult {
  const [data, setData] = useState<ControleEquipamentosResponse | null>(null);
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
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    return token;
  }, []);

  const fetchPendencias = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) {
        setData(null);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const response = await fetch(
          `/api/controle-equipamentos/pendencias?ano=${ano}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal,
          },
        );
        const payload = (await response.json()) as
          | ControleEquipamentosResponse
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            (payload as { error?: string }).error ??
              "Falha ao carregar pendências de equipamentos.",
          );
        }
        if (signal?.aborted) {
          return;
        }
        setData(payload as ControleEquipamentosResponse);
      } catch (err) {
        if (signal?.aborted || (err as Error)?.name === "AbortError") {
          return;
        }
        setData(null);
        setError(
          err instanceof Error
            ? err.message
            : "Falha ao carregar pendências de equipamentos.",
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [ano, enabled, getAccessToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchPendencias(controller.signal);
    return () => controller.abort();
  }, [fetchPendencias]);

  const refresh = useCallback(() => {
    void fetchPendencias();
  }, [fetchPendencias]);

  return { data, loading, error, refresh };
}
```

- [ ] **Step 2: Rodar o typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useControleEquipamentos.ts
git commit -m "feat: adiciona hook useControleEquipamentos"
```

---

### Task 5: Tela `/documentos/controle-equipamentos`

**Files:**
- Create: `src/app/documentos/controle-equipamentos/page.tsx`

**Interfaces:**
- Consumes: `useControleEquipamentos` (Task 4), `useAuth`, `useDocumentsAccess`, `useIsAprovadorInterno` (já existem).
- Produces: rota `/documentos/controle-equipamentos`, visível só para admin/gestor. Consumida pela Task 6 (nav).

- [ ] **Step 1: Ler a tela de referência**

Leia `src/app/documentos/cobrancas/page.tsx` por completo antes de implementar — a tela nova segue a mesma estrutura visual (seletor de ano, busca, grade de meses coloridos por linha — verde=recebido, vermelho=pendente, cinza=não vencido ainda — componente `MesGridBase` naquele arquivo é a referência direta do componente de grade a replicar aqui). A diferença estrutural: cobranças agrupa por Prestador → Loja; esta tela agrupa por Loja → Tipo de equipamento → Equipamento (um nível a mais).

Note também que a tela de Cobranças usa `podeVer = isAdmin || role === "gerente_loja"` no client — **não copie esse padrão**, ele é uma inconsistência pré-existente (o backend daquela rota já é restrito a admin/gestor desde uma correção anterior, mas o guard do client não foi atualizado). A tela nova deste plano usa o padrão correto desde o início: `isAdmin || isAprovadorInterno` (mesmo hook `useIsAprovadorInterno` já usado em `src/components/AppShell.tsx`).

- [ ] **Step 2: Implementar a tela**

Estrutura mínima obrigatória (adapte o styling ao padrão visual de `cobrancas/page.tsx`, incluindo o componente de grade de 12 meses, mas a lógica de agrupamento e de guard abaixo é o requisito):

```typescript
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { useIsAprovadorInterno } from "@/hooks/useIsAprovadorInterno";
import {
  useControleEquipamentos,
  type EquipamentoPendencia,
} from "@/hooks/useControleEquipamentos";

const MESES_CURTOS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

function anosDisponiveis(): number[] {
  const atual = new Date().getFullYear();
  return [atual, atual - 1, atual - 2];
}

function MesGrid({ equipamento }: { equipamento: EquipamentoPendencia }) {
  const presentes = new Set(equipamento.meses_com_documentos);
  const pendentes = new Set(equipamento.meses_pendentes);
  return (
    <div className="flex flex-wrap gap-1">
      {MESES_CURTOS.map((label, idx) => {
        const mes = idx + 1;
        let cls = "bg-slate-100 text-slate-400";
        if (presentes.has(mes)) {
          cls = "bg-emerald-100 text-emerald-700";
        } else if (pendentes.has(mes)) {
          cls = "bg-red-100 text-red-700";
        }
        return (
          <span
            key={label}
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

export default function ControleEquipamentosPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();
  const { isAprovadorInterno, loading: aprovadorLoading } = useIsAprovadorInterno();

  const podeVer = isAdmin || isAprovadorInterno;
  const carregando = authLoading || accessLoading || aprovadorLoading;

  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [lojaFilter, setLojaFilter] = useState("todas");
  const [tipoFilter, setTipoFilter] = useState("todos");

  const { data, loading, error } = useControleEquipamentos(ano, podeVer && !carregando);

  useEffect(() => {
    if (carregando) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!podeVer) {
      router.replace("/documentos");
    }
  }, [carregando, user, podeVer, router]);

  const lojasFiltradas = useMemo(() => {
    if (!data) return [];
    return data.lojas
      .filter((loja) => lojaFilter === "todas" || loja.loja_id === lojaFilter)
      .map((loja) => ({
        ...loja,
        tipos: loja.tipos.filter(
          (tipo) => tipoFilter === "todos" || tipo.tipo_equipamento === tipoFilter,
        ),
      }))
      .filter((loja) => loja.tipos.length > 0);
  }, [data, lojaFilter, tipoFilter]);

  const tiposDisponiveis = useMemo(() => {
    if (!data) return [];
    const tipos = new Set<string>();
    data.lojas.forEach((loja) => loja.tipos.forEach((t) => tipos.add(t.tipo_equipamento)));
    return Array.from(tipos).sort();
  }, [data]);

  if (carregando || !podeVer) {
    return null;
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">
          Controle mensal por equipamento
        </h1>
        <select
          value={ano}
          onChange={(event) => setAno(Number(event.target.value))}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {anosDisponiveis().map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex gap-3">
        <select
          value={lojaFilter}
          onChange={(event) => setLojaFilter(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="todas">Todas as lojas</option>
          {data?.lojas.map((loja) => (
            <option key={loja.loja_id} value={loja.loja_id}>
              {loja.loja_nome}
            </option>
          ))}
        </select>
        <select
          value={tipoFilter}
          onChange={(event) => setTipoFilter(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="todos">Todos os tipos</option>
          {tiposDisponiveis.map((tipo) => (
            <option key={tipo} value={tipo}>
              {tipo}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando...</p>
      ) : lojasFiltradas.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhuma pendência encontrada.</p>
      ) : (
        <div className="space-y-6">
          {lojasFiltradas.map((loja) => (
            <div key={loja.loja_id} className="rounded-xl border border-slate-200 p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">{loja.loja_nome}</h2>
              {loja.tipos.map((tipo) => (
                <div key={tipo.tipo_equipamento} className="mb-3">
                  <p className="mb-1 text-xs font-semibold uppercase text-slate-500">
                    {tipo.tipo_equipamento}
                  </p>
                  <table className="w-full text-left text-sm">
                    <tbody>
                      {tipo.equipamentos.map((equipamento) => (
                        <tr key={equipamento.equipamento_id} className="border-b border-slate-100">
                          <td className="py-2 pr-3 text-slate-700">
                            {equipamento.identificacao ?? "—"}
                          </td>
                          <td className="py-2 pr-3">
                            <MesGrid equipamento={equipamento} />
                          </td>
                          <td className="py-2 text-right text-xs text-slate-500">
                            {equipamento.total_recebido}/{equipamento.total_esperado}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Rodar o typecheck e o lint**

Run: `npx tsc --noEmit -p .`
Expected: sem erros.

Run: `npx eslint src/app/documentos/controle-equipamentos/page.tsx`
Expected: sem erros.

- [ ] **Step 4: Verificar manualmente**

Suba o dev server (`npm run dev`), logado como admin: acesse `/documentos/controle-equipamentos` (ainda sem link no menu até a Task 6), confirme que a grade carrega, que o filtro por loja e por tipo funciona, e que a cor de cada mês bate com o esperado (verde = tem documento, vermelho = pendente, cinza = ainda não vencido ou antes do início da obrigatoriedade do equipamento).

- [ ] **Step 5: Commit**

```bash
git add src/app/documentos/controle-equipamentos/page.tsx
git commit -m "feat: adiciona tela de controle mensal por equipamento"
```

---

### Task 6: Entrada no menu

**Files:**
- Modify: `src/components/AppShell.tsx`

**Interfaces:**
- Consumes: rota `/documentos/controle-equipamentos` (Task 5).
- Produces: item novo no menu "Operação", visível só para admin/gestor (mesma condição `isAdminOuGestor` já usada para Cobranças/Pendências/Orçamentos internos neste arquivo).

- [ ] **Step 1: Ler o arquivo atual**

Leia `src/components/AppShell.tsx` — procure pelo item `"/documentos/cobrancas"` no array `navGroups[0].items` (grupo "Operação") e pela constante `isAdminOuGestor` já definida no topo do componente.

- [ ] **Step 2: Adicionar o item**

Adicionar, logo depois do item de Cobranças, usando o mesmo ícone `MailWarning`... na verdade, usar um ícone diferente — importar `ClipboardCheck` de `lucide-react` (adicionar ao bloco de import já existente) para diferenciar visualmente de Cobranças:

```typescript
        {
          href: "/documentos/controle-equipamentos",
          label: "Controle por equipamento",
          icon: ClipboardCheck,
          isActive: pathname?.startsWith("/documentos/controle-equipamentos"),
          isVisible: isAdminOuGestor,
        },
```

- [ ] **Step 3: Rodar o typecheck e o lint**

Run: `npx tsc --noEmit -p .`
Expected: sem erros.

Run: `npx eslint src/components/AppShell.tsx`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/AppShell.tsx
git commit -m "feat: adiciona controle por equipamento ao menu"
```
