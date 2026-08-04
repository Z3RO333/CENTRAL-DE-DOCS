import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/openAiDocumentAnalysis", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/openAiDocumentAnalysis")
  >("@/lib/openAiDocumentAnalysis");
  return {
    ...actual,
    analisarDocumentoComOpenAi: vi.fn(),
  };
});

import {
  deveAnalisarAutomaticamente,
  determinarStatusFinal,
  resolveFileName,
  resolveMimeType,
  verificarSegredoWebhook,
  verificarDuplicado,
  baixarEAnalisarArquivo,
  registrarAnaliseIa,
  processarDocumentoComIa,
} from "@/lib/documentAnalysisPipeline";
import { analisarDocumentoComOpenAi } from "@/lib/openAiDocumentAnalysis";
import type { DocumentoAnaliseIa } from "@/lib/openAiDocumentAnalysis";
import type { SupabaseClient } from "@supabase/supabase-js";

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

function criarSupabaseFake(options: {
  registro: Record<string, unknown> | null;
  duplicado?: boolean;
  downloadOk?: boolean;
}) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  let selectCallCount = 0;

  const supabase = {
    from: (table: string) => {
      if (table === "formularios") {
        return {
          select: () => {
            selectCallCount += 1;
            const isInitialFetch = selectCallCount === 1;
            // O mesmo objeto de encadeamento atende tanto a busca inicial
            // (select().eq().maybeSingle()) quanto a checagem de duplicidade
            // do verificarDuplicado (select().eq()...eq().neq().limit().maybeSingle()).
            const chain: {
              eq: () => typeof chain;
              neq: () => typeof chain;
              limit: () => typeof chain;
              maybeSingle: () => Promise<{ data: unknown; error: null }>;
            } = {
              eq: () => chain,
              neq: () => chain,
              limit: () => chain,
              maybeSingle: async () =>
                isInitialFetch
                  ? { data: options.registro, error: null }
                  : {
                      data: options.duplicado ? { id: "doc-existente" } : null,
                      error: null,
                    },
            };
            return chain;
          },
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

  it("marca duplicado e nao chama a analise por IA quando ja existe documento concluido com a mesma chave", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockClear();

    const { supabase, updates } = criarSupabaseFake({
      registro: {
        id: "doc-3",
        tipo: "notas_fiscais",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/nota.pdf",
        arquivo_assinado_path: null,
        prestador_id: "prestador-1",
      },
      duplicado: true,
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-3");

    expect(resultado.status).toBe("duplicado");
    const statusGravados = updates.map((u) => u.payload.status_analise_ia);
    expect(statusGravados).toEqual(["duplicado"]);
    expect(analisarDocumentoComOpenAi).not.toHaveBeenCalled();
  });

  it("marca erro e nao chama a analise por IA quando o documento nao tem arquivo", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockClear();

    const { supabase, updates } = criarSupabaseFake({
      registro: {
        id: "doc-4",
        tipo: "notas_fiscais",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: null,
        arquivo_assinado_path: null,
        prestador_id: null,
      },
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-4");

    expect(resultado.status).toBe("erro");
    const statusGravados = updates.map((u) => u.payload.status_analise_ia);
    expect(statusGravados).toEqual(["em_analise", "erro"]);
    expect(analisarDocumentoComOpenAi).not.toHaveBeenCalled();
  });
});
