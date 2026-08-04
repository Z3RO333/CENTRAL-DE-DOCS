# Sinalização de revisão da IA e achados críticos na lista de Documentos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar visível, direto na lista de Documentos já existente, quais documentos precisam de atenção da IA (`status_analise_ia`) e quais têm achados críticos em aberto (`emergencial`/`crítica`) — sem criar nenhuma tela, rota ou aba nova.

**Architecture:** Extensão pontual de 3 arquivos já existentes: `src/lib/documentosApiUtils.ts` ganha uma função pura de agrupamento de achados críticos por documento; `src/app/api/documentos/route.ts` passa a anexar esse resumo a cada linha retornada e a suportar um novo valor de filtro derivado (`achado_critico`); `src/app/documentos/page.tsx` exibe os dois badges novos (status da IA + achado crítico) nas duas visões já existentes (tabela desktop, cards mobile) e adiciona a opção de filtro. `src/lib/uiStatus.ts` ganha as 3 entradas de status que faltam.

**Tech Stack:** Next.js App Router (TypeScript), Supabase (client via `supabaseAdmin`, sem RPC novo), Vitest.

## Global Constraints

- Nenhuma tela, rota ou aba nova — tudo dentro de `/documentos` e `/api/documentos` já existentes.
- Nenhuma ação de "marcar achado como resolvido" — achados continuam existindo indefinidamente em `documento_recomendacoes_criticas`; este sub-projeto só exibe o que já existe.
- Badge de `status_analise_ia` não aparece quando o valor é `null` (documentos de tipos fora do escopo da análise automática).
- Quando um documento tem mais de um achado crítico em aberto, o resumo mostra o de maior prioridade — `emergencial` antes de `critica` — mais a contagem total.
- O novo filtro `achado_critico` é derivado (não é um valor real da coluna `status_analise_ia`) — filtra por `EXISTS`/`IN` contra `documento_recomendacoes_criticas`, não por `.eq("status_analise_ia", ...)`.

---

### Task 1: `resumirAchadosCriticosPorDocumento` (função pura) + testes

**Files:**
- Modify: `src/lib/documentosApiUtils.ts`
- Test: `src/lib/documentosApiUtils.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `AchadoCriticoResumo` type e `resumirAchadosCriticosPorDocumento(achados)` — consumido pela Task 2 (`src/app/api/documentos/route.ts`).

- [ ] **Step 1: Escrever os testes que falham**

Em `src/lib/documentosApiUtils.test.ts`, adicionar ao final do arquivo (dentro do `describe("documentosApiUtils", ...)` existente, ou como um novo `describe` — usar um novo `describe` para clareza):

```typescript
describe("resumirAchadosCriticosPorDocumento", () => {
  it("retorna objeto vazio quando nao ha achados", () => {
    expect(resumirAchadosCriticosPorDocumento([])).toEqual({});
  });

  it("agrupa um achado por documento", () => {
    const resultado = resumirAchadosCriticosPorDocumento([
      { documento_id: "doc-1", problema: "Vazamento no compressor", prioridade: "critica" },
    ]);
    expect(resultado).toEqual({
      "doc-1": { problema: "Vazamento no compressor", prioridade: "critica", total: 1 },
    });
  });

  it("quando ha mais de um achado, mantem o de maior prioridade e soma o total", () => {
    const resultado = resumirAchadosCriticosPorDocumento([
      { documento_id: "doc-1", problema: "Ruido anormal", prioridade: "critica" },
      { documento_id: "doc-1", problema: "Vazamento identificado", prioridade: "emergencial" },
    ]);
    expect(resultado["doc-1"]).toEqual({
      problema: "Vazamento identificado",
      prioridade: "emergencial",
      total: 2,
    });
  });

  it("mantem critica quando so ha achados critica, mesmo com varios", () => {
    const resultado = resumirAchadosCriticosPorDocumento([
      { documento_id: "doc-1", problema: "Problema A", prioridade: "critica" },
      { documento_id: "doc-1", problema: "Problema B", prioridade: "critica" },
    ]);
    expect(resultado["doc-1"].prioridade).toBe("critica");
    expect(resultado["doc-1"].total).toBe(2);
  });

  it("agrupa documentos diferentes de forma independente", () => {
    const resultado = resumirAchadosCriticosPorDocumento([
      { documento_id: "doc-1", problema: "Problema A", prioridade: "critica" },
      { documento_id: "doc-2", problema: "Problema B", prioridade: "emergencial" },
    ]);
    expect(Object.keys(resultado).sort()).toEqual(["doc-1", "doc-2"]);
    expect(resultado["doc-1"].prioridade).toBe("critica");
    expect(resultado["doc-2"].prioridade).toBe("emergencial");
  });
});
```

E adicionar `resumirAchadosCriticosPorDocumento` ao bloco de import de `@/lib/documentosApiUtils` no topo do arquivo de teste.

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm test -- documentosApiUtils`
Expected: FAIL com "resumirAchadosCriticosPorDocumento is not defined"

- [ ] **Step 3: Implementar `resumirAchadosCriticosPorDocumento`**

Em `src/lib/documentosApiUtils.ts`, adicionar ao final do arquivo:

```typescript
export type AchadoCriticoResumo = {
  problema: string;
  prioridade: "emergencial" | "critica";
  total: number;
};

const PRIORIDADE_CRITICA_PESO: Record<string, number> = {
  emergencial: 2,
  critica: 1,
};

export const resumirAchadosCriticosPorDocumento = (
  achados: Array<{ documento_id: string; problema: string; prioridade: string }>,
): Record<string, AchadoCriticoResumo> => {
  const porDocumento = new Map<
    string,
    Array<{ problema: string; prioridade: string }>
  >();

  for (const achado of achados) {
    const lista = porDocumento.get(achado.documento_id) ?? [];
    lista.push({ problema: achado.problema, prioridade: achado.prioridade });
    porDocumento.set(achado.documento_id, lista);
  }

  const resultado: Record<string, AchadoCriticoResumo> = {};
  for (const [documentoId, lista] of porDocumento) {
    const principal = [...lista].sort(
      (a, b) =>
        (PRIORIDADE_CRITICA_PESO[b.prioridade] ?? 0) -
        (PRIORIDADE_CRITICA_PESO[a.prioridade] ?? 0),
    )[0];
    resultado[documentoId] = {
      problema: principal.problema,
      prioridade: principal.prioridade as "emergencial" | "critica",
      total: lista.length,
    };
  }
  return resultado;
};
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- documentosApiUtils`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentosApiUtils.ts src/lib/documentosApiUtils.test.ts
git commit -m "feat(documentos): adiciona resumirAchadosCriticosPorDocumento"
```

---

### Task 2: `uiStatus.ts` — entradas de status_analise_ia que faltam

**Files:**
- Modify: `src/lib/uiStatus.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `getStatusPresentation("recebido"|"necessita_revisao"|"duplicado")` com label/tom corretos, consumido pela Task 4 (badge na UI).

Esta task não tem teste automatizado dedicado hoje (`uiStatus.ts` não tem arquivo de teste no projeto) — a task abaixo cria um, seguindo o padrão já usado em `documentosApiUtils.test.ts`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/uiStatus.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { getStatusPresentation } from "@/lib/uiStatus";

describe("getStatusPresentation", () => {
  it("retorna label e tom corretos para recebido", () => {
    const presentation = getStatusPresentation("recebido");
    expect(presentation.label).toBe("Aguardando análise");
    expect(presentation.tone).toBe("neutral");
  });

  it("retorna label e tom corretos para necessita_revisao", () => {
    const presentation = getStatusPresentation("necessita_revisao");
    expect(presentation.label).toBe("Necessita revisão");
    expect(presentation.tone).toBe("warning");
  });

  it("retorna label e tom corretos para duplicado", () => {
    const presentation = getStatusPresentation("duplicado");
    expect(presentation.label).toBe("Duplicado");
    expect(presentation.tone).toBe("neutral");
  });

  it("continua funcionando para valores ja existentes (sem regressao)", () => {
    expect(getStatusPresentation("erro").label).toBe("Erro");
    expect(getStatusPresentation("erro").tone).toBe("danger");
    expect(getStatusPresentation("concluida").label).toBe("Concluída");
    expect(getStatusPresentation("concluida").tone).toBe("success");
    expect(getStatusPresentation("em_analise").label).toBe("Em análise");
    expect(getStatusPresentation("em_analise").tone).toBe("info");
  });

  it("usa fallback humanizado para valor desconhecido", () => {
    const presentation = getStatusPresentation("valor_nao_mapeado");
    expect(presentation.label).toBe("Valor Nao Mapeado");
    expect(presentation.tone).toBe("neutral");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- uiStatus`
Expected: FAIL nos casos `recebido`/`necessita_revisao`/`duplicado` (label cai no fallback humanizado em vez do label esperado)

- [ ] **Step 3: Adicionar as 3 entradas que faltam**

Em `src/lib/uiStatus.ts`, dentro do objeto `STATUS` (após a entrada `falha`, linha 36):

```typescript
  erro: { label: "Erro", tone: "danger" },
  falha: { label: "Falha", tone: "danger" },
  recebido: { label: "Aguardando análise", tone: "neutral" },
  necessita_revisao: { label: "Necessita revisão", tone: "warning" },
  duplicado: { label: "Duplicado", tone: "neutral" },
};
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- uiStatus`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/uiStatus.ts src/lib/uiStatus.test.ts
git commit -m "feat(documentos): adiciona status recebido/necessita_revisao/duplicado ao uiStatus"
```

---

### Task 3: `GET /api/documentos` — anexa achado_critico por linha + filtro derivado

**Files:**
- Modify: `src/app/api/documentos/route.ts`

**Interfaces:**
- Consumes: `resumirAchadosCriticosPorDocumento`, `AchadoCriticoResumo` (Task 1, de `@/lib/documentosApiUtils`).
- Produces: `DocumentRecord.achado_critico: AchadoCriticoResumo | null`, consumido pela Task 4 (UI). Filtro `statusAnaliseIa=achado_critico` funcional.

Esta rota não tem teste automatizado hoje (não existe `route.test.ts` no projeto para nenhuma API route) — a verificação desta task é manual (Step 6), seguindo o mesmo padrão já usado nas rotas de análise por IA das sessões anteriores.

- [ ] **Step 1: Importar a função nova**

Em `src/app/api/documentos/route.ts`, no bloco de import de `@/lib/documentosApiUtils` (linhas 4-9):

```typescript
import {
  buildDocumentosTextSearchOr,
  normalizeIds,
  resolveLimit,
  resumirAchadosCriticosPorDocumento,
  safeParseDados,
  sanitizeId,
} from "@/lib/documentosApiUtils";
import type { AchadoCriticoResumo } from "@/lib/documentosApiUtils";
```

- [ ] **Step 2: Estender o tipo `DocumentRecord`**

No tipo `DocumentRecord` (linhas 38-51), adicionar o campo novo ao final:

```typescript
type DocumentRecord = {
  id: string;
  tipo: string;
  status: string;
  arquivo_path: string;
  arquivo_assinado_path: string | null;
  created_at: string;
  dados: Record<string, unknown> | null;
  assinado_por: string | null;
  user_id: string;
  prestador_id: string | null;
  status_analise_ia: string | null;
  equipamento_id: string | null;
  achado_critico: AchadoCriticoResumo | null;
};
```

E em `mapRows` (linhas 93-111), inicializar o campo como `null` (será preenchido depois por `anexarAchadosCriticos`):

```typescript
function mapRows(rows: FormularioRow[]): DocumentRecord[] {
  return rows.map((item) => ({
    id: item.id,
    tipo: item.tipo,
    status: item.status,
    arquivo_path: item.arquivo_path,
    arquivo_assinado_path: item.arquivo_assinado_path ?? null,
    created_at: item.created_at,
    dados: normalizeDisplayData(safeParseDados(item.dados)) as Record<
      string,
      unknown
    > | null,
    assinado_por: item.assinado_por ?? null,
    user_id: item.user_id,
    prestador_id: item.prestador_id ?? null,
    status_analise_ia: item.status_analise_ia ?? null,
    equipamento_id: item.equipamento_id ?? null,
    achado_critico: null,
  }));
}
```

- [ ] **Step 3: Adicionar a função `anexarAchadosCriticos`**

Em `src/app/api/documentos/route.ts`, adicionar após `mapRows` (após a linha 111), importando `SupabaseClient`:

No topo do arquivo, adicionar o import:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
```

E a função:

```typescript
async function anexarAchadosCriticos(
  supabaseAdmin: SupabaseClient,
  registros: DocumentRecord[],
): Promise<DocumentRecord[]> {
  if (registros.length === 0) {
    return registros;
  }

  const ids = registros.map((registro) => registro.id);
  const { data, error } = await supabaseAdmin
    .from("documento_recomendacoes_criticas")
    .select("documento_id,problema,prioridade")
    .in("documento_id", ids)
    .in("prioridade", ["emergencial", "critica"]);

  if (error) {
    throw error;
  }

  const resumoPorDocumento = resumirAchadosCriticosPorDocumento(
    (data ?? []) as Array<{
      documento_id: string;
      problema: string;
      prioridade: string;
    }>,
  );

  return registros.map((registro) => ({
    ...registro,
    achado_critico: resumoPorDocumento[registro.id] ?? null,
  }));
}
```

- [ ] **Step 4: Suportar o filtro derivado `achado_critico`**

Em `src/app/api/documentos/route.ts`, dentro de `GET`, logo após a busca de `conservacaoIds` (após a linha 213, antes do bloco `if (categoriaPrestadorFilter === "conservacao")`), adicionar:

```typescript
    let idsComAchadoCritico: string[] | null = null;
    if (statusAnaliseIaFilter === "achado_critico") {
      const { data: achadosCriticos, error: achadosCriticosError } =
        await supabaseAdmin
          .from("documento_recomendacoes_criticas")
          .select("documento_id")
          .in("prioridade", ["emergencial", "critica"]);
      if (achadosCriticosError) {
        throw achadosCriticosError;
      }
      idsComAchadoCritico = Array.from(
        new Set(
          ((achadosCriticos ?? []) as { documento_id: string }[]).map(
            (item) => item.documento_id,
          ),
        ),
      );
    }
```

Substituir o bloco existente (linhas 266-268):

```typescript
    if (statusAnaliseIaFilter && statusAnaliseIaFilter !== "todos") {
      query = query.eq("status_analise_ia", statusAnaliseIaFilter);
    }
```

por:

```typescript
    if (statusAnaliseIaFilter === "achado_critico") {
      query =
        idsComAchadoCritico && idsComAchadoCritico.length > 0
          ? query.in("id", idsComAchadoCritico)
          : query.eq("id", "00000000-0000-0000-0000-000000000000");
    } else if (statusAnaliseIaFilter && statusAnaliseIaFilter !== "todos") {
      query = query.eq("status_analise_ia", statusAnaliseIaFilter);
    }
```

- [ ] **Step 5: Anexar achados críticos aos dois pontos de retorno**

Em `src/app/api/documentos/route.ts`, substituir o bloco do caminho com filtro de período em memória (linhas 327-330):

```typescript
      return NextResponse.json({
        registros: mapRows(filtrados.slice(offset, offset + limit)),
        total: filtrados.length,
      });
```

por:

```typescript
      const registrosComAchados = await anexarAchadosCriticos(
        supabaseAdmin,
        mapRows(filtrados.slice(offset, offset + limit)),
      );
      return NextResponse.json({
        registros: registrosComAchados,
        total: filtrados.length,
      });
```

E o bloco do caminho normal (linhas 333-336):

```typescript
    return NextResponse.json({
      registros: mapRows((data as FormularioRow[]) ?? []),
      total: count ?? 0,
    });
```

por:

```typescript
    const registrosComAchados = await anexarAchadosCriticos(
      supabaseAdmin,
      mapRows((data as FormularioRow[]) ?? []),
    );
    return NextResponse.json({
      registros: registrosComAchados,
      total: count ?? 0,
    });
```

- [ ] **Step 6: Verificar manualmente**

Rodar `npm run dev`, abrir a tela de Documentos autenticado como admin, confirmar no painel de rede do navegador que a resposta de `GET /api/documentos` inclui `achado_critico` (`null` para a maioria, preenchido para documentos que já têm achado crítico gravado pelo sub-projeto 5 — se nenhum existir ainda em produção, confirmar ao menos que o campo aparece como `null` sem quebrar a resposta). Rodar o typecheck:

Run: `npx tsc --noEmit`
Expected: sem erros novos em `src/app/api/documentos/route.ts`

- [ ] **Step 7: Commit**

```bash
git add src/app/api/documentos/route.ts
git commit -m "feat(documentos): anexa resumo de achados criticos e filtro derivado na API de documentos"
```

---

### Task 4: Badges na lista de Documentos (tabela + cards) e novo filtro

**Files:**
- Modify: `src/app/documentos/page.tsx`

**Interfaces:**
- Consumes: `achado_critico` no payload de `GET /api/documentos` (Task 3), `getStatusPresentation`/`StatusBadge` com as novas entradas (Task 2).
- Produces: nada consumido por outra task — última task do plano.

- [ ] **Step 1: Estender o tipo `FormularioRecord`**

Em `src/app/documentos/page.tsx`, adicionar um tipo novo logo antes de `type FormularioRecord` (linha 27):

```typescript
type AchadoCriticoResumo = {
  problema: string;
  prioridade: "emergencial" | "critica";
  total: number;
};
```

E dentro de `FormularioRecord`, acrescentar após `equipamento_id?: string | null;` (linha 38):

```typescript
  equipamento_id?: string | null;
  achado_critico?: AchadoCriticoResumo | null;
};
```

- [ ] **Step 2: Adicionar a opção de filtro "Achado crítico"**

Em `STATUS_ANALISE_IA_OPTIONS` (linhas 173-181), adicionar uma entrada nova após `duplicado`:

```typescript
const STATUS_ANALISE_IA_OPTIONS = [
  { value: "todos", label: "Todos" },
  { value: "recebido", label: "Aguardando análise" },
  { value: "em_analise", label: "Em análise pela IA" },
  { value: "concluida", label: "Análise concluída" },
  { value: "necessita_revisao", label: "Necessita revisão" },
  { value: "erro", label: "Erro na leitura" },
  { value: "duplicado", label: "Documento duplicado" },
  { value: "achado_critico", label: "Achado crítico" },
];
```

- [ ] **Step 3: Adicionar um helper de badge para status da IA**

Perto de `formatStatusLabel`/`getTipoDescricao` (linhas 167-171), adicionar:

```typescript
function AnaliseIaBadge({ status }: { status: string | null | undefined }) {
  if (!status) {
    return null;
  }
  const presentation = getStatusPresentation(status);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${presentation.className}`}
    >
      {presentation.label}
    </span>
  );
}

function AchadoCriticoBadge({
  achado,
}: {
  achado: AchadoCriticoResumo | null | undefined;
}) {
  if (!achado) {
    return null;
  }
  const titulo =
    achado.total > 1
      ? `${achado.total} achados críticos — ${achado.problema}`
      : achado.problema;
  return (
    <span
      title={titulo}
      className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white"
    >
      ⚠ Achado crítico{achado.total > 1 ? ` (${achado.total})` : ""}
    </span>
  );
}
```

E importar `getStatusPresentation` no topo do arquivo, junto dos outros imports de `@/lib`:

```typescript
import { getStatusPresentation } from "@/lib/uiStatus";
```

- [ ] **Step 4: Inserir os badges na visão de tabela (desktop)**

Em `src/app/documentos/page.tsx`, no `<td>` que hoje só tem `<StatusBadge status={registro.status} />` (linha 2634-2636):

```typescript
                      <td className="px-4 py-3">
                        <StatusBadge status={registro.status} />
                      </td>
```

por:

```typescript
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={registro.status} />
                          <AnaliseIaBadge status={registro.status_analise_ia} />
                          <AchadoCriticoBadge achado={registro.achado_critico} />
                        </div>
                      </td>
```

- [ ] **Step 5: Inserir os badges na visão de cards (mobile)**

No bloco `<div className="flex flex-wrap items-center gap-2">` que hoje contém `<StatusBadge status={registro.status} />` (linhas 2842-2854):

```typescript
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={registro.status} />
                    <span className="text-[11px] text-slate-500">
                      {registro.tipo === "notas_fiscais"
                        ? getDataLabel(registro)
                        : formatDateTime(registro.created_at)}
                    </span>
                    {enviadoPor && (
                      <span className="text-[11px] text-slate-400">
                        por {enviadoPor}
                      </span>
                    )}
                  </div>
```

por:

```typescript
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={registro.status} />
                    <AnaliseIaBadge status={registro.status_analise_ia} />
                    <AchadoCriticoBadge achado={registro.achado_critico} />
                    <span className="text-[11px] text-slate-500">
                      {registro.tipo === "notas_fiscais"
                        ? getDataLabel(registro)
                        : formatDateTime(registro.created_at)}
                    </span>
                    {enviadoPor && (
                      <span className="text-[11px] text-slate-400">
                        por {enviadoPor}
                      </span>
                    )}
                  </div>
```

- [ ] **Step 6: Verificar manualmente no navegador**

Rodar `npm run dev`, abrir `/documentos` autenticado como admin: confirmar que a tabela desktop e a visão de cards mobile (redimensionar a janela ou emular mobile) mostram o badge de status da IA ao lado do badge de status já existente, sem badge quando `status_analise_ia` é `null`. Selecionar "Achado crítico" no filtro de status da IA e confirmar que a lista filtra (mesmo que vazia, se não houver achado crítico gravado ainda) sem erro no console.

- [ ] **Step 7: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 8: Commit**

```bash
git add src/app/documentos/page.tsx
git commit -m "feat(documentos): exibe badges de status da IA e achado critico na lista de documentos"
```

---

## Self-Review

**Cobertura do spec:**
- Badge de `status_analise_ia` visível por linha/card → Task 4 (`AnaliseIaBadge`, badge oculto quando `status` é `null/undefined`). ✅
- Indicador de achado crítico com tooltip (problema do achado principal + contagem) → Task 4 (`AchadoCriticoBadge`). ✅
- `GET /api/documentos` expõe `achado_critico` por linha → Task 3 (`anexarAchadosCriticos`). ✅
- Novo valor de filtro "Achado crítico", derivado via `IN`/lista de ids → Task 3 (`idsComAchadoCritico`) + Task 4 (opção no dropdown). ✅
- Sem tela/rota/aba nova → nenhuma task cria página ou rota nova, só estende as 3 existentes. ✅
- Sem ação de resolver achado → nenhuma task adiciona update/delete em `documento_recomendacoes_criticas`. ✅
- Testes necessários do spec: `getStatusPresentation` para os 3 valores novos + sem regressão (Task 2); função de agrupamento de achados críticos com prioridade/contagem corretas (Task 1); filtro `achado_critico` e resposta com o campo sempre presente (Task 3, verificado manualmente já que não há suite de teste de rota no projeto — mesmo padrão já aceito nas sessões anteriores para `/api/documentos/[id]/analisar`).

**Varredura de placeholders:** nenhum "TBD"/"TODO"/"implementar depois" nas tasks acima; todo código é completo e verbatim, incluindo os trechos "antes"/"depois" exatos para as substituições em `route.ts` e `page.tsx`.

**Consistência de tipos:** `AchadoCriticoResumo` (Task 1, em `documentosApiUtils.ts`) é espelhado em `route.ts` (Task 3, via `import type`) e novamente como tipo local em `page.tsx` (Task 4, mesmo padrão já usado no projeto de duplicar tipos entre API e componente cliente — ver `DocumentDetailsDrawer.tsx`) — os 3 campos (`problema`, `prioridade`, `total`) batem nas três ocorrências. `statusAnaliseIaFilter === "achado_critico"` é tratado de forma consistente: Task 3 o intercepta antes do `.eq("status_analise_ia", ...)`, Task 4 o declara como opção válida no dropdown com o mesmo valor de string.
