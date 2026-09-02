import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buscarDocumentosConteudo,
  RECORTE_MAX_DOCUMENTOS,
} from "@/lib/documentosRecuperacao";
import type { ConsultaInterpretada } from "@/lib/documentosInterpretacao";

vi.mock("@/lib/embeddings", () => ({
  gerarEmbeddings: vi.fn(async () => [Array(1536).fill(0.01)]),
}));
vi.mock("@/lib/azureOpenAi", () => ({
  callAzureOpenAiChat: vi.fn(async () => ({
    content: JSON.stringify([
      { documentoId: "doc-1", justificativa: "Laudo direto sobre o gerador" },
    ]),
    toolCalls: [],
  })),
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
  filterPrestadores: [],
  filterLojas: [],
};

function makeSupabase(docIds: string[], rpcRows: Record<string, unknown>[]) {
  function makeChain(resolveWith: unknown) {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = self;
    chain.eq = self;
    chain.filter = self;
    chain.or = self;
    chain.limit = self;
    chain.in = self;
    chain.order = self;
    chain.maybeSingle = self;
    chain.then = (resolve: (v: unknown) => void) => resolve(resolveWith);
    return chain;
  }

  return {
    from: (table: string) => {
      // Taxonomy tables return empty data (expansion is best-effort)
      if (table === "taxonomia_termos" || table === "taxonomia_sinonimos") {
        return makeChain({ data: null, error: null });
      }
      return makeChain({ data: docIds.map((id) => ({ id })), error: null });
    },
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
      ],
    );

    const resultado = await buscarDocumentosConteudo(
      paramsBase,
      supabase as never,
      "laudo do gerador da Matriz",
    );

    expect(supabase.rpc).toHaveBeenCalledWith(
      "buscar_chunks_hibrido",
      expect.objectContaining({ p_documento_ids: ["doc-1", "doc-2"] }),
    );
    expect(resultado.documentos).toHaveLength(1);
    expect(resultado.documentos[0].documentoId).toBe("doc-1");
    expect(resultado.recorteExcedido).toBe(false);
  });

  it("sinaliza recorteExcedido quando o allowlist ultrapassa o teto", async () => {
    const manyIds = Array.from(
      { length: RECORTE_MAX_DOCUMENTOS + 1 },
      (_, i) => `doc-${i}`,
    );
    const supabase = makeSupabase(manyIds, []);

    const resultado = await buscarDocumentosConteudo(
      { ...paramsBase, consulta: { ...consultaBase, tipo: undefined } },
      supabase as never,
      "algo",
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
      "nada",
    );

    expect(resultado.documentos).toHaveLength(0);
    expect(resultado.confianca).toBe("baixa");
  });

  it("lanca erro quando a rpc retorna error", async () => {
    function makeChain(resolveWith: unknown) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = self;
      chain.filter = self;
      chain.or = self;
      chain.limit = self;
      chain.in = self;
      chain.order = self;
      chain.maybeSingle = self;
      chain.then = (resolve: (v: unknown) => void) => resolve(resolveWith);
      return chain;
    }

    const supabase = {
      from: (table: string) => {
        if (table === "taxonomia_termos" || table === "taxonomia_sinonimos") {
          return makeChain({ data: null, error: null });
        }
        return makeChain({ data: [{ id: "doc-1" }], error: null });
      },
      rpc: vi.fn(async () => ({
        data: null,
        error: new Error("pgvector offline"),
      })),
    };

    await expect(
      buscarDocumentosConteudo(paramsBase, supabase as never, "teste"),
    ).rejects.toThrow("pgvector offline");
  });

  it("define confianca alta quando melhor resultado se destaca claramente", async () => {
    const supabase = makeSupabase(
      ["doc-1", "doc-2"],
      [
        {
          documento_id: "doc-1",
          rrf_score: 0.09,
          melhor_trecho: "trecho 1",
          pagina: 1,
          n_trechos_relevantes: 3,
        },
        {
          documento_id: "doc-2",
          rrf_score: 0.04,
          melhor_trecho: "trecho 2",
          pagina: 2,
          n_trechos_relevantes: 1,
        },
      ],
    );

    const resultado = await buscarDocumentosConteudo(
      paramsBase,
      supabase as never,
      "pergunta",
    );

    expect(resultado.confianca).toBe("alta"); // doc-1 score > 2x doc-2 score
  });

  it("retorna lista vazia com confianca baixa quando Stage 1 nao encontra documentos", async () => {
    const supabase = makeSupabase([], []); // Stage 1 returns no IDs

    const resultado = await buscarDocumentosConteudo(
      paramsBase,
      supabase as never,
      "qualquer"
    );

    expect(resultado.documentos).toHaveLength(0);
    expect(resultado.confianca).toBe("baixa");
    expect(resultado.recorteExcedido).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled(); // RPC not called when no IDs
  });

  it("nao quebra quando assunto esta definido e taxonomia retorna vazio", async () => {
    const supabase = makeSupabase(
      ["doc-1"],
      [
        {
          documento_id: "doc-1",
          rrf_score: 0.07,
          melhor_trecho: "trecho",
          pagina: 1,
          n_trechos_relevantes: 1,
        },
      ],
    );

    await expect(
      buscarDocumentosConteudo(
        { ...paramsBase, consulta: { ...consultaBase, assunto: "gerador" } },
        supabase as never,
        "laudo do gerador",
      ),
    ).resolves.not.toThrow();
  });
});
