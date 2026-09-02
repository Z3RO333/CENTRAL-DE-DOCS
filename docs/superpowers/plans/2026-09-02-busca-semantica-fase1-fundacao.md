# Busca semântica — Fase 1: Fundação de conteúdo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parar de descartar o texto do OCR que já é extraído a cada upload, persistindo-o em `documento_conteudo`, dividindo-o em trechos com embeddings em `documento_chunks` (pgvector), e permitindo reindexar o acervo existente por um backfill retomável.

**Architecture:** O texto extraído pelo Azure Document Intelligence — hoje produzido dentro de `analisarDocumentoComOpenAi` e jogado fora — passa a ser devolvido junto com a análise. Ao final de `processarDocumentoComIa` (que já roda a cada documento novo via webhook), uma etapa best-effort persiste o texto, divide em trechos, gera embeddings e grava os chunks com metadados desnormalizados. Nenhuma busca muda nesta fase: ela apenas constrói o índice que as fases 2-4 vão consumir.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + pgvector), Azure OpenAI (embeddings), Azure Document Intelligence (OCR já integrado), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-busca-semantica-documentos-design.md` (seção "Fase 1 — Fundação de conteúdo")

## Global Constraints

- **A indexação é aditiva e nunca pode derrubar o fluxo existente.** Falha de OCR, de embedding ou de gravação de chunk não impede upload, análise, nem muda `status_analise_ia`. Segue o mesmo padrão best-effort que `processarDocumentoComIa` já usa para `registrarRecomendacoesCriticas` (try/catch + `console.error`, sem mascarar o erro original).
- **Nenhuma busca existente muda nesta fase.** `buildDocumentosTextSearchOr`, `queryDocumentoCandidates` e a tool `buscar_documentos` ficam intocados.
- **Migrações seguem a convenção do repositório:** nomes qualificados com `public.`, RLS habilitada e `revoke all on public.<tabela> from public, anon, authenticated;` — acesso só via `supabaseAdmin`, como em `202607311600_create_documento_recomendacoes_criticas.sql`.
- **Custo de OCR é por página:** `arquivo_hash` (SHA-256) impede reprocessar o mesmo arquivo; o backfill tem teto diário (`INDEXACAO_LIMITE_DIARIO`).
- Dimensão do embedding: **1536** (`text-embedding-3-small`). O valor aparece na DDL e em `EMBEDDING_DIMENSOES` — os dois precisam continuar iguais.
- Testes seguem o padrão do repositório: Vitest, `environment: "node"`, arquivos `src/**/*.test.ts`, Supabase mockado por objeto encadeável (não há banco em teste).

## Decisões deste plano que divergem da spec (e por quê)

1. **Índice vetorial HNSW em vez de `ivfflat`.** A spec previa `ivfflat` e registrava como risco o fato de ele precisar de dados para treinar bem as listas — problema real, já que o índice nasce com a tabela vazia. HNSW (pgvector ≥ 0.5) não tem etapa de treino: funciona bem desde o primeiro registro e não precisa ser recriado depois do backfill. Elimina o risco em vez de administrá-lo. Se o Postgres do projeto tiver pgvector < 0.5, cair para `ivfflat` conforme a spec (a Task 1 traz a alternativa pronta).
2. **`pagina` fica `null` nesta fase.** A função de OCR atual devolve o texto do documento inteiro (`analyzeResult.content`), sem mapa de páginas por trecho. Mapear trecho→página exigiria reescrever a extração, o que aumenta o risco sobre uma função que funciona. A coluna existe e é preenchível depois; o que dá para obter agora sem risco é a **contagem** de páginas (`analyzeResult.pages.length`), que vai para `documento_conteudo.paginas` e serve ao sinal de "extração pobre" previsto na spec.
3. **Só PDF é indexado nesta fase.** O OCR hoje roda apenas para PDF; imagens (PNG/JPEG) vão direto ao modelo de visão, sem texto extraído. Indexá-las exigiria uma chamada nova ao Document Intelligence por imagem — custo que hoje não existe. Nesta fase, imagem grava `origem = 'nao_aplicavel'` e fica fora do índice. Estender a imagens é uma decisão de custo, registrada aqui para ser tomada explicitamente.
4. **`origem = 'pdf_texto'` não é produzido nesta fase.** O valor permanece no `check` da coluna (fiel à spec, sem custo), mas todo PDF passa hoje pelo Document Intelligence, então a origem real é sempre `ocr`.

---

## Estrutura de arquivos

**Criar:**
- `supabase/migrations/202609021000_create_documento_conteudo_chunks.sql` — extensão `vector`, as duas tabelas, índices, RLS e revoke.
- `src/lib/documentoChunking.ts` — divisão de texto em trechos. Função pura, sem I/O.
- `src/lib/embeddings.ts` — cliente de embeddings do Azure OpenAI, isolado atrás de `gerarEmbeddings`.
- `src/lib/documentoIndexacao.ts` — orquestra persistir texto → chunk → embedding → gravar.
- `src/app/api/documentos/indexacao/backfill/route.ts` — endpoint administrativo do backfill.
- Testes: `src/lib/documentoChunking.test.ts`, `src/lib/embeddings.test.ts`, `src/lib/documentoIndexacao.test.ts`.

**Modificar:**
- `src/lib/openAiDocumentAnalysis.ts` — devolver o texto extraído e a contagem de páginas.
- `src/lib/documentAnalysisPipeline.ts` — devolver o hash do arquivo e chamar a indexação ao final.
- `.env.example` — variáveis novas.

---

### Task 1: Migração — `documento_conteudo` e `documento_chunks`

**Files:**
- Create: `supabase/migrations/202609021000_create_documento_conteudo_chunks.sql`

**Interfaces:**
- Produces: tabelas `public.documento_conteudo` e `public.documento_chunks`, consumidas por `documentoIndexacao.ts` (Task 5) e pelo backfill (Task 7).

- [ ] **Step 1: Escrever a migração**

```sql
-- Busca semantica (Fase 1): texto extraido dos documentos e trechos vetorizados.
-- Acesso exclusivamente via supabaseAdmin na camada de API (padrao do projeto).

create extension if not exists vector;

create table public.documento_conteudo (
  documento_id uuid primary key references public.formularios(id) on delete cascade,
  texto text not null default '',
  origem text not null check (origem in ('ocr', 'pdf_texto', 'nao_aplicavel')),
  paginas integer,
  arquivo_hash text,
  caracteres integer not null default 0,
  indexado_em timestamptz,
  erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documento_conteudo_indexado_em_idx
  on public.documento_conteudo (indexado_em);

create table public.documento_chunks (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.formularios(id) on delete cascade,
  ordem integer not null,
  pagina integer,
  texto text not null,
  embedding vector(1536),
  -- Colunas desnormalizadas: permitem filtrar no mesmo WHERE da busca vetorial,
  -- sem join com formularios. Reescritas a cada reindexacao do documento.
  loja_id text,
  tipo text,
  competencia text,
  equipamento_id uuid,
  prestador_id uuid,
  documento_created_at timestamptz,
  texto_tsv tsvector generated always as (to_tsvector('portuguese', texto)) stored,
  created_at timestamptz not null default now(),
  unique (documento_id, ordem)
);

-- HNSW nao exige treino previo (funciona com a tabela vazia) e nao precisa ser
-- recriado depois do backfill. Requer pgvector >= 0.5.
create index documento_chunks_embedding_idx
  on public.documento_chunks using hnsw (embedding vector_cosine_ops);

create index documento_chunks_tsv_idx
  on public.documento_chunks using gin (texto_tsv);
create index documento_chunks_documento_idx
  on public.documento_chunks (documento_id);
create index documento_chunks_loja_idx on public.documento_chunks (loja_id);
create index documento_chunks_tipo_idx on public.documento_chunks (tipo);
create index documento_chunks_equipamento_idx
  on public.documento_chunks (equipamento_id);

alter table public.documento_conteudo enable row level security;
alter table public.documento_chunks enable row level security;

revoke all on public.documento_conteudo from public, anon, authenticated;
revoke all on public.documento_chunks from public, anon, authenticated;
```

- [ ] **Step 2: Verificar a sintaxe por inspeção**

Não há Supabase CLI nem Postgres local neste repositório (`supabase/` só contém `migrations/` e `queries/`) — migrações são commitadas e aplicadas no projeto hospedado. Comparar o arquivo com `supabase/migrations/202607311600_create_documento_recomendacoes_criticas.sql`, conferindo: nomes qualificados com `public.`, `enable row level security` nas duas tabelas, `revoke all ... from public, anon, authenticated` nas duas, e todo comando terminado com `;`.

Se ao aplicar no ambiente hospedado o `create index ... using hnsw` falhar por versão do pgvector, substituir por:

```sql
create index documento_chunks_embedding_idx
  on public.documento_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202609021000_create_documento_conteudo_chunks.sql
git commit -m "feat: cria tabelas de conteudo e chunks vetoriais dos documentos"
```

---

### Task 2: Divisão de texto em trechos (`documentoChunking.ts`)

**Files:**
- Create: `src/lib/documentoChunking.ts`
- Test: `src/lib/documentoChunking.test.ts`

**Interfaces:**
- Produces: `DocumentoChunk = { ordem: number; texto: string; pagina: number | null }`, `dividirEmChunks(texto: string, opcoes?: { alvo?: number; sobreposicao?: number; minUtil?: number }): DocumentoChunk[]`, e as constantes `CHUNK_ALVO` (1000), `CHUNK_SOBREPOSICAO` (150), `CHUNK_MIN_UTIL` (50) — consumidas por `documentoIndexacao.ts` (Task 5).

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/lib/documentoChunking.test.ts
import { describe, expect, it } from "vitest";
import {
  CHUNK_MIN_UTIL,
  dividirEmChunks,
} from "@/lib/documentoChunking";

const paragrafo = (tamanho: number, palavra = "laudo") => {
  const bloco = `${palavra} `.repeat(Math.ceil(tamanho / (palavra.length + 1)));
  return bloco.slice(0, tamanho).trim();
};

describe("dividirEmChunks", () => {
  it("retorna vazio para texto vazio ou so espacos", () => {
    expect(dividirEmChunks("")).toEqual([]);
    expect(dividirEmChunks("   \n\n  ")).toEqual([]);
  });

  it("mantem um texto curto em um unico chunk", () => {
    const chunks = dividirEmChunks("Laudo do gerador aprovado sem restricoes tecnicas.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].ordem).toBe(0);
    expect(chunks[0].pagina).toBeNull();
  });

  it("empacota paragrafos ate o alvo e numera em ordem", () => {
    const p1 = paragrafo(55);
    const p2 = paragrafo(55, "motor");
    const chunks = dividirEmChunks(`${p1}\n\n${p2}`, {
      alvo: 60,
      sobreposicao: 0,
      minUtil: 10,
    });
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.ordem)).toEqual([0, 1]);
    expect(chunks[0].texto).toBe(p1);
    expect(chunks[1].texto).toBe(p2);
  });

  it("aplica sobreposicao do chunk anterior no seguinte", () => {
    const p1 = paragrafo(55);
    const p2 = paragrafo(55, "motor");
    const chunks = dividirEmChunks(`${p1}\n\n${p2}`, {
      alvo: 60,
      sobreposicao: 12,
      minUtil: 10,
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[1].texto.endsWith(p2)).toBe(true);
    expect(chunks[1].texto.length).toBeGreaterThan(p2.length);
  });

  it("descarta fragmento abaixo do minimo util quando ha trecho util", () => {
    // 58 + 2 (separador) + 2 ("ok") = 62 > alvo 60, entao "ok" vira um bloco
    // separado em vez de ser empacotado junto — e ai cai abaixo do minimo util.
    const grande = paragrafo(58);
    const chunks = dividirEmChunks(`${grande}\n\nok`, {
      alvo: 60,
      sobreposicao: 0,
      minUtil: 50,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].texto).toBe(grande);
  });

  it("mantem o texto quando todos os trechos ficariam abaixo do minimo", () => {
    const chunks = dividirEmChunks("Laudo ok.", { minUtil: CHUNK_MIN_UTIL });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].texto).toBe("Laudo ok.");
  });

  it("quebra paragrafo maior que o alvo sem estourar o limite", () => {
    const enorme = paragrafo(500);
    const chunks = dividirEmChunks(enorme, { alvo: 100, sobreposicao: 0, minUtil: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.texto.length).toBeLessThanOrEqual(100);
    }
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/documentoChunking.test.ts`
Expected: FAIL — `Cannot find module '@/lib/documentoChunking'`.

- [ ] **Step 3: Implementar `documentoChunking.ts`**

```ts
export type DocumentoChunk = {
  ordem: number;
  texto: string;
  /** Sempre null na Fase 1: o OCR atual devolve o documento inteiro, sem mapa de paginas. */
  pagina: number | null;
};

export const CHUNK_ALVO = 1000;
export const CHUNK_SOBREPOSICAO = 150;
export const CHUNK_MIN_UTIL = 50;

const normalizar = (texto: string) =>
  texto
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const dividirEmSentencas = (bloco: string): string[] => {
  const partes = bloco.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
  return partes ? partes.map((parte) => parte.trim()).filter(Boolean) : [bloco];
};

const fatiarDuro = (texto: string, alvo: number): string[] => {
  const fatias: string[] = [];
  for (let inicio = 0; inicio < texto.length; inicio += alvo) {
    fatias.push(texto.slice(inicio, inicio + alvo));
  }
  return fatias;
};

const explodirBloco = (bloco: string, alvo: number): string[] => {
  if (bloco.length <= alvo) {
    return [bloco];
  }
  const saida: string[] = [];
  for (const sentenca of dividirEmSentencas(bloco)) {
    if (sentenca.length <= alvo) {
      saida.push(sentenca);
    } else {
      saida.push(...fatiarDuro(sentenca, alvo));
    }
  }
  return saida;
};

/** Cauda do texto anterior, cortada no inicio de palavra para nao comecar picotado. */
const caudaEmLimiteDePalavra = (texto: string, tamanho: number) => {
  if (tamanho <= 0) {
    return "";
  }
  if (texto.length <= tamanho) {
    return texto;
  }
  const cauda = texto.slice(-tamanho);
  const espaco = cauda.indexOf(" ");
  return espaco === -1 ? cauda : cauda.slice(espaco + 1);
};

export function dividirEmChunks(
  texto: string,
  opcoes: { alvo?: number; sobreposicao?: number; minUtil?: number } = {},
): DocumentoChunk[] {
  const alvo = opcoes.alvo ?? CHUNK_ALVO;
  const sobreposicao = opcoes.sobreposicao ?? CHUNK_SOBREPOSICAO;
  const minUtil = opcoes.minUtil ?? CHUNK_MIN_UTIL;

  const normalizado = normalizar(texto ?? "");
  if (!normalizado) {
    return [];
  }

  const blocos = normalizado
    .split(/\n\s*\n/)
    .map((bloco) => bloco.trim())
    .filter(Boolean)
    .flatMap((bloco) => explodirBloco(bloco, alvo));

  const brutos: string[] = [];
  let atual = "";
  for (const bloco of blocos) {
    const candidato = atual ? `${atual}\n\n${bloco}` : bloco;
    if (candidato.length > alvo && atual) {
      brutos.push(atual);
      atual = bloco;
    } else {
      atual = candidato;
    }
  }
  if (atual) {
    brutos.push(atual);
  }

  // Fragmentos curtos sao ruido de OCR — mas se TODOS ficarem abaixo do minimo,
  // o documento e curto de verdade e deve continuar pesquisavel.
  const uteis = brutos.filter((bloco) => bloco.trim().length >= minUtil);
  const finais = uteis.length > 0 ? uteis : brutos;

  return finais.map((textoChunk, indice) => {
    const anterior = indice > 0 ? finais[indice - 1] : null;
    const prefixo = anterior ? caudaEmLimiteDePalavra(anterior, sobreposicao) : "";
    return {
      ordem: indice,
      texto: prefixo ? `${prefixo} ${textoChunk}` : textoChunk,
      pagina: null,
    };
  });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/documentoChunking.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentoChunking.ts src/lib/documentoChunking.test.ts
git commit -m "feat: adiciona divisao de texto em trechos para indexacao"
```

---

### Task 3: Cliente de embeddings (`embeddings.ts`)

**Files:**
- Create: `src/lib/embeddings.ts`
- Test: `src/lib/embeddings.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `gerarEmbeddings(textos: string[]): Promise<number[][]>`, `EMBEDDING_DIMENSOES` (1536), `EMBEDDING_LOTE_MAX` (16) — consumidos por `documentoIndexacao.ts` (Task 5).

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/lib/embeddings.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_LOTE_MAX, gerarEmbeddings } from "@/lib/embeddings";

const respostaOk = (quantidade: number) => ({
  ok: true,
  json: async () => ({
    data: Array.from({ length: quantidade }, (_, index) => ({
      index,
      embedding: [index, index + 0.5],
    })),
  }),
});

beforeEach(() => {
  process.env.AZURE_OPENAI_API_KEY = "chave";
  process.env.AZURE_OPENAI_ENDPOINT = "https://exemplo.openai.azure.com";
  process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = "text-embedding-3-small";
  // Limpa a versao de API para o teste de URL nao depender do .env de quem roda.
  delete process.env.AZURE_OPENAI_EMBEDDING_API_VERSION;
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gerarEmbeddings", () => {
  it("retorna vazio sem chamar a API quando nao ha texto", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(gerarEmbeddings([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("monta a URL de embeddings a partir do endpoint base", async () => {
    const fetchMock = vi.fn(async () => respostaOk(1));
    vi.stubGlobal("fetch", fetchMock);

    await gerarEmbeddings(["laudo do gerador"]);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(
      "/openai/deployments/text-embedding-3-small/embeddings",
    );
    expect(url).toContain("api-version=");
  });

  it("deriva a base quando o endpoint ja aponta para chat/completions", async () => {
    process.env.AZURE_OPENAI_ENDPOINT =
      "https://exemplo.openai.azure.com/openai/deployments/gpt-5-chat/chat/completions?api-version=2025-01-01-preview";
    const fetchMock = vi.fn(async () => respostaOk(1));
    vi.stubGlobal("fetch", fetchMock);

    await gerarEmbeddings(["laudo"]);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(
      "https://exemplo.openai.azure.com/openai/deployments/text-embedding-3-small/embeddings?api-version=2024-02-01",
    );
  });

  it("divide em lotes e devolve os vetores na ordem original", async () => {
    const total = EMBEDDING_LOTE_MAX + 2;
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const enviados = (JSON.parse(init.body) as { input: string[] }).input;
      return respostaOk(enviados.length);
    });
    vi.stubGlobal("fetch", fetchMock);

    const vetores = await gerarEmbeddings(
      Array.from({ length: total }, (_, i) => `trecho ${i}`),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vetores).toHaveLength(total);
    expect(vetores[0]).toEqual([0, 0.5]);
  });

  it("reordena pela propriedade index quando a API devolve fora de ordem", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            { index: 1, embedding: [9] },
            { index: 0, embedding: [7] },
          ],
        }),
      })),
    );

    await expect(gerarEmbeddings(["a", "b"])).resolves.toEqual([[7], [9]]);
  });

  it("falha com mensagem clara quando falta configuracao", async () => {
    delete process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;
    vi.stubGlobal("fetch", vi.fn());
    await expect(gerarEmbeddings(["a"])).rejects.toThrow(
      /AZURE_OPENAI_EMBEDDING_DEPLOYMENT/,
    );
  });

  it("propaga erro da API com o status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "input muito longo" } }),
      })),
    );

    await expect(gerarEmbeddings(["a"])).rejects.toThrow("input muito longo");
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/embeddings.test.ts`
Expected: FAIL — `Cannot find module '@/lib/embeddings'`.

- [ ] **Step 3: Implementar `embeddings.ts`**

```ts
export const EMBEDDING_DIMENSOES = 1536;
export const EMBEDDING_LOTE_MAX = 16;

const TENTATIVAS_MAX = 3;
const API_VERSION_PADRAO = "2024-02-01";

function getConfig() {
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
  const deployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT?.trim();
  const apiVersion =
    process.env.AZURE_OPENAI_EMBEDDING_API_VERSION?.trim() || API_VERSION_PADRAO;

  if (!apiKey || !endpoint || !deployment) {
    throw new Error(
      "Configure AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT e AZURE_OPENAI_EMBEDDING_DEPLOYMENT no .env.",
    );
  }

  // AZURE_OPENAI_ENDPOINT pode conter a URL completa de chat/completions
  // (e o padrao do projeto em azureOpenAi.ts e exatamente essa forma).
  // Aqui interessa so a base do recurso.
  const base = endpoint.includes("/openai/")
    ? endpoint.slice(0, endpoint.indexOf("/openai/"))
    : endpoint.replace(/\/+$/, "");

  const url = `${base}/openai/deployments/${encodeURIComponent(
    deployment,
  )}/embeddings?api-version=${encodeURIComponent(apiVersion)}`;

  return { apiKey, url };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function gerarLote(
  textos: string[],
  config: { apiKey: string; url: string },
): Promise<number[][]> {
  let ultimoErro: Error | null = null;

  for (let tentativa = 1; tentativa <= TENTATIVAS_MAX; tentativa += 1) {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "api-key": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: textos }),
    });

    const raw = (await response.json().catch(() => null)) as
      | {
          error?: { message?: string };
          data?: Array<{ index?: number; embedding?: number[] }>;
        }
      | null;

    if (response.ok) {
      const dados = raw?.data ?? [];
      if (dados.length !== textos.length) {
        throw new Error(
          `Azure OpenAI devolveu ${dados.length} embeddings para ${textos.length} textos.`,
        );
      }
      return dados
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((item) => item.embedding ?? []);
    }

    const mensagem =
      raw?.error?.message ?? `Azure OpenAI retornou status ${response.status}.`;
    ultimoErro = new Error(mensagem);

    const recuperavel = response.status === 429 || response.status >= 500;
    if (!recuperavel || tentativa === TENTATIVAS_MAX) {
      throw ultimoErro;
    }
    await sleep(500 * 2 ** (tentativa - 1));
  }

  throw ultimoErro ?? new Error("Falha ao gerar embeddings.");
}

export async function gerarEmbeddings(textos: string[]): Promise<number[][]> {
  if (textos.length === 0) {
    return [];
  }
  const config = getConfig();
  const vetores: number[][] = [];

  for (let inicio = 0; inicio < textos.length; inicio += EMBEDDING_LOTE_MAX) {
    const lote = textos.slice(inicio, inicio + EMBEDDING_LOTE_MAX);
    vetores.push(...(await gerarLote(lote, config)));
  }

  return vetores;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/embeddings.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Documentar as variáveis novas**

Em `.env.example`, logo abaixo do bloco `# Azure OpenAI (opcional: análises por IA e Copiloto)`, acrescentar:

```
# Azure OpenAI — embeddings (opcional: busca semantica de documentos)
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=
AZURE_OPENAI_EMBEDDING_API_VERSION=
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/embeddings.ts src/lib/embeddings.test.ts .env.example
git commit -m "feat: adiciona cliente de embeddings do Azure OpenAI"
```

---

### Task 4: Expor o texto do OCR e o hash do arquivo

**Files:**
- Modify: `src/lib/openAiDocumentAnalysis.ts`
- Modify: `src/lib/documentAnalysisPipeline.ts` (função `baixarEAnalisarArquivo`, linhas ~162-194)

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: `analisarDocumentoComOpenAi` passa a devolver `{ provider, model, resultado, textoExtraido: string | null, paginas: number | null }`; `baixarEAnalisarArquivo` devolve o mesmo objeto acrescido de `arquivoHash: string`. Consumidos pela Task 6.

- [ ] **Step 1: Fazer a extração de OCR devolver texto e contagem de páginas**

Em `src/lib/openAiDocumentAnalysis.ts`, a função `extrairTextoComDocumentIntelligence` hoje devolve `string`. Localizar o bloco que trata o resultado concluído — onde estão `const content = result.analyzeResult?.content?.trim();` e o fallback que junta `pages[].lines[].content` — e alterar os retornos para devolver também a contagem de páginas.

Trocar o tipo de retorno da função para `Promise<{ texto: string; paginas: number | null }>` e, no bloco de sucesso, usar:

```ts
      const paginas = result.analyzeResult?.pages?.length ?? null;
      const content = result.analyzeResult?.content?.trim();
      if (content) {
        return { texto: content, paginas };
      }

      const linhas = (result.analyzeResult?.pages ?? [])
        .flatMap((page) => page.lines ?? [])
        .map((line) => line.content)
        .filter((valor): valor is string => Boolean(valor && valor.trim()));

      if (linhas.length === 0) {
        throw new Error("OCR concluido, mas nenhum texto foi extraido.");
      }

      return { texto: linhas.join("\n"), paginas };
```

(As linhas exatas do fallback já existem no arquivo; a mudança é envolver os dois retornos no objeto e calcular `paginas` uma vez, antes deles.)

- [ ] **Step 2: Propagar o texto e as páginas no retorno da análise**

Ainda em `src/lib/openAiDocumentAnalysis.ts`, em `analisarDocumentoComOpenAi` (linha ~427):

```ts
export async function analisarDocumentoComOpenAi(
  input: AnalyzeInput,
): Promise<{
  provider: string;
  model: string;
  resultado: DocumentoAnaliseIa;
  textoExtraido: string | null;
  paginas: number | null;
}> {
  const { apiKey, deployment, url } = getAzureOpenAiConfig();
  const extraido =
    input.mimeType === "application/pdf"
      ? await extrairTextoComDocumentIntelligence(input)
      : null;
  const textoExtraido = extraido?.texto ?? null;
  const filePart = textoExtraido ? null : resolveAzureContentPart(input);
```

O restante do corpo continua igual (todas as referências existentes a `textoExtraido` seguem funcionando). No `return` final:

```ts
  return {
    provider: "azure-openai",
    model: deployment,
    resultado: parseJsonObject(extractAzureOutputText(raw)),
    textoExtraido,
    paginas: extraido?.paginas ?? null,
  };
```

- [ ] **Step 3: Calcular o hash do arquivo em `baixarEAnalisarArquivo`**

Em `src/lib/documentAnalysisPipeline.ts`, adicionar o import no topo do arquivo:

```ts
import { createHash } from "node:crypto";
```

E, em `baixarEAnalisarArquivo`, substituir o `return` final por:

```ts
  const bytes = await fileBlob.arrayBuffer();
  const arquivoHash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");

  const analise = await analisarDocumentoComOpenAi({
    fileName: resolveFileName(params.path),
    mimeType,
    bytes,
    dadosAtuais: params.dadosAtuais ?? null,
    tipoDocumento: params.tipoDocumento,
  });

  return { ...analise, arquivoHash };
```

- [ ] **Step 4: Atualizar os mocks existentes no teste do pipeline**

Tornar o retorno mais rico **quebra a tipagem dos mocks já existentes**:
`src/lib/documentAnalysisPipeline.test.ts` tem 10 chamadas
`vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({ provider, model, resultado })`
que passam a faltar `textoExtraido` e `paginas`. Isso é erro de compilação,
não opcional.

Adicionar um helper logo abaixo de `resultadoBase` (por volta da linha 34):

```ts
function analiseBase(
  overrides: Partial<Awaited<ReturnType<typeof analisarDocumentoComOpenAi>>> = {},
) {
  return {
    provider: "azure-openai",
    model: "gpt-5-chat",
    resultado: resultadoBase(),
    textoExtraido: "texto extraido do documento",
    paginas: 1,
    ...overrides,
  };
}
```

Depois, trocar cada literal pelo helper, preservando o `resultado` que aquele
teste já usava. Exemplo da substituição:

```ts
// antes
vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
  provider: "azure-openai",
  model: "gpt-5-chat",
  resultado: resultadoBase({ tipo_documento: "registro_laudos" }),
});

// depois
vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce(
  analiseBase({ resultado: resultadoBase({ tipo_documento: "registro_laudos" }) }),
);
```

`arquivoHash` **não** entra nesse helper: ele é calculado em
`baixarEAnalisarArquivo` (a partir do blob baixado do fake), não devolvido por
`analisarDocumentoComOpenAi`.

- [ ] **Step 5: Verificar que nada quebrou**

Run: `npx tsc --noEmit && npm test`
Expected: sem erros de tipo; suíte inteira verde, incluindo os 69 testes de
`documentAnalysisPipeline.test.ts`. As mudanças em produção são aditivas —
quem consome `resultado`, `provider` e `model` não é afetado.

- [ ] **Step 6: Commit**

```bash
git add src/lib/openAiDocumentAnalysis.ts src/lib/documentAnalysisPipeline.ts src/lib/documentAnalysisPipeline.test.ts
git commit -m "feat: expoe texto do OCR, paginas e hash do arquivo na analise"
```

---

### Task 5: Orquestração da indexação (`documentoIndexacao.ts`)

**Files:**
- Create: `src/lib/documentoIndexacao.ts`
- Test: `src/lib/documentoIndexacao.test.ts`

**Interfaces:**
- Consumes: `dividirEmChunks`, `DocumentoChunk` (Task 2); `gerarEmbeddings` (Task 3).
- Produces: `indexarConteudoDocumento(supabaseAdmin, params: IndexarConteudoParams): Promise<ResultadoIndexacao>` com `IndexarConteudoParams = { documentoId, texto, origem, paginas, arquivoHash, metadados }` e `ResultadoIndexacao = { status: "indexado" | "pulado" | "erro"; chunks: number; detalhe?: string }` — consumidos pela Task 6 (pipeline) e pela Task 7 (backfill).

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/lib/documentoIndexacao.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/embeddings", () => ({
  gerarEmbeddings: vi.fn(async (textos: string[]) =>
    textos.map((_, indice) => [indice, 0.1]),
  ),
  EMBEDDING_DIMENSOES: 1536,
  EMBEDDING_LOTE_MAX: 16,
}));

import { gerarEmbeddings } from "@/lib/embeddings";
import { indexarConteudoDocumento } from "@/lib/documentoIndexacao";

const mockedEmbeddings = vi.mocked(gerarEmbeddings);

type Chamada = { tabela: string; metodo: string; payload?: unknown };

function makeSupabase(conteudoExistente: Record<string, unknown> | null = null) {
  const chamadas: Chamada[] = [];
  const supabase = {
    from(tabela: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              chamadas.push({ tabela, metodo: "select" });
              return { data: conteudoExistente, error: null };
            },
          }),
        }),
        upsert: async (payload: unknown) => {
          chamadas.push({ tabela, metodo: "upsert", payload });
          return { error: null };
        },
        update: (payload: unknown) => ({
          eq: async () => {
            chamadas.push({ tabela, metodo: "update", payload });
            return { error: null };
          },
        }),
        delete: () => ({
          eq: async () => {
            chamadas.push({ tabela, metodo: "delete" });
            return { error: null };
          },
        }),
        insert: async (payload: unknown) => {
          chamadas.push({ tabela, metodo: "insert", payload });
          return { error: null };
        },
      };
    },
  };
  return { supabase, chamadas };
}

const metadados = {
  lojaId: "loja-1",
  tipo: "registro_laudos",
  competencia: "03/2026",
  equipamentoId: "equip-1",
  prestadorId: "prest-1",
  documentoCreatedAt: "2026-03-10T00:00:00.000Z",
};

const textoLongo = `${"gerador ".repeat(40)}\n\n${"alternador ".repeat(40)}`;

beforeEach(() => {
  mockedEmbeddings.mockClear();
});

describe("indexarConteudoDocumento", () => {
  it("grava conteudo, chunks e marca indexado_em", async () => {
    const { supabase, chamadas } = makeSupabase();

    const resultado = await indexarConteudoDocumento(supabase as never, {
      documentoId: "doc-1",
      texto: textoLongo,
      origem: "ocr",
      paginas: 3,
      arquivoHash: "hash-1",
      metadados,
    });

    expect(resultado.status).toBe("indexado");
    expect(resultado.chunks).toBeGreaterThan(0);

    const upsertConteudo = chamadas.find(
      (c) => c.tabela === "documento_conteudo" && c.metodo === "upsert",
    );
    expect(upsertConteudo?.payload).toMatchObject({
      documento_id: "doc-1",
      origem: "ocr",
      paginas: 3,
      arquivo_hash: "hash-1",
    });

    const insertChunks = chamadas.find(
      (c) => c.tabela === "documento_chunks" && c.metodo === "insert",
    );
    const linhas = insertChunks?.payload as Array<Record<string, unknown>>;
    expect(linhas.length).toBe(resultado.chunks);
    expect(linhas[0]).toMatchObject({
      documento_id: "doc-1",
      ordem: 0,
      loja_id: "loja-1",
      tipo: "registro_laudos",
      competencia: "03/2026",
      equipamento_id: "equip-1",
    });
    // pgvector recebe o vetor no formato textual "[1,2,3]"
    expect(typeof linhas[0].embedding).toBe("string");
    expect(linhas[0].embedding).toBe("[0,0.1]");
  });

  it("apaga os chunks antigos antes de gravar os novos", async () => {
    const { supabase, chamadas } = makeSupabase();
    await indexarConteudoDocumento(supabase as never, {
      documentoId: "doc-1",
      texto: textoLongo,
      origem: "ocr",
      paginas: null,
      arquivoHash: null,
      metadados,
    });

    const ordemChunks = chamadas
      .filter((c) => c.tabela === "documento_chunks")
      .map((c) => c.metodo);
    expect(ordemChunks).toEqual(["delete", "insert"]);
  });

  it("pula quando o hash do arquivo e igual ao ja indexado", async () => {
    const { supabase, chamadas } = makeSupabase({
      arquivo_hash: "hash-1",
      indexado_em: "2026-03-01T00:00:00.000Z",
    });

    const resultado = await indexarConteudoDocumento(supabase as never, {
      documentoId: "doc-1",
      texto: textoLongo,
      origem: "ocr",
      paginas: null,
      arquivoHash: "hash-1",
      metadados,
    });

    expect(resultado).toEqual({ status: "pulado", chunks: 0, detalhe: "hash_igual" });
    expect(mockedEmbeddings).not.toHaveBeenCalled();
    expect(chamadas.some((c) => c.metodo === "insert")).toBe(false);
  });

  it("reindexa quando o hash mudou", async () => {
    const { supabase } = makeSupabase({
      arquivo_hash: "hash-antigo",
      indexado_em: "2026-03-01T00:00:00.000Z",
    });

    const resultado = await indexarConteudoDocumento(supabase as never, {
      documentoId: "doc-1",
      texto: textoLongo,
      origem: "ocr",
      paginas: null,
      arquivoHash: "hash-novo",
      metadados,
    });

    expect(resultado.status).toBe("indexado");
    expect(mockedEmbeddings).toHaveBeenCalled();
  });

  it("registra origem nao_aplicavel quando nao ha texto", async () => {
    const { supabase, chamadas } = makeSupabase();

    const resultado = await indexarConteudoDocumento(supabase as never, {
      documentoId: "doc-1",
      texto: null,
      origem: "nao_aplicavel",
      paginas: null,
      arquivoHash: "hash-1",
      metadados,
    });

    expect(resultado).toEqual({ status: "pulado", chunks: 0, detalhe: "sem_texto" });
    expect(mockedEmbeddings).not.toHaveBeenCalled();
    const upsert = chamadas.find((c) => c.metodo === "upsert");
    expect(upsert?.payload).toMatchObject({ origem: "nao_aplicavel" });
  });

  it("nao lanca quando o embedding falha: registra o erro e devolve status erro", async () => {
    mockedEmbeddings.mockRejectedValueOnce(new Error("Azure fora do ar"));
    const { supabase, chamadas } = makeSupabase();

    const resultado = await indexarConteudoDocumento(supabase as never, {
      documentoId: "doc-1",
      texto: textoLongo,
      origem: "ocr",
      paginas: null,
      arquivoHash: "hash-1",
      metadados,
    });

    expect(resultado.status).toBe("erro");
    expect(resultado.detalhe).toContain("Azure fora do ar");
    const update = chamadas.find(
      (c) => c.tabela === "documento_conteudo" && c.metodo === "update",
    );
    expect(update?.payload).toMatchObject({ erro: expect.stringContaining("Azure fora do ar") });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/documentoIndexacao.test.ts`
Expected: FAIL — `Cannot find module '@/lib/documentoIndexacao'`.

- [ ] **Step 3: Implementar `documentoIndexacao.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { dividirEmChunks } from "@/lib/documentoChunking";
import { gerarEmbeddings } from "@/lib/embeddings";

export type OrigemConteudo = "ocr" | "pdf_texto" | "nao_aplicavel";

export type MetadadosIndexacao = {
  lojaId: string | null;
  tipo: string | null;
  competencia: string | null;
  equipamentoId: string | null;
  prestadorId: string | null;
  documentoCreatedAt: string | null;
};

export type IndexarConteudoParams = {
  documentoId: string;
  texto: string | null;
  origem: OrigemConteudo;
  paginas: number | null;
  arquivoHash: string | null;
  metadados: MetadadosIndexacao;
};

export type ResultadoIndexacao = {
  status: "indexado" | "pulado" | "erro";
  chunks: number;
  detalhe?: string;
};

/** pgvector aceita o vetor no formato textual "[1,2,3]". */
const paraVetorPg = (embedding: number[]) => JSON.stringify(embedding);

async function registrarErro(
  supabaseAdmin: SupabaseClient,
  documentoId: string,
  mensagem: string,
) {
  try {
    await supabaseAdmin
      .from("documento_conteudo")
      .update({ erro: mensagem, updated_at: new Date().toISOString() })
      .eq("documento_id", documentoId);
  } catch (err) {
    console.error("[indexarConteudoDocumento] Falha ao registrar erro:", err);
  }
}

/**
 * Persiste o texto do documento, divide em trechos e grava os embeddings.
 * Nunca lanca: a indexacao e aditiva e nao pode derrubar upload nem analise.
 */
export async function indexarConteudoDocumento(
  supabaseAdmin: SupabaseClient,
  params: IndexarConteudoParams,
): Promise<ResultadoIndexacao> {
  const agora = new Date().toISOString();
  const texto = params.texto?.trim() ?? "";

  try {
    if (!texto) {
      await supabaseAdmin.from("documento_conteudo").upsert({
        documento_id: params.documentoId,
        texto: "",
        origem: "nao_aplicavel",
        paginas: params.paginas,
        arquivo_hash: params.arquivoHash,
        caracteres: 0,
        indexado_em: null,
        erro: "Sem texto extraido para indexar.",
        updated_at: agora,
      });
      return { status: "pulado", chunks: 0, detalhe: "sem_texto" };
    }

    const { data: existente } = await supabaseAdmin
      .from("documento_conteudo")
      .select("arquivo_hash,indexado_em")
      .eq("documento_id", params.documentoId)
      .maybeSingle();

    const jaIndexado = Boolean(
      existente?.indexado_em &&
        params.arquivoHash &&
        existente?.arquivo_hash === params.arquivoHash,
    );
    if (jaIndexado) {
      return { status: "pulado", chunks: 0, detalhe: "hash_igual" };
    }

    await supabaseAdmin.from("documento_conteudo").upsert({
      documento_id: params.documentoId,
      texto,
      origem: params.origem,
      paginas: params.paginas,
      arquivo_hash: params.arquivoHash,
      caracteres: texto.length,
      indexado_em: null,
      erro: null,
      updated_at: agora,
    });

    const chunks = dividirEmChunks(texto);
    if (chunks.length === 0) {
      await registrarErro(
        supabaseAdmin,
        params.documentoId,
        "Texto extraido nao gerou nenhum trecho indexavel.",
      );
      return { status: "pulado", chunks: 0, detalhe: "sem_chunks" };
    }

    const embeddings = await gerarEmbeddings(chunks.map((chunk) => chunk.texto));

    await supabaseAdmin
      .from("documento_chunks")
      .delete()
      .eq("documento_id", params.documentoId);

    await supabaseAdmin.from("documento_chunks").insert(
      chunks.map((chunk, indice) => ({
        documento_id: params.documentoId,
        ordem: chunk.ordem,
        pagina: chunk.pagina,
        texto: chunk.texto,
        embedding: paraVetorPg(embeddings[indice] ?? []),
        loja_id: params.metadados.lojaId,
        tipo: params.metadados.tipo,
        competencia: params.metadados.competencia,
        equipamento_id: params.metadados.equipamentoId,
        prestador_id: params.metadados.prestadorId,
        documento_created_at: params.metadados.documentoCreatedAt,
      })),
    );

    await supabaseAdmin
      .from("documento_conteudo")
      .update({ indexado_em: new Date().toISOString(), erro: null })
      .eq("documento_id", params.documentoId);

    return { status: "indexado", chunks: chunks.length };
  } catch (err) {
    const mensagem =
      err instanceof Error ? err.message : "Falha desconhecida na indexacao.";
    console.error("[indexarConteudoDocumento] Falha:", err);
    await registrarErro(supabaseAdmin, params.documentoId, mensagem);
    return { status: "erro", chunks: 0, detalhe: mensagem };
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/documentoIndexacao.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentoIndexacao.ts src/lib/documentoIndexacao.test.ts
git commit -m "feat: adiciona orquestracao de indexacao de conteudo dos documentos"
```

---

### Task 6: Ligar a indexação ao pipeline de análise

**Files:**
- Modify: `src/lib/documentAnalysisPipeline.ts` (função `processarDocumentoComIa`)
- Test: `src/lib/documentAnalysisPipeline.test.ts` (arquivo já existe — acrescentar casos)

**Interfaces:**
- Consumes: `indexarConteudoDocumento` (Task 5); `textoExtraido`, `paginas`, `arquivoHash` (Task 4).

- [ ] **Step 1: Escrever os testes (falhando)**

Em `src/lib/documentAnalysisPipeline.test.ts`, acrescentar o mock do módulo de
indexação junto aos `vi.mock` que já existem no topo do arquivo (o módulo é
mockado inteiro: o objetivo aqui é verificar o **contrato do pipeline**, não a
indexação em si, que já tem testes próprios na Task 5):

```ts
vi.mock("@/lib/documentoIndexacao", () => ({
  indexarConteudoDocumento: vi.fn(async () => ({ status: "indexado", chunks: 3 })),
}));
```

E adicionar ao import block existente:

```ts
import { indexarConteudoDocumento } from "@/lib/documentoIndexacao";
```

Depois, acrescentar os dois testes dentro do `describe("processarDocumentoComIa", ...)`:

```ts
  it("indexa o conteudo ao final do processamento bem-sucedido", async () => {
    vi.mocked(indexarConteudoDocumento).mockClear();
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce(
      analiseBase({ textoExtraido: "laudo do grupo gerador da matriz", paginas: 2 }),
    );

    const { supabase } = criarSupabaseFake({
      registro: {
        id: "doc-idx",
        tipo: "notas_fiscais",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/nota.pdf",
        arquivo_assinado_path: null,
        prestador_id: "prest-1",
        created_at: "2026-07-10T00:00:00.000Z",
      },
    });

    await processarDocumentoComIa(supabase, "doc-idx");

    expect(indexarConteudoDocumento).toHaveBeenCalledTimes(1);
    const [, params] = vi.mocked(indexarConteudoDocumento).mock.calls[0];
    expect(params).toMatchObject({
      documentoId: "doc-idx",
      texto: "laudo do grupo gerador da matriz",
      origem: "ocr",
      paginas: 2,
      metadados: expect.objectContaining({
        lojaId: "loja-1",
        tipo: "notas_fiscais",
        competencia: "07/2026",
        prestadorId: "prest-1",
      }),
    });
    expect(typeof params.arquivoHash).toBe("string");
  });

  it("falha na indexacao nao altera o status final da analise", async () => {
    vi.mocked(indexarConteudoDocumento).mockClear();
    vi.mocked(indexarConteudoDocumento).mockRejectedValueOnce(
      new Error("pgvector fora do ar"),
    );
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce(analiseBase());

    const { supabase, updates } = criarSupabaseFake({
      registro: {
        id: "doc-idx-erro",
        tipo: "notas_fiscais",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/nota.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
        created_at: "2026-07-10T00:00:00.000Z",
      },
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-idx-erro");

    expect(resultado.status).toBe("concluida");
    expect(updates.map((u) => u.payload.status_analise_ia)).toEqual([
      "em_analise",
      "concluida",
    ]);
  });
```

O segundo teste é o que protege a restrição global mais importante deste
plano: a indexação é aditiva e não pode derrubar o fluxo existente. Ele falha
se alguém remover o `try/catch` do Step 3.

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/documentAnalysisPipeline.test.ts`
Expected: FAIL — a indexação ainda não é chamada.

- [ ] **Step 3: Chamar a indexação no pipeline**

Em `src/lib/documentAnalysisPipeline.ts`:

Adicionar o import:

```ts
import { indexarConteudoDocumento } from "@/lib/documentoIndexacao";
```

Incluir `created_at` no `select` de `formularios` dentro de `processarDocumentoComIa` (hoje: `"id,tipo,dados,arquivo_path,arquivo_assinado_path,prestador_id,equipamento_id"`):

```ts
      .select("id,tipo,dados,arquivo_path,arquivo_assinado_path,prestador_id,equipamento_id,created_at")
```

E, logo depois do `await supabaseAdmin.from("formularios").update(updatePayload).eq("id", row.id);` e antes do `return { status: statusFinal };`, acrescentar o bloco best-effort — mesmo padrão já usado para `registrarRecomendacoesCriticas`:

```ts
    try {
      await indexarConteudoDocumento(supabaseAdmin, {
        documentoId: row.id,
        texto: analise.textoExtraido,
        origem: analise.textoExtraido ? "ocr" : "nao_aplicavel",
        paginas: analise.paginas,
        arquivoHash: analise.arquivoHash,
        metadados: {
          lojaId,
          tipo: row.tipo,
          competencia,
          equipamentoId,
          prestadorId: row.prestador_id ?? null,
          documentoCreatedAt: row.created_at ?? null,
        },
      });
    } catch (err) {
      // Best-effort: indexacao e aditiva e nao pode derrubar a analise.
      console.error("[processarDocumentoComIa] Falha ao indexar conteudo:", err);
    }
```

`analise` é o objeto devolvido por `baixarEAnalisarArquivo`; conferir no arquivo o nome da variável local que o recebe e usar o mesmo. `lojaId`, `competencia` e `equipamentoId` já existem no escopo dessa função.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/documentAnalysisPipeline.test.ts && npm test`
Expected: PASS — inclusive os 69 testes que já existiam no arquivo.

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentAnalysisPipeline.ts src/lib/documentAnalysisPipeline.test.ts
git commit -m "feat: indexa conteudo do documento ao final da analise por IA"
```

---

### Task 7: Endpoint de backfill do acervo

**Files:**
- Create: `src/app/api/documentos/indexacao/backfill/route.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `indexarConteudoDocumento` (Task 5), `baixarEAnalisarArquivo` (Task 4).

- [ ] **Step 1: Implementar o endpoint**

```ts
// src/app/api/documentos/indexacao/backfill/route.ts
import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { baixarEAnalisarArquivo } from "@/lib/documentAnalysisPipeline";
import { indexarConteudoDocumento } from "@/lib/documentoIndexacao";
import { safeParseDados } from "@/lib/documentosApiUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE_PADRAO = 25;
const LIMITE_MAX = 100;

type FormularioRow = {
  id: string;
  tipo: string;
  dados: Record<string, unknown> | string | null;
  arquivo_path: string | null;
  arquivo_assinado_path: string | null;
  prestador_id: string | null;
  equipamento_id: string | null;
  created_at: string;
};

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    if (!actor.isAdmin) {
      throw new HttpError(403, "Backfill de indexacao e restrito a administradores.");
    }

    const body = (await request.json().catch(() => ({}))) as {
      limite?: number;
      antesDe?: string;
    };

    const limiteBruto = Number(body.limite);
    const limite = Number.isFinite(limiteBruto)
      ? Math.min(Math.max(Math.trunc(limiteBruto), 1), LIMITE_MAX)
      : LIMITE_PADRAO;

    // Teto diario protege o custo de OCR (cobrado por pagina).
    const limiteDiario = Number(process.env.INDEXACAO_LIMITE_DIARIO ?? "");
    if (Number.isFinite(limiteDiario) && limiteDiario > 0) {
      const inicioDoDia = new Date();
      inicioDoDia.setUTCHours(0, 0, 0, 0);
      const { count } = await supabaseAdmin
        .from("documento_conteudo")
        .select("documento_id", { count: "exact", head: true })
        .gte("indexado_em", inicioDoDia.toISOString());
      if ((count ?? 0) >= limiteDiario) {
        return NextResponse.json({
          processados: 0,
          indexados: 0,
          pulados: 0,
          erros: 0,
          limiteDiarioAtingido: true,
          proximoAntesDe: body.antesDe ?? null,
        });
      }
    }

    let query = supabaseAdmin
      .from("formularios")
      .select(
        "id,tipo,dados,arquivo_path,arquivo_assinado_path,prestador_id,equipamento_id,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limite * 4);

    if (body.antesDe) {
      query = query.lt("created_at", body.antesDe);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const candidatos = (data as FormularioRow[] | null) ?? [];
    if (candidatos.length === 0) {
      return NextResponse.json({
        processados: 0,
        indexados: 0,
        pulados: 0,
        erros: 0,
        concluido: true,
        proximoAntesDe: null,
      });
    }

    const { data: jaIndexados, error: erroIndexados } = await supabaseAdmin
      .from("documento_conteudo")
      .select("documento_id")
      .in(
        "documento_id",
        candidatos.map((row) => row.id),
      )
      .not("indexado_em", "is", null);
    if (erroIndexados) {
      throw erroIndexados;
    }

    const indexadosSet = new Set(
      ((jaIndexados as { documento_id: string }[] | null) ?? []).map(
        (row) => row.documento_id,
      ),
    );

    const pendentes = candidatos
      .filter((row) => !indexadosSet.has(row.id))
      .slice(0, limite);

    let indexados = 0;
    let pulados = 0;
    let erros = 0;

    // Sequencial de proposito: OCR e lento e cobrado por pagina; paralelizar
    // aqui multiplicaria custo e risco de throttling no Azure.
    for (const row of pendentes) {
      const path = row.arquivo_assinado_path ?? row.arquivo_path;
      const dados = safeParseDados(row.dados);
      const metadados = {
        lojaId: typeof dados?.loja_id === "string" ? dados.loja_id : null,
        tipo: row.tipo,
        competencia:
          typeof dados?.competencia === "string" ? dados.competencia : null,
        equipamentoId: row.equipamento_id,
        prestadorId: row.prestador_id,
        documentoCreatedAt: row.created_at,
      };

      if (!path) {
        await indexarConteudoDocumento(supabaseAdmin, {
          documentoId: row.id,
          texto: null,
          origem: "nao_aplicavel",
          paginas: null,
          arquivoHash: null,
          metadados,
        });
        pulados += 1;
        continue;
      }

      try {
        const analise = await baixarEAnalisarArquivo(supabaseAdmin, {
          path,
          tipoDocumento: row.tipo,
          dadosAtuais: dados,
        });

        const resultado = await indexarConteudoDocumento(supabaseAdmin, {
          documentoId: row.id,
          texto: analise.textoExtraido,
          origem: analise.textoExtraido ? "ocr" : "nao_aplicavel",
          paginas: analise.paginas,
          arquivoHash: analise.arquivoHash,
          metadados,
        });

        if (resultado.status === "indexado") indexados += 1;
        else if (resultado.status === "pulado") pulados += 1;
        else erros += 1;
      } catch (err) {
        console.error("[backfill] Falha ao indexar documento:", row.id, err);
        erros += 1;
      }
    }

    const proximoAntesDe =
      candidatos.length > 0 ? candidatos[candidatos.length - 1].created_at : null;

    return NextResponse.json({
      processados: pendentes.length,
      indexados,
      pulados,
      erros,
      concluido: false,
      proximoAntesDe,
    });
  } catch (err) {
    console.error("Erro no backfill de indexacao:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel executar o backfill.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

Nota sobre o cursor: `proximoAntesDe` é o `created_at` do último **candidato** da janela (não do último pendente), para que a próxima chamada continue de onde a janela terminou mesmo quando todos os candidatos já estavam indexados. É isso que garante progresso e retomada.

- [ ] **Step 2: Documentar a variável de teto diário**

Em `.env.example`, junto ao bloco de embeddings acrescentado na Task 3:

```
# Teto diario de documentos indexados pelo backfill (protege custo de OCR)
INDEXACAO_LIMITE_DIARIO=
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm test`
Expected: sem erros de tipo; suíte verde.

Verificação manual: `npm run dev` e, sem header de autorização,
`curl -s -X POST http://localhost:3000/api/documentos/indexacao/backfill`
deve responder 401. Não é necessário exercitar o caminho autenticado (exige
sessão real e credenciais Supabase); o comportamento com dados é coberto
pelos testes de `documentoIndexacao`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/documentos/indexacao/backfill/route.ts .env.example
git commit -m "feat: adiciona endpoint de backfill da indexacao de documentos"
```

---

## Self-Review

**Cobertura da spec (Fase 1):**
- `documento_conteudo` e `documento_chunks` com colunas desnormalizadas, RLS e revoke → Task 1 ✅
- Chunking (~1000 chars, ~150 de sobreposição, descarte de fragmento curto, quebra por parágrafo→sentença→corte duro) → Task 2 ✅
- `src/lib/embeddings.ts` isolado atrás de `gerarEmbeddings`, com lote e retry; variáveis novas → Task 3 ✅
- `analisarDocumentoComOpenAi` devolvendo o texto extraído; hash do arquivo → Task 4 ✅
- Etapa de indexação em `processarDocumentoComIa`, best-effort → Tasks 5 e 6 ✅
- Backfill em lotes, com teto diário e retomada → Task 7 ✅
- Não-regressão (falha de indexação não derruba análise) → Task 6, Step 1, segundo teste ✅

**Divergências conscientes da spec**, documentadas na seção "Decisões deste plano": HNSW no lugar de `ivfflat`; `pagina` sempre `null` nesta fase (contagem de páginas é preenchida); somente PDF é indexado; `origem = 'pdf_texto'` permanece no `check` mas não é produzido.

**Consistência de tipos:** `DocumentoChunk` (Task 2) é consumido em `documentoIndexacao.ts` (Task 5) com os mesmos campos `ordem`/`texto`/`pagina`; `gerarEmbeddings` (Task 3) devolve `number[][]`, convertido para o formato textual do pgvector na Task 5; `analisarDocumentoComOpenAi` e `baixarEAnalisarArquivo` (Task 4) produzem `textoExtraido`/`paginas`/`arquivoHash`, consumidos com esses nomes exatos nas Tasks 6 e 7; `indexarConteudoDocumento` tem a mesma assinatura nas Tasks 5, 6 e 7.

**Fora do escopo desta fase (confirmado):** nenhuma busca muda; `buscar_documentos`, `queryDocumentoCandidates` e `buildDocumentosTextSearchOr` não são tocados. A taxonomia, a busca híbrida e as consultas analíticas ficam nas fases 2, 3 e 4.
