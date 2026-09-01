# Assistente virtual — Fase 3: Domínio cobranças Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adiciona o domínio "cobranças" ao assistente virtual (base multi-domínio das Fases 1-2), reaproveitando `levantarPendencias` (já existente) e restringindo o acesso a admin/gestor, igual à tela `/documentos/cobrancas` e à API `GET /api/cobrancas/pendencias` já fazem.

**Architecture:** Um novo módulo `src/lib/assistenteDominioCobrancas.ts` implementa `AssistenteDominio` com uma tool `consultar_pendencias_cobranca(ano?)` que chama `levantarPendencias` (já existe, não muda) e agrega os resultados (que vêm por par prestador+loja) por prestador e por loja. Como não existe conceito de "status" em cobranças, o campo `insights.porStatus` é reaproveitado para carregar a distribuição "por prestador" (mesmo mecanismo genérico, campo com nome herdado da Fase 1 — documentado no código). `mascararEmail` (hoje só dentro de `GET /api/cobrancas/pendencias`) é promovida a export de `cobrancasService.ts` para ser reaproveitada pelo novo domínio sem duplicar a lógica.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-assistente-virtual-global-design.md` (seção "Fase 3 — Domínio cobranças")

## Decisões de implementação (não estão explícitas na spec, registradas aqui)

- **`insights.porStatus` carrega "por prestador" para este domínio.** O tipo `AssistenteInsights` (Fase 1) não tem um campo genérico "por entidade arbitrária" — só `porStatus`/`porLoja`. O widget (`AssistenteWidget.tsx`) já renderiza os dois campos de forma genérica (`[...porStatus, ...porLoja].map(item => <p>{item.label} — {item.total}</p>)`, sem rótulo fixo "Status:"), então reaproveitar o campo é seguro e não exige nenhuma mudança no widget — só um comentário no código do domínio explicando o reaproveitamento, para não confundir quem ler depois.
- **"Por prestador (total faltante)" e "por loja" são somas ponderadas, não contagens.** Os helpers genéricos `buildInsightItems`/`buildTrendItems` (`assistenteInsights.ts`, Fase 1) só contam ocorrências de linha — não servem para somar `total_faltante` por grupo. Em vez de alterar o helper genérico (arriscando efeito colateral nos outros domínios), este módulo implementa sua própria agregação ponderada, local e pequena (`agruparPorPrestador`/`agruparPorLoja` + `buildWeightedInsight`), com a mesma forma de saída (`AssistenteInsightItem`).
- **`sem tendência mensal`**, conforme a spec — `tendenciaMensal: []`.
- **E-mails mascarados só aparecem no resumo enviado ao modelo** (`resumoParaModelo.amostra[].emails_contato`), nunca nos `results` exibidos no widget (que não têm campo de e-mail) — mascarados via `mascararEmail`, nunca o valor cru.
- **Resultados exibidos: até 10 fornecedores** (`COBRANCAS_RESULT_LIMIT`), ordenados por total faltante decrescente — mesma ideia de amostra limitada dos domínios anteriores.
- **`ano` inválido/não numérico vindo do modelo cai para o padrão** (`anoManaus()`, resolvido dentro de `levantarPendencias` quando `ano` é `undefined`) — sem erro, silenciosamente, já que não há ambiguidade de segurança aqui (diferente do `escopo` de orçamentos).

## Global Constraints

- Nenhuma tabela ou migração nova.
- Acesso restrito a quem é admin ou está em `isAprovadorInterno(email)` — replica exatamente `GET /api/cobrancas/pendencias`. Para qualquer outro usuário, o domínio inteiro (tool + prompt + chip) some do agente.
- O agente nunca dispara cobrança nem propõe fazê-lo — reforçado explicitamente no prompt do domínio, já que esta é a única tela das três com uma ação de efeito real (envio de e-mail) diretamente ligada aos dados consultados.
- E-mails de prestador nunca aparecem em texto pleno em nenhuma saída do domínio.

---

### Task 1: Promover `mascararEmail` a export de `cobrancasService.ts`

**Files:**
- Modify: `src/lib/cobrancasService.ts`
- Modify: `src/app/api/cobrancas/pendencias/route.ts`
- Test: `src/lib/cobrancasService.test.ts`

**Interfaces:**
- Produces: `mascararEmail(email: string): string`, exportado de `cobrancasService.ts` — consumido por `src/lib/assistenteDominioCobrancas.ts` (Task 2) e pela rota existente (comportamento idêntico ao de hoje).

- [ ] **Step 1: Escrever o teste (falhando)**

Adicionar ao final de `src/lib/cobrancasService.test.ts`:

```ts
describe("mascararEmail", () => {
  it("mascara o e-mail mantendo os 2 primeiros e o ultimo caractere do local-part", () => {
    expect(mascararEmail("joaosilva@empresa.com")).toBe("jo******a@empresa.com");
  });

  it("usa fallback quando o local-part tem 2 caracteres ou menos", () => {
    expect(mascararEmail("ab@empresa.com")).toBe("a***@empresa.com");
  });

  it("devolve o email original quando nao ha local-part (formato invalido)", () => {
    expect(mascararEmail("@empresa.com")).toBe("@empresa.com");
  });
});
```

No topo de `src/lib/cobrancasService.test.ts`, o import atual é:

```ts
import {
  anoManaus,
  calcularMesLimite,
  diaManaus,
  levantarPendencias,
} from "@/lib/cobrancasService";
```

Trocar por:

```ts
import {
  anoManaus,
  calcularMesLimite,
  diaManaus,
  levantarPendencias,
  mascararEmail,
} from "@/lib/cobrancasService";
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/cobrancasService.test.ts`
Expected: FAIL — `mascararEmail` não é exportado por `cobrancasService.ts`.

- [ ] **Step 3: Mover a função**

Em `src/lib/cobrancasService.ts`, adicionar (perto de `emailsExternos`, mesma área de utilidades de e-mail):

```ts
export function mascararEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local) return email;
  if (!domain || local.length <= 2) return `${local[0] ?? "*"}***@${domain ?? ""}`;
  const visivel = local.slice(0, 2);
  const fim = local.slice(-1);
  const asteriscos = "*".repeat(Math.max(local.length - 3, 3));
  return `${visivel}${asteriscos}${fim}@${domain}`;
}
```

Em `src/app/api/cobrancas/pendencias/route.ts`, remover a definição local de `mascararEmail` (linhas atuais ~10-18) e trocar o import existente:

```ts
import { anoManaus, levantarPendencias } from "@/lib/cobrancasService";
```

por:

```ts
import { anoManaus, levantarPendencias, mascararEmail } from "@/lib/cobrancasService";
```

Nenhum outro trecho do arquivo muda — as chamadas a `mascararEmail(...)` já existentes continuam iguais, só a origem da função muda.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/cobrancasService.test.ts`
Expected: PASS (3 testes novos + os existentes do arquivo).

- [ ] **Step 5: Rodar a suíte completa e verificar tipos**

Run: `npm test && npx tsc --noEmit`
Expected: tudo passando, sem erros de tipo (a rota `pendencias/route.ts` deve continuar funcionando idêntica, só trocando de onde `mascararEmail` vem).

- [ ] **Step 6: Commit**

```bash
git add src/lib/cobrancasService.ts src/lib/cobrancasService.test.ts src/app/api/cobrancas/pendencias/route.ts
git commit -m "refactor: move mascararEmail para cobrancasService.ts como export"
```

---

### Task 2: Domínio cobranças (`assistenteDominioCobrancas.ts`)

**Files:**
- Create: `src/lib/assistenteDominioCobrancas.ts`
- Test: `src/lib/assistenteDominioCobrancas.test.ts`

**Interfaces:**
- Consumes: `AssistenteDominio`, `AssistenteContext`, `AssistenteInsightItem`, `AssistenteInsights`, `AssistenteResultItem`, `AssistenteSearchOutcome`, `AssistenteToolResult` de `assistenteTypes.ts` (Fase 1); `anoManaus`, `levantarPendencias`, `mascararEmail`, type `PendenciaCobranca` de `cobrancasService.ts` (Task 1); `isAprovadorInterno` de `orcamentosInternos.ts`.
- Produces: `dominioCobrancas: AssistenteDominio` (`id: "cobrancas"`), consumido por `assistenteAgent.ts` (Task 3).

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/lib/assistenteDominioCobrancas.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/orcamentosInternos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/orcamentosInternos")>(
    "@/lib/orcamentosInternos",
  );
  return { ...actual, isAprovadorInterno: vi.fn(async () => false) };
});
vi.mock("@/lib/cobrancasService", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cobrancasService")>(
    "@/lib/cobrancasService",
  );
  return { ...actual, levantarPendencias: vi.fn(async () => []) };
});

import { isAprovadorInterno } from "@/lib/orcamentosInternos";
import { levantarPendencias } from "@/lib/cobrancasService";
import { dominioCobrancas } from "@/lib/assistenteDominioCobrancas";
import type { AssistenteContext } from "@/lib/assistenteTypes";

const mockedAprovador = vi.mocked(isAprovadorInterno);
const mockedPendencias = vi.mocked(levantarPendencias);

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
  mockedAprovador.mockReset().mockResolvedValue(false);
  mockedPendencias.mockReset().mockResolvedValue([]);
});

describe("dominioCobrancas.podeAcessar", () => {
  it("nega acesso a usuario comum (nao admin, nao aprovador)", async () => {
    await expect(dominioCobrancas.podeAcessar(makeCtx())).resolves.toBe(false);
  });

  it("permite acesso a admin", async () => {
    await expect(dominioCobrancas.podeAcessar(makeCtx({ isAdmin: true }))).resolves.toBe(true);
  });

  it("permite acesso a aprovador interno", async () => {
    mockedAprovador.mockResolvedValueOnce(true);
    await expect(dominioCobrancas.podeAcessar(makeCtx())).resolves.toBe(true);
  });
});

describe("dominioCobrancas.executarTool consultar_pendencias_cobranca", () => {
  const rows = [
    {
      prestador_id: "prestador-1",
      prestador_nome: "Fornecedor A",
      prestador_emails: ["contato@fornecedora.com"],
      loja_id: "loja-1",
      loja_nome: "Loja 1",
      ano_referencia: 2026,
      meses_com_documentos: [1],
      meses_com_documentos_laudos: [1],
      meses_com_documentos_retencao: [1],
      meses_pendentes: [2, 3],
      meses_pendentes_laudos: [2],
      meses_pendentes_retencao: [3],
      total_esperado: 4,
      total_recebido: 2,
      total_faltante: 2,
    },
    {
      prestador_id: "prestador-1",
      prestador_nome: "Fornecedor A",
      prestador_emails: ["contato@fornecedora.com"],
      loja_id: "loja-2",
      loja_nome: "Loja 2",
      ano_referencia: 2026,
      meses_com_documentos: [],
      meses_com_documentos_laudos: [],
      meses_com_documentos_retencao: [],
      meses_pendentes: [1],
      meses_pendentes_laudos: [1],
      meses_pendentes_retencao: [],
      total_esperado: 1,
      total_recebido: 0,
      total_faltante: 1,
    },
    {
      prestador_id: "prestador-2",
      prestador_nome: "Fornecedor B",
      prestador_emails: ["contato@fornecedorb.com"],
      loja_id: "loja-1",
      loja_nome: "Loja 1",
      ano_referencia: 2026,
      meses_com_documentos: [1, 2],
      meses_com_documentos_laudos: [1, 2],
      meses_com_documentos_retencao: [1, 2],
      meses_pendentes: [],
      meses_pendentes_laudos: [],
      meses_pendentes_retencao: [],
      total_esperado: 2,
      total_recebido: 2,
      total_faltante: 0,
    },
  ];

  it("chama levantarPendencias com o ano informado", async () => {
    await dominioCobrancas.executarTool("consultar_pendencias_cobranca", { ano: "2025" }, makeCtx());
    expect(mockedPendencias).toHaveBeenCalledWith(2025, expect.anything());
  });

  it("usa o ano padrao (undefined) quando nao informado ou invalido", async () => {
    await dominioCobrancas.executarTool("consultar_pendencias_cobranca", { ano: "abc" }, makeCtx());
    expect(mockedPendencias).toHaveBeenCalledWith(undefined, expect.anything());
  });

  it("agrupa por prestador (soma total_faltante entre lojas) nos resultados", async () => {
    mockedPendencias.mockResolvedValueOnce(rows);
    const result = await dominioCobrancas.executarTool(
      "consultar_pendencias_cobranca",
      {},
      makeCtx(),
    );
    expect(result.outcome).toBeDefined();
    const outcome = result.outcome!;
    expect(outcome.dominio).toBe("cobrancas");
    expect(outcome.total).toBe(3);
    expect(outcome.results[0]).toEqual({
      id: "prestador-1",
      titulo: "Fornecedor A",
      subtitulo: "2 pendência(s) / 3 faltante(s)",
      url: "/documentos/cobrancas",
    });
  });

  it("calcula insights.totais e a distribuicao por prestador/por loja", async () => {
    mockedPendencias.mockResolvedValueOnce(rows);
    const result = await dominioCobrancas.executarTool(
      "consultar_pendencias_cobranca",
      {},
      makeCtx(),
    );
    const insights = result.outcome!.insights;
    expect(insights.totais).toEqual(
      expect.arrayContaining([
        { key: "totalFornecedores", label: "Fornecedores", valor: 2 },
        { key: "totalLojasPendentes", label: "Lojas pendentes", valor: 3 },
        { key: "totalFaltante", label: "Documentos faltantes", valor: 3 },
      ]),
    );
    expect(insights.porStatus[0]).toMatchObject({ label: "Fornecedor A", total: 3 });
    expect(insights.tendenciaMensal).toEqual([]);
  });

  it("mascara os e-mails no resumo enviado ao modelo", async () => {
    mockedPendencias.mockResolvedValueOnce(rows);
    const result = await dominioCobrancas.executarTool(
      "consultar_pendencias_cobranca",
      {},
      makeCtx(),
    );
    const resumo = JSON.parse(result.content) as {
      amostra: { emails_contato: string[] }[];
    };
    expect(resumo.amostra[0].emails_contato[0]).not.toBe("contato@fornecedora.com");
    expect(resumo.amostra[0].emails_contato[0]).toContain("@fornecedora.com");
  });
});

describe("dominioCobrancas.descricaoPrompt", () => {
  it("reforca que o agente nunca dispara cobranca", () => {
    const prompt = dominioCobrancas.descricaoPrompt(makeCtx());
    expect(prompt.toLowerCase()).toContain("nunca dispara");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/assistenteDominioCobrancas.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `assistenteDominioCobrancas.ts`**

```ts
import type { AzureOpenAiTool } from "@/lib/azureOpenAi";
import {
  anoManaus,
  levantarPendencias,
  mascararEmail,
  type PendenciaCobranca,
} from "@/lib/cobrancasService";
import { isAprovadorInterno } from "@/lib/orcamentosInternos";
import type {
  AssistenteContext,
  AssistenteDominio,
  AssistenteInsightItem,
  AssistenteInsights,
  AssistenteResultItem,
  AssistenteSearchOutcome,
  AssistenteToolResult,
} from "@/lib/assistenteTypes";

const COBRANCAS_RESULT_LIMIT = 10;

const TOOLS: AzureOpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "consultar_pendencias_cobranca",
      description:
        "Consulta as pendencias de cobranca de documentacao por fornecedor e loja em um ano de referencia. So consulta e explica — nunca dispara cobranca.",
      parameters: {
        type: "object",
        properties: {
          ano: { type: "string", description: "Ano de referencia no formato AAAA (padrao: ano corrente)" },
        },
        required: [],
      },
    },
  },
];

async function podeAcessarCobrancas(ctx: AssistenteContext): Promise<boolean> {
  const cacheKey = "cobrancas:acesso";
  if (ctx.cache.has(cacheKey)) {
    return ctx.cache.get(cacheKey) as boolean;
  }
  const acesso = ctx.isAdmin || (await isAprovadorInterno(ctx.email, ctx.supabaseAdmin));
  ctx.cache.set(cacheKey, acesso);
  return acesso;
}

type GrupoPonderado = { label: string; total: number; emailsMascarados: string[] };

function agruparPorPrestador(rows: PendenciaCobranca[]): Map<string, GrupoPonderado> {
  const grupos = new Map<string, GrupoPonderado>();
  for (const row of rows) {
    const atual = grupos.get(row.prestador_id);
    if (atual) {
      atual.total += row.total_faltante;
      continue;
    }
    grupos.set(row.prestador_id, {
      label: row.prestador_nome,
      total: row.total_faltante,
      emailsMascarados: row.prestador_emails.map(mascararEmail),
    });
  }
  return grupos;
}

function agruparPorLoja(rows: PendenciaCobranca[]): Map<string, GrupoPonderado> {
  const grupos = new Map<string, GrupoPonderado>();
  for (const row of rows) {
    const atual = grupos.get(row.loja_id);
    if (atual) {
      atual.total += row.total_faltante;
      continue;
    }
    grupos.set(row.loja_id, { label: row.loja_nome, total: row.total_faltante, emailsMascarados: [] });
  }
  return grupos;
}

function buildWeightedInsight(
  grupos: Map<string, GrupoPonderado>,
  totalBase: number,
  limit = 5,
): AssistenteInsightItem[] {
  return Array.from(grupos.entries())
    .map(([key, grupo]) => ({
      key,
      label: grupo.label,
      total: grupo.total,
      percentual: totalBase > 0 ? Number(((grupo.total / totalBase) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function buildResultados(porPrestador: Map<string, GrupoPonderado>, rows: PendenciaCobranca[]): AssistenteResultItem[] {
  const lojasPorPrestador = new Map<string, number>();
  for (const row of rows) {
    lojasPorPrestador.set(row.prestador_id, (lojasPorPrestador.get(row.prestador_id) ?? 0) + 1);
  }
  return Array.from(porPrestador.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, COBRANCAS_RESULT_LIMIT)
    .map(([id, grupo]) => ({
      id,
      titulo: grupo.label,
      subtitulo: `${lojasPorPrestador.get(id) ?? 0} pendência(s) / ${grupo.total} faltante(s)`,
      url: "/documentos/cobrancas",
    }));
}

function buildObservacoes(input: {
  ano: number;
  totalPrestadores: number;
  totalFaltanteGeral: number;
}): string[] {
  if (input.totalFaltanteGeral === 0) {
    return [`Nenhuma pendência de cobrança encontrada para ${input.ano}.`];
  }
  return [
    `${input.totalPrestadores} fornecedor(es) com pendências em ${input.ano}, totalizando ${input.totalFaltanteGeral} documento(s) faltante(s).`,
  ];
}

async function executarConsultarPendencias(
  args: Record<string, unknown>,
  ctx: AssistenteContext,
): Promise<AssistenteToolResult> {
  const anoNum = typeof args.ano === "string" ? Number(args.ano) : undefined;
  const ano = anoNum !== undefined && Number.isFinite(anoNum) ? anoNum : undefined;
  const anoRef = ano ?? anoManaus();

  const rows = await levantarPendencias(ano, ctx.supabaseAdmin);

  const totalFaltanteGeral = rows.reduce((acc, r) => acc + r.total_faltante, 0);
  const totalPrestadores = new Set(rows.map((r) => r.prestador_id)).size;
  const porPrestador = agruparPorPrestador(rows);
  const porLoja = agruparPorLoja(rows);

  // `porStatus` é reaproveitado aqui para carregar a distribuição "por prestador":
  // cobranças não tem conceito de status, e o widget renderiza esse campo de forma
  // genérica (label + total), sem assumir que o nome do campo é literal.
  const insights: AssistenteInsights = {
    totais: [
      { key: "totalFornecedores", label: "Fornecedores", valor: totalPrestadores },
      { key: "totalLojasPendentes", label: "Lojas pendentes", valor: rows.length },
      { key: "totalFaltante", label: "Documentos faltantes", valor: totalFaltanteGeral },
    ],
    isTruncated: false,
    porStatus: buildWeightedInsight(porPrestador, totalFaltanteGeral, 5),
    porLoja: buildWeightedInsight(porLoja, totalFaltanteGeral, 5),
    tendenciaMensal: [],
    observacoes: buildObservacoes({ ano: anoRef, totalPrestadores, totalFaltanteGeral }),
  };

  const outcome: AssistenteSearchOutcome = {
    dominio: "cobrancas",
    filters: { ano: anoRef },
    filtrosUrl: "/documentos/cobrancas",
    summary: `Critérios usados: ano ${anoRef}.`,
    results: buildResultados(porPrestador, rows),
    total: rows.length,
    insights,
  };

  const resumoParaModelo = {
    ano: anoRef,
    totalFornecedores: totalPrestadores,
    totalLojasPendentes: rows.length,
    totalDocumentosFaltantes: totalFaltanteGeral,
    amostra: Array.from(porPrestador.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5)
      .map(([id, grupo]) => ({
        prestador_id: id,
        prestador_nome: grupo.label,
        total_faltante: grupo.total,
        emails_contato: grupo.emailsMascarados,
      })),
  };

  return { content: JSON.stringify(resumoParaModelo), outcome };
}

export const dominioCobrancas: AssistenteDominio = {
  id: "cobrancas",
  tools: TOOLS,
  podeAcessar: podeAcessarCobrancas,
  descricaoPrompt: () =>
    [
      "Para o domínio de cobranças, você tem a ferramenta consultar_pendencias_cobranca, que mostra pendências de documentação por fornecedor e loja em um ano de referência (padrão: ano corrente).",
      "Você NUNCA dispara cobrança nem envia e-mail — só consulta e explica o que já foi levantado. Se o usuário pedir para 'cobrar' ou 'notificar' um fornecedor, explique que essa ação deve ser feita pela tela de Cobranças.",
      "Nunca exponha e-mails completos de fornecedores — eles já vêm mascarados nos dados que a ferramenta devolve.",
    ].join(" "),
  executarTool: async (nome, args, ctx) => {
    if (nome === "consultar_pendencias_cobranca") {
      return executarConsultarPendencias(args, ctx);
    }
    return { content: JSON.stringify({ erro: `Ferramenta desconhecida: ${nome}` }) };
  },
};
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/assistenteDominioCobrancas.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistenteDominioCobrancas.ts src/lib/assistenteDominioCobrancas.test.ts
git commit -m "feat: adiciona dominio cobrancas ao assistente virtual"
```

---

### Task 3: Registrar o domínio e reativar o atalho no widget

**Files:**
- Modify: `src/lib/assistenteAgent.ts`
- Modify: `src/components/AssistenteWidget.tsx`

**Interfaces:**
- Consumes: `dominioCobrancas` de `assistenteDominioCobrancas.ts` (Task 2).

- [ ] **Step 1: Registrar o domínio no core do agente**

Em `src/lib/assistenteAgent.ts`, adicionar o import e incluir no array:

```ts
import { dominioCobrancas } from "@/lib/assistenteDominioCobrancas";
```

```ts
const DOMINIOS_REGISTRADOS: AssistenteDominio[] = [dominioDocumentos, dominioOrcamentos, dominioCobrancas];
```

- [ ] **Step 2: Reativar o chip de Cobranças no widget**

Em `src/components/AssistenteWidget.tsx`, adicionar ao array `CHIPS`:

```ts
const CHIPS: { dominio: AssistenteDominioId; label: string; pergunta: string }[] = [
  { dominio: "documentos", label: "Documentos", pergunta: "Buscar documentos" },
  { dominio: "orcamentos", label: "Orçamentos", pergunta: "Consultar meus orçamentos" },
  { dominio: "cobrancas", label: "Cobranças", pergunta: "Ver pendências de cobrança" },
];
```

(`ROUTE_DOMINIO` já mapeia `/documentos/cobrancas` → `"cobrancas"` desde a Fase 1 — nenhuma mudança necessária ali.)

- [ ] **Step 3: Rodar a suíte de testes completa**

Run: `npm test`
Expected: todos os testes passam.

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: limpo.

- [ ] **Step 5: Verificar manualmente**

Run: `npm run dev`, logado como admin ou gestor.
Expected: o chip "Cobranças" aparece no widget; clicar preenche "Ver pendências de cobrança"; enviar retorna a lista de fornecedores com pendências (ou "nenhuma pendência" se não houver), com os cards de insight (Fornecedores/Lojas pendentes/Documentos faltantes) e a distribuição por prestador/loja. Logado como usuário comum (não admin, não gestor), o chip não aparece e perguntar sobre cobranças no chat não retorna nenhuma ferramenta desse domínio.

- [ ] **Step 6: Commit**

```bash
git add src/lib/assistenteAgent.ts src/components/AssistenteWidget.tsx
git commit -m "feat: registra o dominio cobrancas no agente e no widget"
```

---

## Self-Review

- **Cobertura da spec (Fase 3):** tool `consultar_pendencias_cobranca(ano?)` ✅; acesso restrito a admin/gestor via `isAprovadorInterno` ✅ (domínio inteiro oculto para os demais); mascaramento de e-mail reaproveitando `mascararEmail` promovida a export ✅; insights por prestador/por loja sobre dados pré-agregados, sem tendência mensal ✅; resultado com título/subtítulo/link conforme especificado ✅; nunca dispara cobrança, reforçado no prompt ✅.
- **Placeholders:** nenhum — todo passo tem código completo.
- **Consistência de tipos:** `dominioCobrancas: AssistenteDominio` usa exatamente os tipos de `assistenteTypes.ts` (Fase 1) sem redefinir nada; o reaproveitamento de `porStatus` para "por prestador" é documentado inline no código e neste plano, não é um uso silencioso/confuso.
