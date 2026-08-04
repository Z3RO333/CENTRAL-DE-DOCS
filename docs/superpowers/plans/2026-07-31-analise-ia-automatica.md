# Análise Automática por IA no Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar o clique manual do botão "Analisar com IA" para documentos enviados via `formularios` (notas fiscais, laudos, retenção trabalhista, contratos, orçamentos externos) — a análise passa a rodar sozinha assim que o documento é recebido, com um status de processamento visível.

**Architecture:** Um Supabase Database Webhook dispara `AFTER INSERT ON formularios`, chamando uma nova rota interna (`POST /api/documentos/ia/processar`) protegida por segredo compartilhado. A rota delega para um pipeline compartilhado (`src/lib/documentAnalysisPipeline.ts`) que verifica duplicidade, baixa o arquivo, chama a IA já existente (`analisarDocumentoComOpenAi`), grava o resultado em `documentos_analises_ia` e atualiza um novo campo `formularios.status_analise_ia`. As duas rotas de análise manual existentes (`/api/documentos/[id]/analisar` e `/api/orcamentos-internos/[id]/analisar`) passam a reusar as mesmas funções de baixo nível do pipeline, em vez de duplicar a lógica de download+chamada+gravação.

**Tech Stack:** Next.js (App Router, API routes), Supabase (Postgres + Storage + Database Webhooks), Azure OpenAI + Azure Document Intelligence (já integrados), Vitest para testes.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-07-31-analise-ia-automatica-design.md`.
- Escopo automático: só os tipos `notas_fiscais`, `registro_laudos`, `retencao_trabalhista`, `contratos`, `orcamentos` (o formulário externo genérico). `orcamentos_internos` e `notas_fiscais_conservacao` ficam fora — não mudam de comportamento neste plano.
- Projeto Supabase: `tqzvgqauvbknwdvbtvfr` ("formulario central").
- App roda em Azure App Service (servidor Node persistente) — sem limite de timeout tipo função serverless, então o polling do OCR (até ~30s) não é um risco.
- Testes com `vitest` (`npm run test`), seguindo o padrão já usado no repo: funções puras/de lib testadas com clientes Supabase falsos (`as unknown as SupabaseClient`), sem framework de integração de API routes.
- Nomes e mensagens de erro em português, seguindo o padrão do restante do código.

---

### Task 1: Migration — coluna `status_analise_ia` em `formularios`

**Files:**
- Create: `supabase/migrations/202607311200_add_status_analise_ia.sql`

**Interfaces:**
- Produces: coluna `public.formularios.status_analise_ia` (text, not null, default `'recebido'`), com CHECK restringindo aos 7 valores do spec. Todas as tasks seguintes leem/escrevem essa coluna.

- [ ] **Step 1: Escrever a migration**

```sql
ALTER TABLE public.formularios
  ADD COLUMN status_analise_ia text NOT NULL DEFAULT 'recebido'
  CHECK (status_analise_ia IN (
    'recebido',
    'aguardando_analise',
    'em_analise',
    'concluida',
    'necessita_revisao',
    'erro',
    'duplicado'
  ));

CREATE INDEX IF NOT EXISTS formularios_status_analise_ia_idx
  ON public.formularios (status_analise_ia);
```

- [ ] **Step 2: Aplicar no Supabase**

Use a ferramenta MCP `apply_migration` (projeto `tqzvgqauvbknwdvbtvfr`, nome `add_status_analise_ia`) com o SQL acima. Isso já registra a migration no histórico do projeto.

- [ ] **Step 3: Verificar**

Rode via MCP `execute_sql`:
```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'formularios' and column_name = 'status_analise_ia';
```
Esperado: uma linha, `data_type = text`, `column_default` contendo `'recebido'::text`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202607311200_add_status_analise_ia.sql
git commit -m "feat(db): adiciona status_analise_ia em formularios"
```

---

### Task 2: Pipeline — funções puras (tipos em escopo, status final, segredo do webhook)

**Files:**
- Create: `src/lib/documentAnalysisPipeline.ts`
- Test: `src/lib/documentAnalysisPipeline.test.ts`

**Interfaces:**
- Consumes: `DocumentoAnaliseIa` (tipo já exportado por `src/lib/openAiDocumentAnalysis.ts`, campos usados aqui: `lojas: Array<{...}>`, `competencias: string[]`, `confianca_geral: number`).
- Produces:
  - `TIPOS_ANALISE_AUTOMATICA: readonly string[]`
  - `deveAnalisarAutomaticamente(tipo: string): boolean`
  - `determinarStatusFinal(resultado: DocumentoAnaliseIa): "concluida" | "necessita_revisao"`
  - `verificarSegredoWebhook(authHeader: string | null, secretEsperado: string | undefined): boolean`
  - `resolveMimeType(path: string, fallback?: string | null): string`
  - `resolveFileName(path: string): string`

  Todas essas funções são consumidas pela Task 5 (orquestrador) e Task 6 (rota do webhook).

- [ ] **Step 1: Escrever os testes que falham**

```typescript
import { describe, expect, it } from "vitest";
import {
  deveAnalisarAutomaticamente,
  determinarStatusFinal,
  resolveFileName,
  resolveMimeType,
  verificarSegredoWebhook,
} from "@/lib/documentAnalysisPipeline";
import type { DocumentoAnaliseIa } from "@/lib/openAiDocumentAnalysis";

function resultadoBase(overrides: Partial<DocumentoAnaliseIa> = {}): DocumentoAnaliseIa {
  return {
    tipo_documento: "notas_fiscais",
    competencias: ["07/2026"],
    lojas: [{ codigo: "001", nome: "Loja Teste", confianca: 0.9 }],
    prestador: "Prestador Teste",
    cnpj: null,
    numero_orcamento: null,
    numero_nf: "123",
    numero_pedido: null,
    numero_contrato: null,
    valor_total: 100,
    descricao: null,
    objeto: null,
    tipo_servico: null,
    data_assinatura: null,
    data_vencimento: null,
    data_validade: null,
    itens: [],
    alertas: [],
    confianca_geral: 0.9,
    observacoes: null,
    recomendacoes: [],
    ...overrides,
  };
}

describe("deveAnalisarAutomaticamente", () => {
  it("aceita os 5 tipos em escopo", () => {
    expect(deveAnalisarAutomaticamente("notas_fiscais")).toBe(true);
    expect(deveAnalisarAutomaticamente("registro_laudos")).toBe(true);
    expect(deveAnalisarAutomaticamente("retencao_trabalhista")).toBe(true);
    expect(deveAnalisarAutomaticamente("contratos")).toBe(true);
    expect(deveAnalisarAutomaticamente("orcamentos")).toBe(true);
  });

  it("rejeita orcamentos_internos e notas_fiscais_conservacao", () => {
    expect(deveAnalisarAutomaticamente("orcamentos_internos")).toBe(false);
    expect(deveAnalisarAutomaticamente("notas_fiscais_conservacao")).toBe(false);
  });
});

describe("determinarStatusFinal", () => {
  it("retorna concluida quando confianca alta e loja/competencia identificadas", () => {
    expect(determinarStatusFinal(resultadoBase())).toBe("concluida");
  });

  it("retorna necessita_revisao quando confianca baixa", () => {
    expect(determinarStatusFinal(resultadoBase({ confianca_geral: 0.3 }))).toBe(
      "necessita_revisao",
    );
  });

  it("retorna necessita_revisao quando nenhuma loja foi identificada", () => {
    expect(determinarStatusFinal(resultadoBase({ lojas: [] }))).toBe(
      "necessita_revisao",
    );
  });

  it("retorna necessita_revisao quando nenhuma competencia foi identificada", () => {
    expect(determinarStatusFinal(resultadoBase({ competencias: [] }))).toBe(
      "necessita_revisao",
    );
  });
});

describe("verificarSegredoWebhook", () => {
  it("aceita quando o header bate com o segredo configurado", () => {
    expect(verificarSegredoWebhook("Bearer abc123", "abc123")).toBe(true);
  });

  it("rejeita quando o segredo nao esta configurado", () => {
    expect(verificarSegredoWebhook("Bearer abc123", undefined)).toBe(false);
  });

  it("rejeita quando o header nao bate", () => {
    expect(verificarSegredoWebhook("Bearer errado", "abc123")).toBe(false);
  });

  it("rejeita quando nao ha header", () => {
    expect(verificarSegredoWebhook(null, "abc123")).toBe(false);
  });
});

describe("resolveMimeType", () => {
  it("usa o fallback quando presente", () => {
    expect(resolveMimeType("a/b.pdf", "image/png")).toBe("image/png");
  });

  it("infere pelo sufixo do path quando nao ha fallback", () => {
    expect(resolveMimeType("a/b.pdf", null)).toBe("application/pdf");
    expect(resolveMimeType("a/b.PNG", null)).toBe("image/png");
    expect(resolveMimeType("a/b.jpeg", null)).toBe("image/jpeg");
    expect(resolveMimeType("a/b.xyz", null)).toBe("application/octet-stream");
  });
});

describe("resolveFileName", () => {
  it("extrai o nome do arquivo do path", () => {
    expect(resolveFileName("pasta/sub/arquivo.pdf")).toBe("arquivo.pdf");
  });

  it("usa um nome padrao quando o path esta vazio", () => {
    expect(resolveFileName("")).toBe("documento.pdf");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm run test -- documentAnalysisPipeline`
Expected: FAIL — `Cannot find module '@/lib/documentAnalysisPipeline'`.

- [ ] **Step 3: Implementar**

```typescript
import type { DocumentoAnaliseIa } from "@/lib/openAiDocumentAnalysis";

export const TIPOS_ANALISE_AUTOMATICA = [
  "notas_fiscais",
  "registro_laudos",
  "retencao_trabalhista",
  "contratos",
  "orcamentos",
] as const;

export function deveAnalisarAutomaticamente(tipo: string): boolean {
  return (TIPOS_ANALISE_AUTOMATICA as readonly string[]).includes(tipo);
}

const LIMIAR_CONFIANCA_REVISAO = 0.5;

export function determinarStatusFinal(
  resultado: DocumentoAnaliseIa,
): "concluida" | "necessita_revisao" {
  const semLoja = !resultado.lojas || resultado.lojas.length === 0;
  const semCompetencia =
    !resultado.competencias || resultado.competencias.length === 0;
  const confiancaBaixa =
    typeof resultado.confianca_geral !== "number" ||
    resultado.confianca_geral < LIMIAR_CONFIANCA_REVISAO;

  if (semLoja || semCompetencia || confiancaBaixa) {
    return "necessita_revisao";
  }
  return "concluida";
}

export function verificarSegredoWebhook(
  authHeader: string | null,
  secretEsperado: string | undefined,
): boolean {
  if (!secretEsperado) {
    return false;
  }
  return authHeader === `Bearer ${secretEsperado}`;
}

export function resolveMimeType(path: string, fallback?: string | null) {
  if (fallback?.trim()) {
    return fallback;
  }

  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export function resolveFileName(path: string) {
  return path.split("/").pop() || "documento.pdf";
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm run test -- documentAnalysisPipeline`
Expected: PASS — todos os 14 testes (2+4+4+2+2) passam, nenhuma falha.

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentAnalysisPipeline.ts src/lib/documentAnalysisPipeline.test.ts
git commit -m "feat: adiciona funcoes puras do pipeline de analise automatica"
```

---

### Task 3: Pipeline — `verificarDuplicado`

**Files:**
- Modify: `src/lib/documentAnalysisPipeline.ts`
- Test: `src/lib/documentAnalysisPipeline.test.ts`

**Interfaces:**
- Consumes: nada de outra task (usa só `SupabaseClient` do `@supabase/supabase-js`).
- Produces: `verificarDuplicado(supabaseAdmin: SupabaseClient, documentoId: string, documento: { tipo: string; prestador_id: string | null; dados: Record<string, unknown> | null }): Promise<boolean>`. Consumida pela Task 5 (orquestrador).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `src/lib/documentAnalysisPipeline.test.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { verificarDuplicado } from "@/lib/documentAnalysisPipeline";

describe("verificarDuplicado", () => {
  it("retorna false quando faltam loja, competencia ou prestador", async () => {
    const supabase = {} as unknown as SupabaseClient;

    expect(
      await verificarDuplicado(supabase, "doc-1", {
        tipo: "notas_fiscais",
        prestador_id: null,
        dados: { loja_id: "loja-1", competencia: "07/2026" },
      }),
    ).toBe(false);

    expect(
      await verificarDuplicado(supabase, "doc-1", {
        tipo: "notas_fiscais",
        prestador_id: "prestador-1",
        dados: { competencia: "07/2026" },
      }),
    ).toBe(false);
  });

  it("retorna true quando ja existe documento concluido com a mesma chave", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    neq: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({
                          data: { id: "doc-existente" },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    expect(
      await verificarDuplicado(supabase, "doc-1", {
        tipo: "notas_fiscais",
        prestador_id: "prestador-1",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
      }),
    ).toBe(true);
  });

  it("retorna false quando a busca nao encontra nada", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    neq: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({ data: null, error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    expect(
      await verificarDuplicado(supabase, "doc-1", {
        tipo: "notas_fiscais",
        prestador_id: "prestador-1",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm run test -- documentAnalysisPipeline`
Expected: FAIL — `verificarDuplicado is not a function`.

- [ ] **Step 3: Implementar**

Adicionar ao `src/lib/documentAnalysisPipeline.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

type FormularioParaDuplicidade = {
  tipo: string;
  prestador_id: string | null;
  dados: Record<string, unknown> | null;
};

export async function verificarDuplicado(
  supabaseAdmin: SupabaseClient,
  documentoId: string,
  documento: FormularioParaDuplicidade,
): Promise<boolean> {
  const lojaId =
    typeof documento.dados?.loja_id === "string" ? documento.dados.loja_id : null;
  const competencia =
    typeof documento.dados?.competencia === "string"
      ? documento.dados.competencia
      : null;

  if (!lojaId || !competencia || !documento.prestador_id) {
    return false;
  }

  const { data, error } = await supabaseAdmin
    .from("formularios")
    .select("id")
    .eq("tipo", documento.tipo)
    .eq("prestador_id", documento.prestador_id)
    .eq("dados->>loja_id", lojaId)
    .eq("dados->>competencia", competencia)
    .eq("status_analise_ia", "concluida")
    .neq("id", documentoId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}
```

(Mover o `import type { SupabaseClient }` para o topo do arquivo, junto do `import type { DocumentoAnaliseIa }` já existente.)

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm run test -- documentAnalysisPipeline`
Expected: PASS — os 14 testes anteriores mais os 3 novos de `verificarDuplicado` (17 no total), nenhuma falha.

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentAnalysisPipeline.ts src/lib/documentAnalysisPipeline.test.ts
git commit -m "feat: adiciona verificacao de documento duplicado"
```

---

### Task 4: Pipeline — download + análise + gravação em `documentos_analises_ia`

**Files:**
- Modify: `src/lib/documentAnalysisPipeline.ts`
- Test: `src/lib/documentAnalysisPipeline.test.ts`

**Interfaces:**
- Consumes: `analisarDocumentoComOpenAi` (já existe em `src/lib/openAiDocumentAnalysis.ts`, assinatura `(input: { fileName, mimeType, bytes, dadosAtuais?, tipoDocumento? }) => Promise<{ provider: string; model: string; resultado: DocumentoAnaliseIa }>`); `resolveMimeType`/`resolveFileName` da Task 2.
- Produces:
  - `baixarEAnalisarArquivo(supabaseAdmin, params: { path: string; tipoDocumento: string | null; dadosAtuais?: Record<string, unknown> | null }): Promise<{ provider: string; model: string; resultado: DocumentoAnaliseIa }>`
  - `registrarAnaliseIa(supabaseAdmin, params: { documentoId: string; provider: string; model: string; resultado?: DocumentoAnaliseIa; erro?: string }): Promise<{ id: string; documento_id: string; provider: string; model: string; status: string; resultado: DocumentoAnaliseIa; erro: string | null; created_at: string }>`

  Ambas consumidas pela Task 5 (orquestrador) e pelas Tasks 8/9 (refatoração das rotas manuais).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `src/lib/documentAnalysisPipeline.test.ts`:

```typescript
import { vi } from "vitest";

vi.mock("@/lib/openAiDocumentAnalysis", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/openAiDocumentAnalysis")
  >("@/lib/openAiDocumentAnalysis");
  return {
    ...actual,
    analisarDocumentoComOpenAi: vi.fn(),
  };
});

import { analisarDocumentoComOpenAi } from "@/lib/openAiDocumentAnalysis";
import { baixarEAnalisarArquivo, registrarAnaliseIa } from "@/lib/documentAnalysisPipeline";

describe("baixarEAnalisarArquivo", () => {
  it("baixa o arquivo do storage e chama a analise por IA", async () => {
    const download = vi.fn(async () => ({
      data: {
        type: "application/pdf",
        arrayBuffer: async () => new ArrayBuffer(4),
      },
      error: null,
    }));
    const supabase = {
      storage: { from: () => ({ download }) },
    } as unknown as SupabaseClient;

    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase(),
    });

    const resultado = await baixarEAnalisarArquivo(supabase, {
      path: "pasta/nota.pdf",
      tipoDocumento: "notas_fiscais",
      dadosAtuais: { loja_id: "loja-1" },
    });

    expect(download).toHaveBeenCalledWith("pasta/nota.pdf");
    expect(resultado.provider).toBe("azure-openai");
    expect(analisarDocumentoComOpenAi).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "nota.pdf",
        mimeType: "application/pdf",
        tipoDocumento: "notas_fiscais",
      }),
    );
  });

  it("lanca erro quando o download falha", async () => {
    const supabase = {
      storage: {
        from: () => ({
          download: async () => ({ data: null, error: new Error("falhou") }),
        }),
      },
    } as unknown as SupabaseClient;

    await expect(
      baixarEAnalisarArquivo(supabase, {
        path: "pasta/nota.pdf",
        tipoDocumento: "notas_fiscais",
      }),
    ).rejects.toThrow("falhou");
  });

  it("lanca erro para tipo de arquivo nao suportado", async () => {
    const supabase = {
      storage: {
        from: () => ({
          download: async () => ({
            data: { type: "application/zip", arrayBuffer: async () => new ArrayBuffer(4) },
            error: null,
          }),
        }),
      },
    } as unknown as SupabaseClient;

    await expect(
      baixarEAnalisarArquivo(supabase, {
        path: "pasta/nota.zip",
        tipoDocumento: "notas_fiscais",
      }),
    ).rejects.toThrow("Tipo de arquivo nao suportado");
  });
});

describe("registrarAnaliseIa", () => {
  it("grava status concluida quando ha resultado", async () => {
    const insert = vi.fn(() => ({
      select: () => ({
        single: async () => ({
          data: { id: "analise-1", status: "concluida" },
          error: null,
        }),
      }),
    }));
    const supabase = { from: () => ({ insert }) } as unknown as SupabaseClient;

    const analise = await registrarAnaliseIa(supabase, {
      documentoId: "doc-1",
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase(),
    });

    expect(analise.status).toBe("concluida");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ documento_id: "doc-1", status: "concluida" }),
    );
  });

  it("grava status erro quando ha mensagem de erro", async () => {
    const insert = vi.fn(() => ({
      select: () => ({
        single: async () => ({
          data: { id: "analise-2", status: "erro" },
          error: null,
        }),
      }),
    }));
    const supabase = { from: () => ({ insert }) } as unknown as SupabaseClient;

    await registrarAnaliseIa(supabase, {
      documentoId: "doc-1",
      provider: "azure-openai",
      model: "n/a",
      erro: "OCR falhou",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "erro", erro: "OCR falhou" }),
    );
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm run test -- documentAnalysisPipeline`
Expected: FAIL — `baixarEAnalisarArquivo is not a function`.

- [ ] **Step 3: Implementar**

Adicionar ao `src/lib/documentAnalysisPipeline.ts`:

```typescript
import {
  analisarDocumentoComOpenAi,
  type DocumentoAnaliseIa,
} from "@/lib/openAiDocumentAnalysis";

export async function baixarEAnalisarArquivo(
  supabaseAdmin: SupabaseClient,
  params: {
    path: string;
    tipoDocumento: string | null;
    dadosAtuais?: Record<string, unknown> | null;
  },
) {
  const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
    .from("formularios")
    .download(params.path);

  if (downloadError || !fileBlob) {
    throw downloadError ?? new Error("Nao foi possivel baixar o arquivo.");
  }

  const mimeType = resolveMimeType(params.path, fileBlob.type);
  if (
    mimeType !== "application/pdf" &&
    mimeType !== "image/png" &&
    mimeType !== "image/jpeg"
  ) {
    throw new Error(`Tipo de arquivo nao suportado: ${mimeType}.`);
  }

  return analisarDocumentoComOpenAi({
    fileName: resolveFileName(params.path),
    mimeType,
    bytes: await fileBlob.arrayBuffer(),
    dadosAtuais: params.dadosAtuais ?? null,
    tipoDocumento: params.tipoDocumento,
  });
}

export async function registrarAnaliseIa(
  supabaseAdmin: SupabaseClient,
  params: {
    documentoId: string;
    provider: string;
    model: string;
    resultado?: DocumentoAnaliseIa;
    erro?: string;
  },
) {
  const status = params.erro ? "erro" : "concluida";
  const { data, error } = await supabaseAdmin
    .from("documentos_analises_ia")
    .insert({
      documento_id: params.documentoId,
      provider: params.provider,
      model: params.model,
      status,
      resultado: params.resultado ?? {},
      erro: params.erro ?? null,
    })
    .select("id,documento_id,provider,model,status,resultado,erro,created_at")
    .single();

  if (error) {
    throw error;
  }
  return data as {
    id: string;
    documento_id: string;
    provider: string;
    model: string;
    status: string;
    resultado: DocumentoAnaliseIa;
    erro: string | null;
    created_at: string;
  };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm run test -- documentAnalysisPipeline`
Expected: PASS — os 17 testes anteriores mais os 5 novos (3 de `baixarEAnalisarArquivo` + 2 de `registrarAnaliseIa`, 22 no total), nenhuma falha.

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentAnalysisPipeline.ts src/lib/documentAnalysisPipeline.test.ts
git commit -m "feat: adiciona download+analise e gravacao de resultado da IA"
```

---

### Task 5: Pipeline — orquestrador `processarDocumentoComIa`

**Files:**
- Modify: `src/lib/documentAnalysisPipeline.ts`
- Test: `src/lib/documentAnalysisPipeline.test.ts`

**Interfaces:**
- Consumes: `deveAnalisarAutomaticamente`, `verificarDuplicado`, `baixarEAnalisarArquivo`, `registrarAnaliseIa`, `determinarStatusFinal` (Tasks 2–4); `safeParseDados` de `src/lib/documentosApiUtils.ts` (assinatura `(value: unknown) => Record<string, unknown> | null`, já existe).
- Produces: `processarDocumentoComIa(supabaseAdmin: SupabaseClient, documentoId: string): Promise<{ status: string; motivo?: string }>`. Consumida pela Task 6 (rota do webhook).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `src/lib/documentAnalysisPipeline.test.ts`:

```typescript
import { processarDocumentoComIa } from "@/lib/documentAnalysisPipeline";

function criarSupabaseFake(options: {
  registro: Record<string, unknown> | null;
  duplicado?: boolean;
  downloadOk?: boolean;
}) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];

  const supabase = {
    from: (table: string) => {
      if (table === "formularios") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: options.registro, error: null }),
            }),
            // usado por verificarDuplicado: encadeia varios .eq()
            // cada .eq() retorna o mesmo objeto ate .neq().limit().maybeSingle()
          }),
          update: (payload: Record<string, unknown>) => {
            updates.push({ table, payload });
            return { eq: async () => ({ data: null, error: null }) };
          },
        };
      }
      if (table === "documentos_analises_ia") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: "analise-1", status: "concluida" },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Tabela inesperada no teste: ${table}`);
    },
    storage: {
      from: () => ({
        download: async () =>
          options.downloadOk === false
            ? { data: null, error: new Error("falha no download") }
            : {
                data: {
                  type: "application/pdf",
                  arrayBuffer: async () => new ArrayBuffer(4),
                },
                error: null,
              },
      }),
    },
  } as unknown as SupabaseClient;

  return { supabase, updates };
}

describe("processarDocumentoComIa", () => {
  it("ignora tipos fora do escopo automatico", async () => {
    const { supabase, updates } = criarSupabaseFake({
      registro: { id: "doc-1", tipo: "orcamentos_internos", dados: null, arquivo_path: "a.pdf", arquivo_assinado_path: null, prestador_id: null },
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-1");

    expect(resultado.status).toBe("ignorado");
    expect(updates).toHaveLength(0);
  });

  it("marca erro quando o documento nao e encontrado", async () => {
    const { supabase } = criarSupabaseFake({ registro: null });

    const resultado = await processarDocumentoComIa(supabase, "doc-inexistente");

    expect(resultado.status).toBe("erro");
  });

  it("roda a analise e marca concluida para um documento em escopo", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase(),
    });

    const { supabase, updates } = criarSupabaseFake({
      registro: {
        id: "doc-1",
        tipo: "notas_fiscais",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/nota.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
      },
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-1");

    expect(resultado.status).toBe("concluida");
    const statusGravados = updates.map((u) => u.payload.status_analise_ia);
    expect(statusGravados).toEqual(["em_analise", "concluida"]);
  });

  it("marca erro quando a analise por IA falha (ex.: OCR fora do ar)", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockRejectedValueOnce(
      new Error("Document Intelligence indisponivel"),
    );

    const { supabase, updates } = criarSupabaseFake({
      registro: {
        id: "doc-2",
        tipo: "registro_laudos",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/laudo.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
      },
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-2");

    expect(resultado.status).toBe("erro");
    expect(resultado.motivo).toBe("Document Intelligence indisponivel");
    const statusGravados = updates.map((u) => u.payload.status_analise_ia);
    expect(statusGravados).toEqual(["em_analise", "erro"]);
  });
});
```

Nota: como `verificarDuplicado` retorna `false` automaticamente quando falta `prestador_id` (Task 3), o cenário "roda a analise" acima usa `prestador_id: null` de propósito para pular a checagem de duplicidade sem precisar de um fake mais complexo para aquela cadeia de `.eq()`.

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npm run test -- documentAnalysisPipeline`
Expected: FAIL — `processarDocumentoComIa is not a function`.

- [ ] **Step 3: Implementar**

Adicionar ao `src/lib/documentAnalysisPipeline.ts`:

```typescript
import { safeParseDados } from "@/lib/documentosApiUtils";

type FormularioRow = {
  id: string;
  tipo: string;
  dados: Record<string, unknown> | string | null;
  arquivo_path: string | null;
  arquivo_assinado_path: string | null;
  prestador_id: string | null;
};

export async function processarDocumentoComIa(
  supabaseAdmin: SupabaseClient,
  documentoId: string,
): Promise<{ status: string; motivo?: string }> {
  const { data: registro, error: registroError } = await supabaseAdmin
    .from("formularios")
    .select("id,tipo,dados,arquivo_path,arquivo_assinado_path,prestador_id")
    .eq("id", documentoId)
    .maybeSingle();

  if (registroError) {
    throw registroError;
  }
  if (!registro) {
    return { status: "erro", motivo: "Documento nao encontrado." };
  }

  const row = registro as FormularioRow;
  if (!deveAnalisarAutomaticamente(row.tipo)) {
    return { status: "ignorado", motivo: `Tipo ${row.tipo} fora do escopo automatico.` };
  }

  const dados = safeParseDados(row.dados);
  const duplicado = await verificarDuplicado(supabaseAdmin, row.id, {
    tipo: row.tipo,
    prestador_id: row.prestador_id,
    dados,
  });
  if (duplicado) {
    await supabaseAdmin
      .from("formularios")
      .update({ status_analise_ia: "duplicado" })
      .eq("id", row.id);
    return { status: "duplicado" };
  }

  await supabaseAdmin
    .from("formularios")
    .update({ status_analise_ia: "em_analise" })
    .eq("id", row.id);

  const path = row.arquivo_assinado_path ?? row.arquivo_path;
  if (!path) {
    await registrarAnaliseIa(supabaseAdmin, {
      documentoId: row.id,
      provider: "azure-openai",
      model: "n/a",
      erro: "Documento sem arquivo para analise.",
    });
    await supabaseAdmin
      .from("formularios")
      .update({ status_analise_ia: "erro" })
      .eq("id", row.id);
    return { status: "erro", motivo: "Documento sem arquivo." };
  }

  try {
    const { provider, model, resultado } = await baixarEAnalisarArquivo(supabaseAdmin, {
      path,
      tipoDocumento: row.tipo,
      dadosAtuais: dados,
    });

    await registrarAnaliseIa(supabaseAdmin, {
      documentoId: row.id,
      provider,
      model,
      resultado,
    });

    const statusFinal = determinarStatusFinal(resultado);
    await supabaseAdmin
      .from("formularios")
      .update({ status_analise_ia: statusFinal })
      .eq("id", row.id);

    return { status: statusFinal };
  } catch (err) {
    const mensagem =
      err instanceof Error ? err.message : "Falha desconhecida na analise.";
    await registrarAnaliseIa(supabaseAdmin, {
      documentoId: row.id,
      provider: "azure-openai",
      model: "n/a",
      erro: mensagem,
    });
    await supabaseAdmin
      .from("formularios")
      .update({ status_analise_ia: "erro" })
      .eq("id", row.id);
    return { status: "erro", motivo: mensagem };
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm run test -- documentAnalysisPipeline`
Expected: PASS — os 22 testes anteriores mais os 4 novos de `processarDocumentoComIa` (26 no total), nenhuma falha.

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentAnalysisPipeline.ts src/lib/documentAnalysisPipeline.test.ts
git commit -m "feat: adiciona orquestrador processarDocumentoComIa"
```

---

### Task 6: Rota do webhook — `POST /api/documentos/ia/processar`

**Files:**
- Create: `src/app/api/documentos/ia/processar/route.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `processarDocumentoComIa`, `verificarSegredoWebhook` (Tasks 2 e 5); `createSupabaseAdminClient` (já existe).
- Produces: rota HTTP `POST /api/documentos/ia/processar`, consumida pelo webhook configurado na Task 7.

- [ ] **Step 1: Adicionar a variável de ambiente**

Em `.env.example`, logo abaixo do bloco "Azure Document Intelligence":

```
# Segredo do Database Webhook que dispara a analise automatica por IA
# (Supabase -> Database -> Webhooks -> header Authorization: Bearer <valor>)
DOCUMENTOS_IA_WEBHOOK_SECRET=
```

- [ ] **Step 2: Implementar a rota**

```typescript
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  processarDocumentoComIa,
  verificarSegredoWebhook,
} from "@/lib/documentAnalysisPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WebhookPayload = {
  type?: string;
  table?: string;
  record?: { id?: string };
};

export async function POST(request: Request) {
  const autorizado = verificarSegredoWebhook(
    request.headers.get("authorization"),
    process.env.DOCUMENTOS_IA_WEBHOOK_SECRET,
  );
  if (!autorizado) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  try {
    const payload = (await request.json().catch(() => null)) as WebhookPayload | null;
    const documentoId = payload?.record?.id;
    if (!documentoId) {
      return NextResponse.json(
        { error: "Payload sem id do documento." },
        { status: 400 },
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const resultado = await processarDocumentoComIa(supabaseAdmin, documentoId);

    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    console.error("[documentos/ia/processar] Erro:", err);
    const message =
      err instanceof Error ? err.message : "Erro ao processar documento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verificar manualmente a rejeição sem segredo**

Com o servidor local rodando (`npm run dev`) e `DOCUMENTOS_IA_WEBHOOK_SECRET` configurado no `.env.local`:

```bash
curl -i -X POST http://localhost:3000/api/documentos/ia/processar \
  -H "Content-Type: application/json" \
  -d '{"record":{"id":"qualquer"}}'
```

Expected: `HTTP/1.1 401` com corpo `{"error":"Nao autorizado."}`.

- [ ] **Step 4: Verificar manualmente a aceitação com segredo correto**

```bash
curl -i -X POST http://localhost:3000/api/documentos/ia/processar \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <valor de DOCUMENTOS_IA_WEBHOOK_SECRET>" \
  -d '{"record":{"id":"<id de um formulario existente, tipo notas_fiscais>"}}'
```

Expected: `HTTP/1.1 200` com `{"ok":true,"resultado":{"status":"concluida"|"necessita_revisao"|"erro"|"duplicado"}}`. Confirme no Supabase (`documentos_analises_ia` e `formularios.status_analise_ia`) que os dados batem com a resposta.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/documentos/ia/processar/route.ts .env.example
git commit -m "feat: adiciona rota do webhook de analise automatica"
```

---

### Task 7: Configurar o Database Webhook no Supabase

**Files:**
- Nenhum arquivo de código — configuração de infraestrutura no painel do Supabase.

**Interfaces:**
- Consumes: rota `POST /api/documentos/ia/processar` (Task 6).
- Produces: disparo automático em produção. Nenhuma task de código depende disso, mas é obrigatório para o pipeline funcionar fora dos testes manuais com curl.

- [ ] **Step 1: Gerar e guardar o segredo**

Gere um valor aleatório (ex.: `openssl rand -hex 32`) e configure como `DOCUMENTOS_IA_WEBHOOK_SECRET` nas variáveis de ambiente do Azure App Service (mesmo lugar onde `AZURE_OPENAI_API_KEY` etc. já estão configuradas).

- [ ] **Step 2: Criar o webhook no painel do Supabase**

No projeto `formulario central` (`tqzvgqauvbknwdvbtvfr`): Database → Webhooks → Create a new hook.
- Name: `documentos_analise_ia_automatica`
- Table: `public.formularios`
- Events: apenas `Insert`
- Type: `HTTP Request`
- Method: `POST`
- URL: `https://<dominio-de-producao>/api/documentos/ia/processar`
- Headers: `Authorization: Bearer <mesmo valor de DOCUMENTOS_IA_WEBHOOK_SECRET>`, `Content-Type: application/json`
- Timeout: aumentar para 15000ms (o padrão de 5000ms pode ser curto para o OCR + IA; a rota do webhook não fica bloqueando o insert do lado do Postgres — o `pg_net` usado pelo Supabase é assíncrono).

Isso instala automaticamente a extensão `pg_net` (hoje disponível mas não instalada no projeto) e cria o trigger `AFTER INSERT` necessário.

- [ ] **Step 3: Verificar end-to-end**

Envie um documento de teste pelo formulário público (tipo Notas Fiscais, por exemplo). Em até ~1 minuto, confira:
- `formularios.status_analise_ia` do novo registro mudou de `recebido` para `concluida` (ou `necessita_revisao`/`erro`/`duplicado`).
- Uma linha nova em `documentos_analises_ia` com `documento_id` correspondente.
- No painel do Supabase, Database → Webhooks → Logs, confirme que a chamada retornou 200.

- [ ] **Step 4: Registrar a configuração**

Não há commit de código nesta task. Anote no canal/documentação interna da equipe (fora deste repositório) o nome do webhook e onde o segredo está guardado, para que outra pessoa consiga recriar em caso de necessidade.

---

### Task 8: Refatorar a rota manual `/api/documentos/[id]/analisar`

**Files:**
- Modify: `src/app/api/documentos/[id]/analisar/route.ts`

**Interfaces:**
- Consumes: `baixarEAnalisarArquivo`, `registrarAnaliseIa` (Task 4).
- Produces: mesma resposta HTTP de hoje (`{ analise }`), sem mudança de contrato para o front-end — essa rota vira o botão de "reprocessar" usado quando o status é `erro` ou `necessita_revisao` (ligado na Task 10).

- [ ] **Step 1: Substituir a lógica duplicada**

Trocar o corpo da rota para usar as funções compartilhadas em vez de chamar `analisarDocumentoComOpenAi` e montar o insert manualmente. Ficam removidas as funções locais `resolveMimeType`/`resolveFileName` (agora vêm de `documentAnalysisPipeline.ts`).

```typescript
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { safeParseDados, sanitizeId } from "@/lib/documentosApiUtils";
import {
  ApiHttpError as HttpError,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";
import {
  baixarEAnalisarArquivo,
  registrarAnaliseIa,
} from "@/lib/documentAnalysisPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FormularioRow = {
  id: string;
  tipo: string;
  dados: Record<string, unknown> | string | null;
  arquivo_path: string | null;
  arquivo_assinado_path: string | null;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();
    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);

    if (!canAccess) {
      throw new HttpError(403, "Apenas administradores podem analisar documentos por IA.");
    }

    const { id: rawId } = await context.params;
    const id = sanitizeId(rawId ?? "");
    if (!id) {
      throw new HttpError(400, "Informe um documento valido.");
    }

    const { data: registro, error: registroError } = await supabaseAdmin
      .from("formularios")
      .select("id,tipo,dados,arquivo_path,arquivo_assinado_path")
      .eq("id", id)
      .maybeSingle();

    if (registroError) {
      throw registroError;
    }
    if (!registro) {
      throw new HttpError(404, "Documento nao encontrado.");
    }

    const row = registro as FormularioRow;
    const path = row.arquivo_assinado_path ?? row.arquivo_path;
    if (!path) {
      throw new HttpError(400, "Documento sem arquivo para analise.");
    }

    const { provider, model, resultado } = await baixarEAnalisarArquivo(supabaseAdmin, {
      path,
      tipoDocumento: row.tipo,
      dadosAtuais: safeParseDados(row.dados),
    });

    const analise = await registrarAnaliseIa(supabaseAdmin, {
      documentoId: row.id,
      provider,
      model,
      resultado,
    });

    await supabaseAdmin
      .from("formularios")
      .update({ status_analise_ia: "concluida" })
      .eq("id", row.id);

    return NextResponse.json({ analise });
  } catch (err) {
    console.error("[documentos/analisar] Erro:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel analisar o documento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Rodar a suíte completa de testes**

Run: `npm run test`
Expected: PASS — nenhum teste existente quebrou (essa rota não tinha teste próprio; a verificação é que os testes de `documentAnalysisPipeline` continuam passando e o build não quebra).

- [ ] **Step 3: Rodar o typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros.

- [ ] **Step 4: Verificar manualmente**

No `DocumentDetailsDrawer` (antes da Task 10 trocar o botão), clique em "Analisar com IA" num documento existente e confirme que o comportamento é igual ao de antes da refatoração.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/documentos/[id]/analisar/route.ts
git commit -m "refactor: reusa pipeline compartilhado na rota manual de analise"
```

---

### Task 9: Refatorar a rota `/api/orcamentos-internos/[id]/analisar`

**Files:**
- Modify: `src/app/api/orcamentos-internos/[id]/analisar/route.ts`

**Interfaces:**
- Consumes: `baixarEAnalisarArquivo`, `registrarAnaliseIa` (Task 4).
- Produces: mesma resposta HTTP de hoje (`{ sugestao, resultado, provider, model }`) — comportamento observável pelo usuário não muda (spec: orçamentos internos mantém o fluxo atual).

- [ ] **Step 1: Substituir só a parte de download+analise+gravação**

Trocar as chamadas diretas a `analisarDocumentoComOpenAi` e ao insert manual em `documentos_analises_ia` pelas funções compartilhadas, mantendo toda a lógica de `sugestao` (match de prestador por CNPJ/nome) exatamente como está:

```typescript
import {
  baixarEAnalisarArquivo,
  registrarAnaliseIa,
} from "@/lib/documentAnalysisPipeline";
```

Substituir o bloco atual:

```typescript
    const { provider, model, resultado } = await analisarDocumentoComOpenAi({
      fileName: path.split("/").pop() || "orcamento.pdf",
      mimeType: "application/pdf",
      bytes: await fileBlob.arrayBuffer(),
      tipoDocumento: "orcamentos",
      dadosAtuais: { ... },
    });
```

por:

```typescript
    const { provider, model, resultado } = await baixarEAnalisarArquivo(supabaseAdmin, {
      path,
      tipoDocumento: "orcamentos",
      dadosAtuais: {
        prestador: orcamento.prestador_nome,
        fornecedor_cnpj: orcamento.fornecedor_cnpj,
        numero_orcamento: orcamento.numero_orcamento,
        valor: orcamento.valor_total,
        data_validade: orcamento.data_validade,
        descricao: orcamento.descricao,
      },
    });
```

**Manter** a checagem manual de `.pdf` que já existe antes desse trecho (`if (!path.toLowerCase().endsWith(".pdf")) { throw new HttpError(400, "A análise automática aceita apenas PDF."); }`) — não removê-la. Ela é o que garante o `400` com mensagem amigável para arquivo não-PDF; `baixarEAnalisarArquivo` também valida o mime type, mas lança um `Error` genérico (sem `status`), que cairia no `catch` como `500` em vez de `400` se a checagem manual fosse removida. Isso mudaria o código de status HTTP hoje observado pelo front-end — mantendo a checagem manual, esse comportamento não muda. Só o download manual do storage (`supabaseAdmin.storage.from("formularios").download(path)`) é removido, pois `baixarEAnalisarArquivo` já cuida disso.

Substituir o bloco atual:

```typescript
    const { error: insertError } = await supabaseAdmin
      .from("documentos_analises_ia")
      .insert({
        documento_id: id,
        provider,
        model,
        status: "concluida",
        resultado,
      });
    if (insertError) throw insertError;
```

por:

```typescript
    await registrarAnaliseIa(supabaseAdmin, {
      documentoId: id,
      provider,
      model,
      resultado,
    });
```

Remover o import não usado de `analisarDocumentoComOpenAi` e o bloco de download manual do storage (`supabaseAdmin.storage.from("formularios").download(path)`), já que `baixarEAnalisarArquivo` cuida disso.

- [ ] **Step 2: Rodar a suíte completa de testes**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 3: Rodar o typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erros.

- [ ] **Step 4: Verificar manualmente**

Na tela de Orçamentos Internos, anexe um PDF e confirme que os campos continuam sendo sugeridos automaticamente como antes (prestador, valor, data de validade).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/orcamentos-internos/[id]/analisar/route.ts
git commit -m "refactor: reusa pipeline compartilhado na analise de orcamentos internos"
```

---

### Task 10: UI — badge de status no lugar do botão manual

**Files:**
- Modify: `src/app/api/documentos/[id]/route.ts`
- Modify: `src/app/documentos/_components/DocumentDetailsDrawer.tsx`

**Interfaces:**
- Consumes: `status_analise_ia` retornado pela rota de detalhes do documento.
- Produces: nenhuma interface nova consumida por outras tasks — é a ponta final da cadeia.

- [ ] **Step 1: Incluir a coluna no select da rota de detalhes**

Em `src/app/api/documentos/[id]/route.ts`, linha do `.select(...)` da query de `formularios` (hoje `"id,tipo,status,arquivo_path,arquivo_assinado_path,created_at,dados,assinado_por,user_id,prestador_id"`), adicionar `status_analise_ia`:

```typescript
    .select(
      "id,tipo,status,status_analise_ia,arquivo_path,arquivo_assinado_path,created_at,dados,assinado_por,user_id,prestador_id",
    )
```

- [ ] **Step 2: Adicionar o campo ao tipo do registro**

Em `src/app/documentos/_components/DocumentDetailsDrawer.tsx`, no tipo `DrawerFormularioRecord` (linha ~21):

```typescript
export type DrawerFormularioRecord = {
  id: string;
  tipo: string;
  status: string;
  status_analise_ia?: string | null;
  arquivo_path: string;
  arquivo_assinado_path?: string | null;
  created_at: string;
  dados: Record<string, unknown> | null;
  assinado_por?: string | null;
  prestador_id?: string | null;
  user_id?: string | null;
  nome_arquivo?: string | null;
};
```

- [ ] **Step 3: Adicionar os rótulos do badge**

Perto do `statusLabel` existente (linha ~134):

```typescript
const statusAnaliseIaLabel: Record<string, { texto: string; classe: string }> = {
  recebido: { texto: "Aguardando análise", classe: "bg-slate-100 text-slate-700" },
  aguardando_analise: { texto: "Aguardando análise", classe: "bg-slate-100 text-slate-700" },
  em_analise: { texto: "Em análise pela IA", classe: "bg-blue-100 text-blue-700" },
  concluida: { texto: "Análise concluída", classe: "bg-green-100 text-green-700" },
  necessita_revisao: { texto: "Necessita revisão", classe: "bg-amber-100 text-amber-700" },
  erro: { texto: "Erro na leitura", classe: "bg-red-100 text-red-700" },
  duplicado: { texto: "Documento duplicado", classe: "bg-purple-100 text-purple-700" },
};
```

- [ ] **Step 4: Trocar o botão pelo badge + botão de reprocessar condicional**

Localizar o bloco em torno da linha 699-710 (`Analise por IA` / botão "Analisar com IA") e substituir por:

```tsx
<div className="flex items-center gap-2">
  {(() => {
    const statusInfo =
      statusAnaliseIaLabel[registro?.status_analise_ia ?? "recebido"] ??
      statusAnaliseIaLabel.recebido;
    return (
      <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusInfo.classe}`}>
        {statusInfo.texto}
      </span>
    );
  })()}
  {(registro?.status_analise_ia === "erro" ||
    registro?.status_analise_ia === "necessita_revisao") && (
    <button
      type="button"
      onClick={() => void analisarComIa()}
      disabled={analyzing}
      className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
    >
      {analyzing ? "Reprocessando..." : "Reprocessar com IA"}
    </button>
  )}
</div>
```

Manter a função `analisarComIa` existente (linha ~538) sem mudanças — ela já chama `/api/documentos/${registro.id}/analisar`, que continua funcionando após a Task 8.

- [ ] **Step 5: Rodar o typecheck e o lint**

Run: `npx tsc --noEmit -p .`
Expected: sem erros.

Run: `npx eslint src/app/api/documentos/[id]/route.ts src/app/documentos/_components/DocumentDetailsDrawer.tsx`
Expected: sem erros.

- [ ] **Step 6: Verificar manualmente**

Abra um documento com `status_analise_ia = 'concluida'` (a maioria dos 42 já existentes, que continuam sem essa coluna preenchida até rodar a migration — nesse caso o default `'recebido'` aparece) e um documento cujo status force `erro`/`necessita_revisao` manualmente via SQL, para conferir que o botão de reprocessar aparece só nesses dois casos.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/documentos/[id]/route.ts src/app/documentos/_components/DocumentDetailsDrawer.tsx
git commit -m "feat: badge de status da analise por IA no lugar do botao manual"
```
