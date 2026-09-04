# Busca Semântica — Fase 3: Busca Híbrida e Resposta

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar o assistente a encontrar documentos pelo conteúdo via busca híbrida (similaridade vetorial + full-text), com interpretação da pergunta por LLM, fusão RRF e respostas estruturadas com citação de fontes.

**Architecture:** Dois estágios — (1) TypeScript constrói um allowlist de documentos autorizados usando `buildDocumentosAccessOr` existente; (2) RPC PostgreSQL executa busca vetorial + FTS com fusão RRF dentro desse allowlist. LLM interpreta a pergunta em filtros antes da busca e rerankeia os top 20 resultados depois.

**Tech Stack:** pgvector (cosine ops), PostgreSQL FTS (`tsvector`, `websearch_to_tsquery`), Azure OpenAI embeddings, Azure OpenAI chat (extração JSON), Supabase RPC, vitest

**Spec:** docs/superpowers/specs/2026-09-02-busca-semantica-documentos-design.md (seção "Fase 3")

## Global Constraints

- `buildDocumentosAccessOr` (retorna `string[]` de filtros PostgREST) governa TODO acesso a documentos — jamais reimplementar em SQL nem bypassar
- A RPC opera exclusivamente dentro do allowlist recebido — não decide permissão, não enxerga nada fora da lista
- A nova tool `buscar_documentos_conteudo` e a existente `buscar_documentos` coexistem; nenhuma substitui a outra
- TypeScript strict; sem `any`; nunca engolir erros Supabase (`{ error }` → throw)
- `RECORTE_MAX_DOCUMENTOS = 2000` — se excedido, setar `recorteExcedido: true` e informar; NUNCA truncar silenciosamente
- Mudanças em `AssistenteResultItem` e no tipo de resposta do domínio são aditivas (campos opcionais) — respostas da tool existente não mudam
- Confiança derivada de sinais objetivos (scores, filtros resolvidos), não de opinião do modelo

---

### Task 1: SQL RPC `buscar_chunks_hibrido`

**Files:**
- Create: `supabase/migrations/202609021300_busca_hibrida_rpc.sql`

**Interfaces:**
- Produces (assinatura usada no TypeScript da Task 3):
```sql
buscar_chunks_hibrido(
  p_documento_ids uuid[],
  p_embedding extensions.vector(1536),
  p_consulta_texto text,
  p_limite int default 20
) returns table (
  documento_id uuid,
  rrf_score float8,
  melhor_trecho text,
  pagina integer,
  n_trechos_relevantes integer
)
```

- [ ] **Step 1: Escrever a migração SQL**

```sql
-- supabase/migrations/202609021300_busca_hibrida_rpc.sql
-- Fase 3: RPC de busca hibrida com fusao RRF (Reciprocal Rank Fusion).
-- Recebe um allowlist de documento_ids ja autorizado pela camada TypeScript
-- (buildDocumentosAccessOr). NAO decide permissao — nao enxerga nada fora do allowlist.

create or replace function public.buscar_chunks_hibrido(
  p_documento_ids uuid[],
  p_embedding extensions.vector(1536),
  p_consulta_texto text,
  p_limite int default 20
) returns table (
  documento_id uuid,
  rrf_score float8,
  melhor_trecho text,
  pagina integer,
  n_trechos_relevantes integer
)
language sql
security definer
set search_path = public, extensions
as $$
  with
    -- Apenas chunks dentro do allowlist com embedding preenchido
    chunks_no_escopo as (
      select
        c.id,
        c.documento_id,
        c.texto,
        c.pagina,
        c.embedding,
        c.texto_tsv
      from public.documento_chunks c
      where c.documento_id = any(p_documento_ids)
        and c.embedding is not null
    ),
    -- Ranking vetorial: todos os chunks, ordenados por distancia de cosseno
    rank_vector as (
      select
        id,
        row_number() over (order by embedding <=> p_embedding) as rank_v
      from chunks_no_escopo
    ),
    -- Ranking textual: apenas chunks que casam com a query FTS
    tsq as (
      select websearch_to_tsquery('portuguese', p_consulta_texto) as q
    ),
    rank_texto as (
      select
        c.id,
        row_number() over (
          order by ts_rank_cd(c.texto_tsv, tsq.q) desc
        ) as rank_t
      from chunks_no_escopo c
      cross join tsq
      where c.texto_tsv @@ tsq.q
    ),
    -- Fusao RRF: score = 1/(60+rank_v) + 1/(60+rank_t)
    -- Chunks sem match FTS recebem rank_t = 1000 (contribuicao quase nula)
    fusao as (
      select
        c.documento_id,
        c.texto,
        c.pagina,
        1.0 / (60.0 + rv.rank_v) +
        1.0 / (60.0 + coalesce(rt.rank_t, 1000)) as rrf_chunk_score
      from chunks_no_escopo c
      join rank_vector rv on rv.id = c.id
      left join rank_texto rt on rt.id = c.id
    ),
    -- Agregacao por documento: melhor trecho + contagem de trechos relevantes
    por_documento as (
      select
        f.documento_id,
        max(f.rrf_chunk_score) as rrf_score,
        (array_agg(f.texto order by f.rrf_chunk_score desc))[1] as melhor_trecho,
        (array_agg(f.pagina order by f.rrf_chunk_score desc))[1] as pagina,
        count(*)::integer as n_trechos_relevantes
      from fusao f
      group by f.documento_id
    )
  select
    pd.documento_id,
    pd.rrf_score,
    pd.melhor_trecho,
    pd.pagina::integer,
    pd.n_trechos_relevantes
  from por_documento pd
  order by pd.rrf_score desc
  limit p_limite;
$$;

-- Bloquear acesso direto — toda chamada passa pelo supabaseAdmin na camada de API
revoke all on function public.buscar_chunks_hibrido(uuid[], extensions.vector, text, int)
  from public, anon, authenticated;
```

- [ ] **Step 2: Verificar**

Esta task produz apenas DDL. Não há vitest para este step — a verificação funcional acontece na Task 3 quando o TypeScript chama a RPC. Registre no relatório que a migração está pronta para aplicar via MCP.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202609021300_busca_hibrida_rpc.sql
git commit -m "feat: adiciona rpc buscar_chunks_hibrido com fusao rrf"
```

---

### Task 2: `documentosInterpretacao.ts` — interpretação da consulta

**Files:**
- Create: `src/lib/documentosInterpretacao.ts`
- Create: `src/lib/documentosInterpretacao.test.ts`

**Interfaces:**
- Consumes: função de chat Azure OpenAI de `@/lib/azureOpenAi` (leia o arquivo antes de implementar para pegar o nome e assinatura exatos)
- Produces:
```ts
export type ConsultaInterpretada = {
  consultaSemantica: string;
  tipo?: string;           // 'registro_laudos' | 'notas_fiscais' | ...
  assunto?: string;        // termo canônico da taxonomia, ex: 'gerador'
  lojaTermo?: string;      // texto livre, resolvido para ID na Task 3
  equipamentoTermo?: string;
  ano?: string;
  mes?: string;            // '01'..'12'
  ordenar: "relevancia" | "mais_recente";
};

export async function interpretarConsulta(
  pergunta: string,
  termosDisponiveis: string[],
): Promise<ConsultaInterpretada>
```

- [ ] **Step 1: Ler `src/lib/azureOpenAi.ts`**

Identifique: nome da função de chat, tipo dos parâmetros (messages, opcoes), como ativar JSON mode. Anote antes de escrever o código.

- [ ] **Step 2: Escrever os testes (falhando)**

```ts
// src/lib/documentosInterpretacao.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { interpretarConsulta } from "@/lib/documentosInterpretacao";

// Substitua "chamarAzureOpenAi" pelo nome real encontrado em azureOpenAi.ts
vi.mock("@/lib/azureOpenAi", () => ({
  chamarAzureOpenAi: vi.fn(),
}));
import { chamarAzureOpenAi } from "@/lib/azureOpenAi";

const TERMOS = ["gerador", "ar condicionado", "elevador", "extintor", "subestacao"];

describe("interpretarConsulta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("extrai tipo e assunto de uma pergunta objetiva", async () => {
    vi.mocked(chamarAzureOpenAi).mockResolvedValueOnce(
      JSON.stringify({
        consultaSemantica: "laudo grupo gerador Matriz",
        tipo: "registro_laudos",
        assunto: "gerador",
        lojaTermo: "Matriz",
        ordenar: "relevancia",
      })
    );
    const result = await interpretarConsulta(
      "qual é o laudo do gerador da Matriz?",
      TERMOS
    );
    expect(result.tipo).toBe("registro_laudos");
    expect(result.assunto).toBe("gerador");
    expect(result.lojaTermo).toBe("Matriz");
    expect(result.ordenar).toBe("relevancia");
    expect(result.consultaSemantica).toBeTruthy();
  });

  it("nao define filtro de assunto quando o termo nao esta na taxonomia", async () => {
    vi.mocked(chamarAzureOpenAi).mockResolvedValueOnce(
      JSON.stringify({
        consultaSemantica: "problemas com o telhado loja Norte",
        lojaTermo: "Norte",
        ordenar: "relevancia",
      })
    );
    const result = await interpretarConsulta(
      "tem algum problema no telhado da loja Norte?",
      TERMOS
    );
    expect(result.assunto).toBeUndefined();
    expect(result.consultaSemantica).toBeTruthy();
  });

  it("define ordenar mais_recente para perguntas de listagem", async () => {
    vi.mocked(chamarAzureOpenAi).mockResolvedValueOnce(
      JSON.stringify({
        consultaSemantica: "notas fiscais marco 2026",
        tipo: "notas_fiscais",
        mes: "03",
        ano: "2026",
        ordenar: "mais_recente",
      })
    );
    const result = await interpretarConsulta("me lista as notas fiscais de março", TERMOS);
    expect(result.tipo).toBe("notas_fiscais");
    expect(result.mes).toBe("03");
    expect(result.ordenar).toBe("mais_recente");
  });

  it("usa relevancia como padrao quando ordenar esta ausente na resposta do LLM", async () => {
    vi.mocked(chamarAzureOpenAi).mockResolvedValueOnce(
      JSON.stringify({ consultaSemantica: "alguma coisa" })
    );
    const result = await interpretarConsulta("alguma coisa", TERMOS);
    expect(result.ordenar).toBe("relevancia");
  });

  it("retorna consulta original quando LLM devolve JSON invalido", async () => {
    vi.mocked(chamarAzureOpenAi).mockResolvedValueOnce("nao e json");
    const result = await interpretarConsulta("minha pergunta", TERMOS);
    expect(result.consultaSemantica).toBe("minha pergunta");
    expect(result.ordenar).toBe("relevancia");
  });
});
```

- [ ] **Step 3: Rodar testes — confirmar que falham**

```bash
npx vitest run src/lib/documentosInterpretacao.test.ts
```
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar `documentosInterpretacao.ts`**

```ts
// src/lib/documentosInterpretacao.ts
// IMPORTANTE: adapte o import e a chamada de chamarAzureOpenAi ao nome/API
// reais encontrados em src/lib/azureOpenAi.ts (Step 1).
import { chamarAzureOpenAi } from "@/lib/azureOpenAi";

export type ConsultaInterpretada = {
  consultaSemantica: string;
  tipo?: string;
  assunto?: string;
  lojaTermo?: string;
  equipamentoTermo?: string;
  ano?: string;
  mes?: string;
  ordenar: "relevancia" | "mais_recente";
};

function promptSistema(termosDisponiveis: string[]): string {
  return `Você é um extrator de filtros para busca de documentos de manutenção predial.

Analise a pergunta e extraia em JSON (sem markdown):
{
  "consultaSemantica": "<texto para busca semântica — capture a intenção completa>",
  "tipo": "<APENAS se tiver certeza: registro_laudos | notas_fiscais | ordens_servico — omitir se incerto>",
  "assunto": "<APENAS se for exatamente um destes termos: ${termosDisponiveis.join(" | ")} — omitir se nao tiver certeza>",
  "lojaTermo": "<nome ou apelido da loja se mencionado — omitir se incerto>",
  "equipamentoTermo": "<identificacao do equipamento se mencionado — omitir se incerto>",
  "ano": "<4 digitos — omitir se nao explicitado>",
  "mes": "<2 digitos 01-12 — omitir se nao explicitado>",
  "ordenar": "relevancia" | "mais_recente"
}

Regra critica: nao invente filtros. Um filtro errado zera os resultados.
Se nao tiver certeza, omita o campo e inclua o conceito em consultaSemantica.
Use "mais_recente" apenas para perguntas de listagem ("liste os últimos", "mostre todos de março").
Responda SOMENTE o JSON.`;
}

export async function interpretarConsulta(
  pergunta: string,
  termosDisponiveis: string[],
): Promise<ConsultaInterpretada> {
  let resposta: string;
  try {
    // Adapte os parâmetros ao formato real de chamarAzureOpenAi
    resposta = await chamarAzureOpenAi(
      [
        { role: "system" as const, content: promptSistema(termosDisponiveis) },
        { role: "user" as const, content: pergunta },
      ],
      { responseFormat: "json_object" } // adaptar se o parâmetro tiver nome diferente
    );
  } catch {
    return { consultaSemantica: pergunta, ordenar: "relevancia" };
  }

  let parsed: Partial<ConsultaInterpretada> = {};
  try {
    parsed = JSON.parse(resposta) as Partial<ConsultaInterpretada>;
  } catch {
    parsed = {};
  }

  return {
    consultaSemantica: parsed.consultaSemantica?.trim() || pergunta,
    tipo: parsed.tipo,
    assunto: parsed.assunto,
    lojaTermo: parsed.lojaTermo,
    equipamentoTermo: parsed.equipamentoTermo,
    ano: parsed.ano,
    mes: parsed.mes,
    ordenar: parsed.ordenar === "mais_recente" ? "mais_recente" : "relevancia",
  };
}
```

- [ ] **Step 5: Rodar testes — confirmar que passam**

```bash
npx vitest run src/lib/documentosInterpretacao.test.ts
```
Expected: 5/5 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/documentosInterpretacao.ts src/lib/documentosInterpretacao.test.ts
git commit -m "feat: adiciona interpretacao de consulta para busca semantica"
```

---

### Task 3: `documentosRecuperacao.ts` — recuperação em dois estágios + reranking

**Files:**
- Create: `src/lib/documentosRecuperacao.ts`
- Create: `src/lib/documentosRecuperacao.test.ts`

**Interfaces:**
- Consumes:
  - `ConsultaInterpretada` de `@/lib/documentosInterpretacao`
  - `buildDocumentosAccessOr` de `@/lib/documentosAccessFilters` (leia o arquivo para confirmar a shape de `BuildAccessOrInput`)
  - `gerarEmbeddings` de `@/lib/embeddings`
  - `chamarAzureOpenAi` de `@/lib/azureOpenAi`
  - RPC `buscar_chunks_hibrido` via `supabaseAdmin.rpc()`
- Produces:
```ts
export const RECORTE_MAX_DOCUMENTOS = 2000;

export type DocumentoBuscado = {
  documentoId: string;
  rrfScore: number;
  trecho: string;
  pagina?: number | null;
  nTrechosRelevantes: number;
  justificativa?: string;
};

export type ResultadoBuscaConteudo = {
  documentos: DocumentoBuscado[];
  confianca: "alta" | "media" | "baixa";
  sugestaoRefinamento?: string;
  recorteExcedido: boolean;
  filtrosAplicados: Record<string, string>;
};

export type BuscaConteudoParams = {
  consulta: ConsultaInterpretada;
  lojaId?: string;
  equipamentoId?: string;
  userId: string;
  allowedPrestadores: string[];
  gerenteEntries: Array<{ lojaId: string; prestadorId?: string }>;
  canAccess: boolean;
};

export async function buscarDocumentosConteudo(
  params: BuscaConteudoParams,
  supabaseAdmin: SupabaseClient,
  perguntaOriginal: string,
): Promise<ResultadoBuscaConteudo>
```

- [ ] **Step 1: Ler `src/lib/documentosAccessFilters.ts`**

Confirme o nome exato dos campos de `BuildAccessOrInput` antes de implementar `construirAllowlist`.

- [ ] **Step 2: Escrever os testes (falhando)**

```ts
// src/lib/documentosRecuperacao.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buscarDocumentosConteudo, RECORTE_MAX_DOCUMENTOS } from "@/lib/documentosRecuperacao";
import type { ConsultaInterpretada } from "@/lib/documentosInterpretacao";

vi.mock("@/lib/embeddings", () => ({
  gerarEmbeddings: vi.fn(async () => [Array(1536).fill(0.01)]),
}));
vi.mock("@/lib/azureOpenAi", () => ({
  chamarAzureOpenAi: vi.fn(async () =>
    JSON.stringify([
      { documentoId: "doc-1", justificativa: "Laudo direto sobre o gerador" },
    ])
  ),
}));

const consultaBase: ConsultaInterpretada = {
  consultaSemantica: "laudo do gerador",
  tipo: "registro_laudos",
  assunto: "gerador",
  ordenar: "relevancia",
};

const paramsBase = {
  consulta: consultaBase,
  userId: "user-1",
  allowedPrestadores: [],
  gerenteEntries: [],
  canAccess: true,
};

function makeSupabase(docIds: string[], rpcRows: Record<string, unknown>[]) {
  const chainFake: Record<string, unknown> = {};
  const self = () => chainFake;
  chainFake.select = self;
  chainFake.eq = self;
  chainFake.filter = self;
  chainFake.or = self;
  chainFake.limit = self;
  chainFake.in = self;
  chainFake.then = (resolve: (v: {data: {id:string}[]; error: null}) => void) =>
    resolve({ data: docIds.map((id) => ({ id })), error: null });

  return {
    from: () => chainFake,
    rpc: vi.fn(async () => ({ data: rpcRows, error: null })),
  };
}

describe("buscarDocumentosConteudo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("chama rpc com p_documento_ids correto e retorna documentos ranqueados", async () => {
    const supabase = makeSupabase(
      ["doc-1", "doc-2"],
      [
        {
          documento_id: "doc-1",
          rrf_score: 0.05,
          melhor_trecho: "laudo do grupo gerador da Matriz",
          pagina: 3,
          n_trechos_relevantes: 2,
        },
      ]
    );

    const resultado = await buscarDocumentosConteudo(
      paramsBase,
      supabase as never,
      "laudo do gerador da Matriz"
    );

    expect(supabase.rpc).toHaveBeenCalledWith(
      "buscar_chunks_hibrido",
      expect.objectContaining({ p_documento_ids: ["doc-1", "doc-2"] })
    );
    expect(resultado.documentos).toHaveLength(1);
    expect(resultado.documentos[0].documentoId).toBe("doc-1");
    expect(resultado.recorteExcedido).toBe(false);
  });

  it("sinaliza recorteExcedido quando o allowlist ultrapassa o teto", async () => {
    const manyIds = Array.from({ length: RECORTE_MAX_DOCUMENTOS + 1 }, (_, i) => `doc-${i}`);
    const supabase = makeSupabase(manyIds, []);

    const resultado = await buscarDocumentosConteudo(
      { ...paramsBase, consulta: { ...consultaBase, tipo: undefined } },
      supabase as never,
      "algo"
    );

    expect(resultado.recorteExcedido).toBe(true);
    expect(resultado.confianca).toBe("baixa");
    expect(resultado.sugestaoRefinamento).toBeTruthy();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("retorna confianca baixa e lista vazia quando nenhum chunk encontrado", async () => {
    const supabase = makeSupabase(["doc-1"], []);

    const resultado = await buscarDocumentosConteudo(
      paramsBase,
      supabase as never,
      "nada"
    );

    expect(resultado.documentos).toHaveLength(0);
    expect(resultado.confianca).toBe("baixa");
  });

  it("lanca erro quando a rpc retorna error", async () => {
    const chainFake: Record<string, unknown> = {};
    const self = () => chainFake;
    chainFake.select = self; chainFake.eq = self; chainFake.filter = self;
    chainFake.or = self; chainFake.limit = self; chainFake.in = self;
    chainFake.then = (resolve: (v: {data: {id:string}[]; error: null}) => void) =>
      resolve({ data: [{ id: "doc-1" }], error: null });

    const supabase = {
      from: () => chainFake,
      rpc: vi.fn(async () => ({ data: null, error: new Error("pgvector offline") })),
    };

    await expect(
      buscarDocumentosConteudo(paramsBase, supabase as never, "teste")
    ).rejects.toThrow("pgvector offline");
  });

  it("define confianca alta quando melhor resultado se destaca claramente", async () => {
    const supabase = makeSupabase(
      ["doc-1", "doc-2"],
      [
        { documento_id: "doc-1", rrf_score: 0.09, melhor_trecho: "trecho 1", pagina: 1, n_trechos_relevantes: 3 },
        { documento_id: "doc-2", rrf_score: 0.04, melhor_trecho: "trecho 2", pagina: 2, n_trechos_relevantes: 1 },
      ]
    );

    const resultado = await buscarDocumentosConteudo(
      paramsBase,
      supabase as never,
      "pergunta"
    );

    expect(resultado.confianca).toBe("alta"); // doc-1 score > 2× doc-2 score
  });
});
```

- [ ] **Step 3: Rodar testes — confirmar que falham**

```bash
npx vitest run src/lib/documentosRecuperacao.test.ts
```
Expected: FAIL.

- [ ] **Step 4: Implementar `documentosRecuperacao.ts`**

```ts
// src/lib/documentosRecuperacao.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDocumentosAccessOr } from "@/lib/documentosAccessFilters";
import { gerarEmbeddings } from "@/lib/embeddings";
import { chamarAzureOpenAi } from "@/lib/azureOpenAi"; // adaptar nome se necessário
import type { ConsultaInterpretada } from "@/lib/documentosInterpretacao";

export const RECORTE_MAX_DOCUMENTOS = 2000;

export type DocumentoBuscado = {
  documentoId: string;
  rrfScore: number;
  trecho: string;
  pagina?: number | null;
  nTrechosRelevantes: number;
  justificativa?: string;
};

export type ResultadoBuscaConteudo = {
  documentos: DocumentoBuscado[];
  confianca: "alta" | "media" | "baixa";
  sugestaoRefinamento?: string;
  recorteExcedido: boolean;
  filtrosAplicados: Record<string, string>;
};

export type BuscaConteudoParams = {
  consulta: ConsultaInterpretada;
  lojaId?: string;
  equipamentoId?: string;
  userId: string;
  allowedPrestadores: string[];
  gerenteEntries: Array<{ lojaId: string; prestadorId?: string }>;
  canAccess: boolean;
};

async function construirAllowlist(
  params: BuscaConteudoParams,
  supabaseAdmin: SupabaseClient
): Promise<{ ids: string[]; excedido: boolean }> {
  const { consulta, lojaId, equipamentoId, userId, allowedPrestadores, gerenteEntries, canAccess } = params;

  const accessFilters = buildDocumentosAccessOr({
    canAccess,
    allowedPrestadores,
    gerenteEntries,
    userId,
    // Adicione campos extras se BuildAccessOrInput os exigir — leia o arquivo antes
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabaseAdmin
    .from("formularios")
    .select("id")
    .limit(RECORTE_MAX_DOCUMENTOS + 1);

  if (accessFilters.length > 0) {
    query = query.or(accessFilters.join(","));
  }
  if (consulta.tipo) query = query.eq("tipo", consulta.tipo);
  if (lojaId) query = query.filter("dados->>loja_id", "eq", lojaId);
  if (equipamentoId) query = query.eq("equipamento_id", equipamentoId);
  if (consulta.ano && consulta.mes) {
    query = query.filter("dados->>competencia", "ilike", `${consulta.mes}/${consulta.ano}%`);
  } else if (consulta.ano) {
    query = query.filter("dados->>competencia", "ilike", `%/${consulta.ano}`);
  }

  const { data, error } = await query as { data: {id:string}[] | null; error: Error | null };
  if (error) throw error;

  const excedido = (data?.length ?? 0) > RECORTE_MAX_DOCUMENTOS;
  const ids = (data ?? []).slice(0, RECORTE_MAX_DOCUMENTOS).map((d) => d.id);
  return { ids, excedido };
}

async function rerankear(
  documentos: Omit<DocumentoBuscado, "justificativa">[],
  pergunta: string
): Promise<DocumentoBuscado[]> {
  if (documentos.length === 0) return [];

  const top20 = documentos.slice(0, 20);
  const lista = top20
    .map((d, i) => `${i + 1}. [${d.documentoId}] ${d.trecho.slice(0, 300)}`)
    .join("\n");

  const promptRerank = `Pergunta: "${pergunta}"

Trechos recuperados (cada um com ID do documento):
${lista}

Ordene por relevância à pergunta. Retorne JSON (sem markdown):
[{"documentoId":"<id>","justificativa":"<1 frase curta>"}]
Inclua apenas trechos genuinamente úteis. Responda SOMENTE o JSON.`;

  let ordenados: { documentoId: string; justificativa: string }[] = [];
  try {
    const resp = await chamarAzureOpenAi(
      [{ role: "user" as const, content: promptRerank }],
      { responseFormat: "json_object" } // adaptar ao API real
    );
    const parsed = JSON.parse(resp) as unknown;
    if (Array.isArray(parsed)) {
      ordenados = parsed as typeof ordenados;
    }
  } catch {
    // Best-effort: reranking failure returns original order without justificativas
    return top20;
  }

  const mapaOriginal = new Map(top20.map((d) => [d.documentoId, d]));
  const result: DocumentoBuscado[] = [];
  for (const item of ordenados) {
    const doc = mapaOriginal.get(item.documentoId);
    if (doc) result.push({ ...doc, justificativa: item.justificativa });
  }
  // Append docs not mentioned by LLM (sem justificativa)
  for (const doc of top20) {
    if (!result.find((r) => r.documentoId === doc.documentoId)) {
      result.push(doc);
    }
  }
  return result;
}

function calcularConfianca(
  documentos: DocumentoBuscado[],
  filtroNaoResolvido: boolean
): "alta" | "media" | "baixa" {
  if (documentos.length === 0) return "baixa";
  if (filtroNaoResolvido) return "media";
  if (documentos.length >= 2 && documentos[0].rrfScore > documentos[1].rrfScore * 1.5) return "alta";
  if (documentos.length === 1) return "alta";
  return "media";
}

export async function buscarDocumentosConteudo(
  params: BuscaConteudoParams,
  supabaseAdmin: SupabaseClient,
  perguntaOriginal: string,
): Promise<ResultadoBuscaConteudo> {
  const { consulta } = params;
  const filtrosAplicados: Record<string, string> = {};
  if (consulta.tipo) filtrosAplicados.tipo = consulta.tipo;
  if (consulta.assunto) filtrosAplicados.assunto = consulta.assunto;
  if (params.lojaId) filtrosAplicados.loja = params.lojaId;

  // Estágio 1: construir allowlist autorizado
  const { ids: documentoIds, excedido: recorteExcedido } =
    await construirAllowlist(params, supabaseAdmin);

  if (recorteExcedido) {
    return {
      documentos: [],
      confianca: "baixa",
      recorteExcedido: true,
      sugestaoRefinamento:
        "Muitos documentos encontrados. Tente adicionar um filtro de loja, equipamento ou período para refinar.",
      filtrosAplicados,
    };
  }

  if (documentoIds.length === 0) {
    return { documentos: [], confianca: "baixa", recorteExcedido: false, filtrosAplicados };
  }

  // Estágio 2: busca híbrida na RPC
  const embeddings = await gerarEmbeddings([consulta.consultaSemantica]);
  const embedding = embeddings[0];

  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
    "buscar_chunks_hibrido",
    {
      p_documento_ids: documentoIds,
      // pgvector espera '[0.1,0.2,...]' como string no cliente JS
      p_embedding: `[${embedding.join(",")}]`,
      p_consulta_texto: consulta.consultaSemantica,
      p_limite: 20,
    }
  );
  if (rpcError) throw rpcError;

  const raw = (rpcData ?? []) as Array<{
    documento_id: string;
    rrf_score: number;
    melhor_trecho: string;
    pagina: number | null;
    n_trechos_relevantes: number;
  }>;

  const semJustificativa = raw.map((r) => ({
    documentoId: r.documento_id,
    rrfScore: r.rrf_score,
    trecho: r.melhor_trecho,
    pagina: r.pagina,
    nTrechosRelevantes: r.n_trechos_relevantes,
  }));

  // Reranking (best-effort — falha não cancela a busca)
  const documentos = await rerankear(semJustificativa, perguntaOriginal);

  const filtroNaoResolvido =
    (!!consulta.lojaTermo && !params.lojaId) ||
    (!!consulta.equipamentoTermo && !params.equipamentoId);

  return {
    documentos,
    confianca: calcularConfianca(documentos, filtroNaoResolvido),
    recorteExcedido: false,
    sugestaoRefinamento: filtroNaoResolvido
      ? `Não consegui identificar "${consulta.lojaTermo ?? consulta.equipamentoTermo}" com segurança — verifique o nome e tente novamente.`
      : undefined,
    filtrosAplicados,
  };
}
```

**Nota sobre `any`:** a tipagem dinâmica do query builder do Supabase força o `any` intermediário em `construirAllowlist`. É aceitável aqui, mas marcado explicitamente. Se o projeto usar a tipagem gerada (`Database`), adapte para remover o `any`.

- [ ] **Step 5: Rodar testes — confirmar que passam**

```bash
npx vitest run src/lib/documentosRecuperacao.test.ts
```
Expected: 5/5 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/documentosRecuperacao.ts src/lib/documentosRecuperacao.test.ts
git commit -m "feat: adiciona recuperacao hibrida em dois estagios com reranking"
```

---

### Task 4: Registrar tool + atualizar tipos + prompt do domínio

**Files:**
- Modify: `src/lib/assistenteTypes.ts`
- Modify: `src/lib/assistenteDominioDocumentos.ts`

**Interfaces:**
- Consumes: `interpretarConsulta` (Task 2), `buscarDocumentosConteudo` (Task 3)
- Produces: tool `buscar_documentos_conteudo` registrada no domínio `documentos`

- [ ] **Step 1: Ler os arquivos completos antes de editar**

```bash
# Leia os dois arquivos inteiros antes de qualquer edição:
# src/lib/assistenteTypes.ts
# src/lib/assistenteDominioDocumentos.ts
```

Identifique: tipo exato de `AssistenteResultItem`, tipo de resposta do domínio (`AssistenteSearchOutcome` ou similar), tipo do contexto de execução passado às tools (`ctx`), campos disponíveis no contexto (userId, supabaseAdmin, accessInfo, etc.).

- [ ] **Step 2: Atualizar `assistenteTypes.ts` — adicionar campos opcionais**

Em `AssistenteResultItem`, adicionar (sem remover nada):
```ts
justificativa?: string;
trechoCitado?: string;
pagina?: number;
competencia?: string;
unidade?: string;
equipamento?: string;
resumo?: string;
```

No tipo de resposta do domínio (provavelmente `AssistenteSearchOutcome` ou equivalente), adicionar:
```ts
confianca?: "alta" | "media" | "baixa";
sugestaoRefinamento?: string;
```

**Verifique:** os campos existentes não foram alterados, apenas campos opcionais foram acrescentados.

- [ ] **Step 3: Registrar a nova tool em `assistenteDominioDocumentos.ts`**

No array de tools do domínio, ao lado de `buscar_documentos`, adicionar:

```ts
{
  name: "buscar_documentos_conteudo",
  description:
    "Busca documentos pelo CONTEÚDO (texto de laudos, contratos, relatórios) usando busca semântica e textual. Use para perguntas sobre assuntos técnicos, equipamentos, problemas encontrados ou qualquer consulta sobre O QUE está escrito no documento. NÃO use para listagens por metadados (ex.: 'todas as NFs de março') — para isso use buscar_documentos.",
  parameters: {
    type: "object" as const,
    properties: {
      pergunta: {
        type: "string",
        description: "A pergunta em linguagem natural sobre o conteúdo dos documentos",
      },
    },
    required: ["pergunta"],
  },
},
```

- [ ] **Step 4: Implementar `executarBuscarDocumentosConteudo`**

Adicionar a função junto a `executarBuscarDocumentos`:

```ts
async function executarBuscarDocumentosConteudo(
  args: { pergunta: string },
  ctx: /* tipo do contexto usado pelas outras tools — leia o arquivo */ never
): Promise</* tipo de resposta do domínio */never> {
  // 1. Carregar termos disponíveis da taxonomia
  const { data: termosData, error: termosError } = await ctx.supabaseAdmin
    .from("taxonomia_termos")
    .select("termo")
    .eq("ativo", true);
  if (termosError) throw termosError;
  const termosDisponiveis = (termosData ?? []).map((t: { termo: string }) => t.termo);

  // 2. Interpretar a pergunta
  const consulta = await interpretarConsulta(args.pergunta, termosDisponiveis);

  // 3. Resolver lojaTermo → lojaId (best-effort)
  let lojaId: string | undefined;
  if (consulta.lojaTermo) {
    const { data: lojas } = await ctx.supabaseAdmin
      .from("lojas")
      .select("id")
      .ilike("nome", `%${consulta.lojaTermo}%`)
      .limit(1);
    lojaId = (lojas as Array<{ id: string }> | null)?.[0]?.id;
  }

  // 4. Recuperação em dois estágios + reranking
  const resultado = await buscarDocumentosConteudo(
    {
      consulta,
      lojaId,
      userId: ctx.userId, // adapte ao campo real do contexto
      allowedPrestadores: ctx.allowedPrestadores ?? [],
      gerenteEntries: ctx.gerenteEntries ?? [],
      canAccess: ctx.canAccess ?? false,
    },
    ctx.supabaseAdmin,
    args.pergunta
  );

  // 5. Enriquecer com metadados (titulo, abrirArquivoPath) dos formularios
  let metadataMap: Map<string, { titulo: string; abrirArquivoPath: string | null }> = new Map();
  if (resultado.documentos.length > 0) {
    const ids = resultado.documentos.map((d) => d.documentoId);
    const { data: forms } = await ctx.supabaseAdmin
      .from("formularios")
      .select("id, tipo, dados, arquivo_path")
      .in("id", ids);

    for (const f of (forms ?? []) as Array<{
      id: string; tipo: string; dados: Record<string, unknown>; arquivo_path: string | null
    }>) {
      // Construir título a partir de tipo + dados (adapte ao padrão do projeto)
      const lojaNome = (f.dados?.["loja_nome"] as string | undefined) ?? "";
      const competencia = (f.dados?.["competencia"] as string | undefined) ?? "";
      const titulo = [f.tipo, lojaNome, competencia].filter(Boolean).join(" — ");
      metadataMap.set(f.id, { titulo, abrirArquivoPath: f.arquivo_path });
    }
  }

  // 6. Montar AssistenteResultItem[] (adapte ao tipo real do domínio)
  const results = resultado.documentos.map((d) => {
    const meta = metadataMap.get(d.documentoId);
    return {
      id: d.documentoId,
      titulo: meta?.titulo ?? d.documentoId,
      subtitulo: d.trecho.slice(0, 120),
      abrirArquivoPath: meta?.abrirArquivoPath ?? undefined,
      justificativa: d.justificativa,
      trechoCitado: d.trecho,
      pagina: d.pagina ?? undefined,
    };
  });

  // 7. Retornar no formato do domínio (adapte ao tipo real)
  return {
    dominio: "documentos",
    filters: resultado.filtrosAplicados,
    filtrosUrl: "",
    summary: resultado.recorteExcedido
      ? resultado.sugestaoRefinamento ?? "Muitos documentos. Refine a busca."
      : resultado.documentos.length === 0
        ? "Nenhum documento encontrado para essa consulta."
        : `Encontrei ${resultado.documentos.length} documento(s) relevante(s).`,
    results,
    total: resultado.documentos.length,
    insights: {},
    confianca: resultado.confianca,
    sugestaoRefinamento: resultado.sugestaoRefinamento,
  };
}
```

**Adapte** todos os campos `ctx.*` e os tipos de retorno ao que está no arquivo real. O padrão acima é um guia — o arquivo real é a fonte de verdade.

- [ ] **Step 5: Conectar a tool ao dispatcher**

No bloco `executarTool` (ou equivalente), adicionar:
```ts
case "buscar_documentos_conteudo":
  return executarBuscarDocumentosConteudo(
    args as { pergunta: string },
    ctx
  );
```

- [ ] **Step 6: Atualizar o prompt do domínio**

Em `descricaoPrompt()`, acrescentar orientação sobre qual tool usar:
```
Ferramentas:
- buscar_documentos: filtra por metadados (tipo, loja, fornecedor, período, número de NF).
  Use quando o usuário quer LISTAR ou FILTRAR documentos por atributos conhecidos.
- buscar_documentos_conteudo: busca pelo CONTEÚDO técnico dos documentos.
  Use quando a pergunta é sobre equipamentos, assuntos, problemas ou qualquer
  coisa que esteja escrita DENTRO do documento.

Exemplos:
  "laudo do gerador da Matriz" → buscar_documentos_conteudo
  "notas fiscais de março" → buscar_documentos
  "tem recomendação de troca de peças do elevador?" → buscar_documentos_conteudo
```

- [ ] **Step 7: Rodar a suíte completa**

```bash
npx vitest run
```
Expected: todos os testes existentes passando + nenhuma regressão.

- [ ] **Step 8: Commit**

```bash
git add src/lib/assistenteTypes.ts src/lib/assistenteDominioDocumentos.ts
git commit -m "feat: registra tool buscar_documentos_conteudo no dominio documentos"
```

---
