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
  registrarRecomendacoesCriticas,
  processarDocumentoComIa,
  buscarEquipamentosAtivosDaLoja,
  temAchadoUrgente,
  type EquipamentoAtivo,
} from "@/lib/documentAnalysisPipeline";
import { analisarDocumentoComOpenAi } from "@/lib/openAiDocumentAnalysis";
import type { DocumentoAnaliseIa, RecomendacaoCritica } from "@/lib/openAiDocumentAnalysis";
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
    equipamento_tipo: null,
    equipamento_identificacao: null,
    equipamento_numero_serie: null,
    recomendacoes_criticas: [],
    ...overrides,
  };
}

function recomendacaoCriticaBase(
  overrides: Partial<RecomendacaoCritica> = {},
): RecomendacaoCritica {
  return {
    trecho: "Equipamento apresenta ruido anormal.",
    pagina: 1,
    problema: "Ruido anormal no compressor.",
    componente: "Compressor",
    recomendacao_tecnica: "Inspecionar e lubrificar rolamentos do compressor.",
    prioridade: "moderada",
    prazo_dias: 7,
    impacto: "Risco de parada do equipamento.",
    acao_necessaria: "Agendar inspecao tecnica.",
    desligar_equipamento: false,
    substituir_peca: false,
    precisa_inspecao_presencial: true,
    abrir_ordem_corretiva: false,
    riscos: ["operacional"],
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

describe("buscarEquipamentosAtivosDaLoja", () => {
  it("retorna so os equipamentos ativos da loja", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: async () => ({
              data: [
                { id: "eq-1", tipo_equipamento: "Gerador", identificacao: "Gerador 01", numero_serie: "SN-1" },
              ],
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const equipamentos = await buscarEquipamentosAtivosDaLoja(supabase, "loja-1");
    expect(equipamentos).toEqual([
      { id: "eq-1", tipo_equipamento: "Gerador", identificacao: "Gerador 01", numero_serie: "SN-1" },
    ]);
  });

  it("propaga erro do supabase", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: null, error: new Error("falhou") }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(buscarEquipamentosAtivosDaLoja(supabase, "loja-1")).rejects.toThrow("falhou");
  });
});

describe("determinarStatusFinal com contexto de equipamento", () => {
  it("mantem comportamento antigo quando contexto nao e passado", () => {
    expect(determinarStatusFinal(resultadoBase())).toBe("concluida");
  });

  it("forca necessita_revisao quando equipamento e requerido mas nao foi resolvido", () => {
    const resultado = determinarStatusFinal(resultadoBase(), {
      equipamentoRequerido: true,
      equipamentoResolvido: false,
    });
    expect(resultado).toBe("necessita_revisao");
  });

  it("mantem concluida quando equipamento e requerido e foi resolvido", () => {
    const resultado = determinarStatusFinal(resultadoBase(), {
      equipamentoRequerido: true,
      equipamentoResolvido: true,
    });
    expect(resultado).toBe("concluida");
  });

  it("nao exige equipamento quando equipamentoRequerido e false", () => {
    const resultado = determinarStatusFinal(resultadoBase(), {
      equipamentoRequerido: false,
      equipamentoResolvido: false,
    });
    expect(resultado).toBe("concluida");
  });

  it("forca necessita_revisao quando ha achado urgente, mesmo com tudo resolvido", () => {
    const resultado = determinarStatusFinal(resultadoBase(), {
      equipamentoRequerido: true,
      equipamentoResolvido: true,
      achadoUrgente: true,
    });
    expect(resultado).toBe("necessita_revisao");
  });

  it("mantem concluida quando achadoUrgente e false e tudo mais resolvido", () => {
    const resultado = determinarStatusFinal(resultadoBase(), {
      equipamentoRequerido: true,
      equipamentoResolvido: true,
      achadoUrgente: false,
    });
    expect(resultado).toBe("concluida");
  });

  it("mantem comportamento quando achadoUrgente nao e informado", () => {
    const resultado = determinarStatusFinal(resultadoBase(), {
      equipamentoRequerido: false,
      equipamentoResolvido: false,
    });
    expect(resultado).toBe("concluida");
  });
});

describe("temAchadoUrgente", () => {
  it("retorna false quando nao ha recomendacoes_criticas", () => {
    expect(temAchadoUrgente(resultadoBase({ recomendacoes_criticas: [] }))).toBe(false);
  });

  it("retorna false quando so ha achados de prioridade baixa", () => {
    const resultado = resultadoBase({
      recomendacoes_criticas: [
        recomendacaoCriticaBase({ prioridade: "moderada" }),
        recomendacaoCriticaBase({ prioridade: "preventiva" }),
        recomendacaoCriticaBase({ prioridade: "informativa" }),
      ],
    });
    expect(temAchadoUrgente(resultado)).toBe(false);
  });

  it("retorna false para prioridade alta isolada", () => {
    const resultado = resultadoBase({
      recomendacoes_criticas: [recomendacaoCriticaBase({ prioridade: "alta" })],
    });
    expect(temAchadoUrgente(resultado)).toBe(false);
  });

  it("retorna true quando ha um achado critica", () => {
    const resultado = resultadoBase({
      recomendacoes_criticas: [
        recomendacaoCriticaBase({ prioridade: "moderada" }),
        recomendacaoCriticaBase({ prioridade: "critica" }),
      ],
    });
    expect(temAchadoUrgente(resultado)).toBe(true);
  });

  it("retorna true quando ha um achado emergencial", () => {
    const resultado = resultadoBase({
      recomendacoes_criticas: [recomendacaoCriticaBase({ prioridade: "emergencial" })],
    });
    expect(temAchadoUrgente(resultado)).toBe(true);
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

describe("registrarRecomendacoesCriticas", () => {
  it("nao chama insert quando nao ha achados", async () => {
    const insert = vi.fn();
    const supabase = { from: () => ({ insert }) } as unknown as SupabaseClient;

    await registrarRecomendacoesCriticas(supabase, {
      documentoId: "doc-1",
      equipamentoId: "eq-1",
      lojaId: "loja-1",
      tipoDocumento: "registro_laudos",
      competencia: "07/2026",
      achados: [],
    });

    expect(insert).not.toHaveBeenCalled();
  });

  it("insere uma linha por achado com equipamento_id e loja_id copiados do documento", async () => {
    const insert = vi.fn(async (_rows: unknown[]) => ({ error: null }));
    const supabase = { from: () => ({ insert }) } as unknown as SupabaseClient;

    await registrarRecomendacoesCriticas(supabase, {
      documentoId: "doc-1",
      equipamentoId: "eq-1",
      lojaId: "loja-1",
      tipoDocumento: "registro_laudos",
      competencia: "07/2026",
      achados: [
        recomendacaoCriticaBase({ prioridade: "critica" }),
        recomendacaoCriticaBase({ prioridade: "moderada" }),
      ],
    });

    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        documento_id: "doc-1",
        equipamento_id: "eq-1",
        loja_id: "loja-1",
        tipo_documento: "registro_laudos",
        competencia: "07/2026",
        prioridade: "critica",
      }),
    );
  });

  it("insere com equipamento_id null quando o documento nao tem equipamento resolvido", async () => {
    const insert = vi.fn(async (_rows: unknown[]) => ({ error: null }));
    const supabase = { from: () => ({ insert }) } as unknown as SupabaseClient;

    await registrarRecomendacoesCriticas(supabase, {
      documentoId: "doc-1",
      equipamentoId: null,
      lojaId: "loja-1",
      tipoDocumento: "notas_fiscais",
      competencia: "07/2026",
      achados: [recomendacaoCriticaBase()],
    });

    const rows = insert.mock.calls[0][0] as Array<{ equipamento_id: string | null }>;
    expect(rows[0].equipamento_id).toBeNull();
  });

  it("propaga erro do supabase", async () => {
    const insert = vi.fn(async () => ({ error: new Error("falhou") }));
    const supabase = { from: () => ({ insert }) } as unknown as SupabaseClient;

    await expect(
      registrarRecomendacoesCriticas(supabase, {
        documentoId: "doc-1",
        equipamentoId: null,
        lojaId: null,
        tipoDocumento: "notas_fiscais",
        competencia: null,
        achados: [recomendacaoCriticaBase()],
      }),
    ).rejects.toThrow("falhou");
  });
});

function criarSupabaseFake(options: {
  registro: Record<string, unknown> | null;
  duplicado?: boolean;
  downloadOk?: boolean;
  equipamentosAtivos?: EquipamentoAtivo[];
}) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; payload: unknown }> = [];
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
      if (table === "documento_recomendacoes_criticas") {
        return {
          insert: (payload: unknown) => {
            inserts.push({ table, payload });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "equipamentos") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: options.equipamentosAtivos ?? [],
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

  return { supabase, updates, inserts };
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

  it("vincula equipamento quando ha match confiavel para registro_laudos", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase({
        equipamento_tipo: "Gerador",
        equipamento_identificacao: null,
        equipamento_numero_serie: null,
      }),
    });

    const { supabase, updates } = criarSupabaseFake({
      registro: {
        id: "doc-3",
        tipo: "registro_laudos",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/laudo.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
      },
      equipamentosAtivos: [
        { id: "eq-1", tipo_equipamento: "Gerador", identificacao: null, numero_serie: null },
      ],
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-3");

    expect(resultado.status).toBe("concluida");
    const ultimoUpdate = updates[updates.length - 1];
    expect(ultimoUpdate.payload.equipamento_id).toBe("eq-1");
  });

  it("grava recomendacoes_criticas e forca necessita_revisao quando ha achado critica", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase({
        recomendacoes_criticas: [recomendacaoCriticaBase({ prioridade: "critica" })],
      }),
    });

    const { supabase, updates, inserts } = criarSupabaseFake({
      registro: {
        id: "doc-5",
        tipo: "notas_fiscais",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/nota.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
      },
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-5");

    expect(resultado.status).toBe("necessita_revisao");
    const ultimoUpdate = updates[updates.length - 1];
    expect(ultimoUpdate.payload.status_analise_ia).toBe("necessita_revisao");
    expect(inserts.filter((i) => i.table === "documento_recomendacoes_criticas")).toHaveLength(1);
  });

  it("nao forca revisao quando so ha achados de prioridade baixa", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase({
        recomendacoes_criticas: [recomendacaoCriticaBase({ prioridade: "preventiva" })],
      }),
    });

    const { supabase, updates } = criarSupabaseFake({
      registro: {
        id: "doc-6",
        tipo: "notas_fiscais",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/nota.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
      },
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-6");

    expect(resultado.status).toBe("concluida");
    const ultimoUpdate = updates[updates.length - 1];
    expect(ultimoUpdate.payload.status_analise_ia).toBe("concluida");
  });

  it("nao insere linhas quando nao ha achados criticos", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase({ recomendacoes_criticas: [] }),
    });

    const { supabase, inserts } = criarSupabaseFake({
      registro: {
        id: "doc-7",
        tipo: "notas_fiscais",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/nota.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
      },
    });

    await processarDocumentoComIa(supabase, "doc-7");

    expect(inserts.filter((i) => i.table === "documento_recomendacoes_criticas")).toHaveLength(0);
  });

  it("marca necessita_revisao quando a loja tem equipamentos mas nenhum bate", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase({
        equipamento_tipo: "Subestacao",
        equipamento_identificacao: null,
        equipamento_numero_serie: null,
      }),
    });

    const { supabase, updates } = criarSupabaseFake({
      registro: {
        id: "doc-4",
        tipo: "registro_laudos",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/laudo.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
      },
      equipamentosAtivos: [
        { id: "eq-1", tipo_equipamento: "Gerador", identificacao: null, numero_serie: null },
      ],
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-4");

    expect(resultado.status).toBe("necessita_revisao");
    const ultimoUpdate = updates[updates.length - 1];
    expect(ultimoUpdate.payload.equipamento_id).toBeNull();
  });

  it("nao tenta match de equipamento quando a loja nao tem nenhum cadastrado", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase({
        equipamento_tipo: null,
        equipamento_identificacao: null,
        equipamento_numero_serie: null,
      }),
    });

    const { supabase, updates } = criarSupabaseFake({
      registro: {
        id: "doc-5",
        tipo: "registro_laudos",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/laudo.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
      },
      // sem equipamentosAtivos: loja sem nenhum equipamento cadastrado
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-5");

    expect(resultado.status).toBe("concluida");
  });

  it("nao tenta match de equipamento para tipos fora de escopo mesmo com equipamentos cadastrados", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase(),
    });

    const { supabase, updates } = criarSupabaseFake({
      registro: {
        id: "doc-6",
        tipo: "contratos",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/contrato.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
      },
      equipamentosAtivos: [
        { id: "eq-1", tipo_equipamento: "Gerador", identificacao: null, numero_serie: null },
      ],
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-6");

    expect(resultado.status).toBe("concluida");
    const ultimoUpdate = updates[updates.length - 1];
    expect(ultimoUpdate.payload.equipamento_id).toBeUndefined();
  });

  it("mantem concluida quando nao ha nenhum sinal de equipamento, mesmo com equipamentos cadastrados na loja", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase({
        equipamento_tipo: null,
        equipamento_identificacao: null,
        equipamento_numero_serie: null,
      }),
    });

    const { supabase, updates } = criarSupabaseFake({
      registro: {
        id: "doc-7",
        tipo: "notas_fiscais",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/nota.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
        equipamento_id: null,
      },
      equipamentosAtivos: [
        { id: "eq-1", tipo_equipamento: "Gerador", identificacao: null, numero_serie: null },
      ],
    });

    const resultado = await processarDocumentoComIa(supabase, "doc-7");

    expect(resultado.status).toBe("concluida");
    const ultimoUpdate = updates[updates.length - 1];
    expect(ultimoUpdate.payload.equipamento_id).toBeNull();
  });

  it("preserva equipamento_id ja vinculado e nao consulta equipamentos ativos novamente", async () => {
    vi.mocked(analisarDocumentoComOpenAi).mockResolvedValueOnce({
      provider: "azure-openai",
      model: "gpt-5-chat",
      resultado: resultadoBase({
        equipamento_tipo: "Gerador",
        equipamento_identificacao: null,
        equipamento_numero_serie: null,
      }),
    });

    const { supabase, updates } = criarSupabaseFake({
      registro: {
        id: "doc-8",
        tipo: "registro_laudos",
        dados: { loja_id: "loja-1", competencia: "07/2026" },
        arquivo_path: "pasta/laudo.pdf",
        arquivo_assinado_path: null,
        prestador_id: null,
        equipamento_id: "eq-existente",
      },
      equipamentosAtivos: [
        { id: "eq-1", tipo_equipamento: "Gerador", identificacao: null, numero_serie: null },
      ],
    });
    const buscarEquipamentosSpy = vi.spyOn(supabase, "from");

    const resultado = await processarDocumentoComIa(supabase, "doc-8");

    expect(resultado.status).toBe("concluida");
    const ultimoUpdate = updates[updates.length - 1];
    expect(ultimoUpdate.payload.equipamento_id).toBe("eq-existente");
    expect(
      buscarEquipamentosSpy.mock.calls.some(([table]) => table === "equipamentos"),
    ).toBe(false);
  });
});

import { encontrarEquipamentoCorrespondente } from "@/lib/documentAnalysisPipeline";

describe("encontrarEquipamentoCorrespondente", () => {
  const equipamentos: EquipamentoAtivo[] = [
    { id: "eq-1", tipo_equipamento: "Gerador", identificacao: "Gerador 01", numero_serie: "SN-100" },
    { id: "eq-2", tipo_equipamento: "Gerador", identificacao: "Gerador 02", numero_serie: "SN-200" },
    { id: "eq-3", tipo_equipamento: "Ar Condicionado", identificacao: null, numero_serie: null },
  ];

  it("da prioridade ao numero de serie quando bate com exatamente um equipamento", () => {
    const resultado = resultadoBase({
      equipamento_tipo: "Gerador",
      equipamento_identificacao: "Gerador 02",
      equipamento_numero_serie: "sn-100",
    });
    const match = encontrarEquipamentoCorrespondente(equipamentos, resultado);
    expect(match?.id).toBe("eq-1");
  });

  it("casa por tipo quando ha exatamente um equipamento daquele tipo", () => {
    const resultado = resultadoBase({
      equipamento_tipo: "ar condicionado",
      equipamento_identificacao: null,
      equipamento_numero_serie: null,
    });
    const match = encontrarEquipamentoCorrespondente(equipamentos, resultado);
    expect(match?.id).toBe("eq-3");
  });

  it("desempata por identificacao quando ha mais de um equipamento do mesmo tipo", () => {
    const resultado = resultadoBase({
      equipamento_tipo: "Gerador",
      equipamento_identificacao: "Gerador 02",
      equipamento_numero_serie: null,
    });
    const match = encontrarEquipamentoCorrespondente(equipamentos, resultado);
    expect(match?.id).toBe("eq-2");
  });

  it("retorna null quando ha mais de um candidato e a identificacao nao desempata", () => {
    const resultado = resultadoBase({
      equipamento_tipo: "Gerador",
      equipamento_identificacao: "Gerador Principal",
      equipamento_numero_serie: null,
    });
    expect(encontrarEquipamentoCorrespondente(equipamentos, resultado)).toBeNull();
  });

  it("retorna null quando nao ha equipamento_tipo nem match de numero de serie", () => {
    const resultado = resultadoBase({
      equipamento_tipo: null,
      equipamento_identificacao: null,
      equipamento_numero_serie: null,
    });
    expect(encontrarEquipamentoCorrespondente(equipamentos, resultado)).toBeNull();
  });

  it("retorna null quando o tipo extraido nao bate com nenhum equipamento", () => {
    const resultado = resultadoBase({
      equipamento_tipo: "Subestacao",
      equipamento_identificacao: null,
      equipamento_numero_serie: null,
    });
    expect(encontrarEquipamentoCorrespondente(equipamentos, resultado)).toBeNull();
  });
});
