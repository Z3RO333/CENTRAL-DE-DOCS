import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks declarados antes dos imports do modulo testado (vitest hoisting).
vi.mock("@/lib/apiAuth", () => ({
  ApiHttpError: class ApiHttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  getActorFromRequest: vi.fn(async () => ({ isAdmin: true })),
}));

vi.mock("@/lib/supabaseAdminClient", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/documentoIndexacao", () => ({
  indexarConteudoDocumento: vi.fn(async () => ({ status: "indexado", chunks: 1 })),
}));

vi.mock("@/lib/documentAnalysisPipeline", () => ({
  baixarEAnalisarArquivo: vi.fn(async () => ({
    textoExtraido: "texto extraido",
    paginas: 1,
    arquivoHash: "hash-abc",
    provider: "azure-openai",
    model: "gpt-5-chat",
    resultado: {},
  })),
}));

import { POST } from "@/app/api/documentos/indexacao/backfill/route";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { indexarConteudoDocumento } from "@/lib/documentoIndexacao";
import { baixarEAnalisarArquivo } from "@/lib/documentAnalysisPipeline";

const mockedCreateSupabase = vi.mocked(createSupabaseAdminClient);
const mockedIndexar = vi.mocked(indexarConteudoDocumento);
const mockedBaixar = vi.mocked(baixarEAnalisarArquivo);

type FormularioRow = {
  id: string;
  tipo: string;
  dados: Record<string, unknown> | null;
  arquivo_path: string | null;
  arquivo_assinado_path: string | null;
  prestador_id: string | null;
  equipamento_id: string | null;
  created_at: string;
};

function makeRow(overrides: Partial<FormularioRow> & { id: string; created_at: string }): FormularioRow {
  return {
    tipo: "notas_fiscais",
    dados: { loja_id: "loja-1" },
    arquivo_path: "pasta/documento.pdf",
    arquivo_assinado_path: null,
    prestador_id: null,
    equipamento_id: null,
    ...overrides,
  };
}

/**
 * Cria um fake do cliente Supabase com comportamento minimo para o backfill.
 *
 * Sequencia de chamadas esperada:
 *  1. documento_conteudo.select({count,head}).gte(...)  → { count: contagemDia }
 *  2. formularios.select().order().limit().[lt()]       → { data: candidatos }
 *  3. documento_conteudo.select().in().not()            → { data: jaIndexados }
 */
function makeFakeSupabase({
  candidatos,
  jaIndexadosIds = [],
  contagemDia = 0,
}: {
  candidatos: FormularioRow[];
  jaIndexadosIds?: string[];
  contagemDia?: number;
}) {
  let conteudoCalls = 0;

  return {
    from(tabela: string) {
      if (tabela === "formularios") {
        const resultado = { data: candidatos, error: null };
        // Cadeia: .select().order().limit()[.lt()] — qualquer ponta e awaitable.
        const terminal = {
          lt: () => terminal,
          // "then" torna o objeto thenable: await terminal resolve com resultado.
          then: (resolve: (v: typeof resultado) => void) => {
            resolve(resultado);
          },
        };
        return {
          select: () => ({
            order: () => ({
              limit: () => terminal,
            }),
          }),
        };
      }

      if (tabela === "documento_conteudo") {
        conteudoCalls += 1;
        const chamada = conteudoCalls;

        if (chamada === 1) {
          // Primeira chamada: contagem diaria — .select({count,head}).gte(...)
          return {
            select: () => ({
              gte: () => Promise.resolve({ count: contagemDia, error: null }),
            }),
          };
        } else {
          // Segunda chamada: filtro de ja-indexados — .select().in().not()
          return {
            select: () => ({
              in: () => ({
                not: () =>
                  Promise.resolve({
                    data: jaIndexadosIds.map((id) => ({ documento_id: id })),
                    error: null,
                  }),
              }),
            }),
          };
        }
      }

      throw new Error(`[fake-supabase] tabela inesperada no teste: ${tabela}`);
    },
  } as unknown as ReturnType<typeof createSupabaseAdminClient>;
}

function makeRequest(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/documentos/indexacao/backfill", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockedIndexar.mockClear();
  mockedBaixar.mockClear();
  mockedIndexar.mockResolvedValue({ status: "indexado", chunks: 1 });
  mockedBaixar.mockResolvedValue({
    textoExtraido: "texto extraido",
    paginas: 1,
    arquivoHash: "hash-abc",
    provider: "azure-openai",
    model: "gpt-5-chat",
    resultado: {} as never,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/documentos/indexacao/backfill", () => {
  it("cursor aponta para o ultimo pendente processado quando o lote e truncado pelo limite", async () => {
    // 8 candidatos (limite=2, janela=8), 3 ja indexados, 5 pendentes.
    // limite=2 → pendentes.slice(0,2), truncado=true.
    // proximoAntesDe deve ser created_at do segundo pendente (indice 1 na lista pendentes).
    const candidatos: FormularioRow[] = [
      makeRow({ id: "c1", created_at: "2026-01-08T00:00:00Z" }), // ja indexado
      makeRow({ id: "c2", created_at: "2026-01-07T00:00:00Z" }), // pendente → processado (1)
      makeRow({ id: "c3", created_at: "2026-01-06T00:00:00Z" }), // ja indexado
      makeRow({ id: "c4", created_at: "2026-01-05T00:00:00Z" }), // pendente → processado (2)
      makeRow({ id: "c5", created_at: "2026-01-04T00:00:00Z" }), // ja indexado
      makeRow({ id: "c6", created_at: "2026-01-03T00:00:00Z" }), // pendente → nao processado
      makeRow({ id: "c7", created_at: "2026-01-02T00:00:00Z" }), // pendente → nao processado
      makeRow({ id: "c8", created_at: "2026-01-01T00:00:00Z" }), // pendente → nao processado
    ];
    const jaIndexadosIds = ["c1", "c3", "c5"];

    mockedCreateSupabase.mockReturnValueOnce(
      makeFakeSupabase({ candidatos, jaIndexadosIds }),
    );

    const res = await POST(makeRequest({ limite: 2 }));
    const body = await res.json();

    expect(body.processados).toBe(2);
    // Segundo pendente processado e c4 (created_at 2026-01-05)
    expect(body.proximoAntesDe).toBe("2026-01-05T00:00:00Z");
    expect(body.concluido).toBe(false);
    expect(body.limiteDiarioAtingido).toBeUndefined();
  });

  it("cursor aponta para o ultimo candidato quando a janela e consumida integralmente", async () => {
    // 4 candidatos, 1 ja indexado, 3 pendentes — tudo cabe em limite=10.
    // truncado=false → cursor deve ser o ultimo candidato (c4).
    const candidatos: FormularioRow[] = [
      makeRow({ id: "c1", created_at: "2026-01-04T00:00:00Z" }), // pendente
      makeRow({ id: "c2", created_at: "2026-01-03T00:00:00Z" }), // ja indexado
      makeRow({ id: "c3", created_at: "2026-01-02T00:00:00Z" }), // pendente
      makeRow({ id: "c4", created_at: "2026-01-01T00:00:00Z" }), // pendente (ultimo candidato)
    ];
    const jaIndexadosIds = ["c2"];

    mockedCreateSupabase.mockReturnValueOnce(
      makeFakeSupabase({ candidatos, jaIndexadosIds }),
    );

    const res = await POST(makeRequest({ limite: 10 }));
    const body = await res.json();

    expect(body.processados).toBe(3);
    // Ultimo candidato e c4
    expect(body.proximoAntesDe).toBe("2026-01-01T00:00:00Z");
    expect(body.concluido).toBe(false);
  });

  it("documentos ja indexados sao filtrados e nao passam para indexarConteudoDocumento", async () => {
    // 3 candidatos, 1 ja indexado (c2). Esperamos 2 chamadas a indexarConteudoDocumento.
    const candidatos: FormularioRow[] = [
      makeRow({ id: "c1", created_at: "2026-01-03T00:00:00Z" }),
      makeRow({ id: "c2", created_at: "2026-01-02T00:00:00Z" }), // ja indexado
      makeRow({ id: "c3", created_at: "2026-01-01T00:00:00Z" }),
    ];
    const jaIndexadosIds = ["c2"];

    mockedCreateSupabase.mockReturnValueOnce(
      makeFakeSupabase({ candidatos, jaIndexadosIds }),
    );

    const res = await POST(makeRequest({ limite: 10 }));
    const body = await res.json();

    expect(body.processados).toBe(2);
    expect(mockedIndexar).toHaveBeenCalledTimes(2);
    const idsIndexados = mockedIndexar.mock.calls.map(([, params]) => params.documentoId);
    expect(idsIndexados).not.toContain("c2");
    expect(idsIndexados).toContain("c1");
    expect(idsIndexados).toContain("c3");
  });

  it("teto diario interrompe o loop no meio do lote e reporta limiteDiarioAtingido", async () => {
    // limite diario = 3, contagemHoje = 2.
    // Loop: iter 1: 2+0=2 < 3 → processa (tentativas→1).
    //       iter 2: 2+1=3 >= 3 → para (limiteDiarioAtingido=true).
    // Apenas 1 documento deve ser processado.
    vi.stubEnv("INDEXACAO_LIMITE_DIARIO", "3");

    const candidatos: FormularioRow[] = [
      makeRow({ id: "d1", created_at: "2026-01-03T00:00:00Z" }),
      makeRow({ id: "d2", created_at: "2026-01-02T00:00:00Z" }),
      makeRow({ id: "d3", created_at: "2026-01-01T00:00:00Z" }),
    ];

    mockedCreateSupabase.mockReturnValueOnce(
      makeFakeSupabase({ candidatos, jaIndexadosIds: [], contagemDia: 2 }),
    );

    const res = await POST(makeRequest({ limite: 10 }));
    const body = await res.json();

    expect(body.limiteDiarioAtingido).toBe(true);
    expect(body.processados).toBe(1);
    expect(mockedIndexar).toHaveBeenCalledTimes(1);
    expect(mockedIndexar.mock.calls[0][1].documentoId).toBe("d1");
    // Cursor deve apontar para o ultimo documento processado (d1), pois ha pendentes nao processados.
    expect(body.proximoAntesDe).toBe("2026-01-03T00:00:00Z");
  });
});
