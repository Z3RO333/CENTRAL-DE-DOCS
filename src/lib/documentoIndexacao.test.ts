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
    // indexado_em deve ser um timestamp (nao null): documento sem texto e conclusivo,
    // nao pendente — null o manteria no conjunto de reprocessamento indefinidamente.
    expect(upsert?.payload).toMatchObject({
      origem: "nao_aplicavel",
      indexado_em: expect.any(String),
    });
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
