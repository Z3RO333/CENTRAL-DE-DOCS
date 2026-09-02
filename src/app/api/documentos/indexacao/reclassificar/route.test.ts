import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/taxonomiaIndexacao", () => ({
  classificarDocumento: vi.fn(async () => ({ status: "classificado", termos: [] })),
}));
vi.mock("@/lib/apiAuth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/apiAuth")>("@/lib/apiAuth");
  return { ...actual, getActorFromRequest: vi.fn() };
});
vi.mock("@/lib/supabaseAdminClient", () => ({ createSupabaseAdminClient: vi.fn() }));

import { getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { classificarDocumento } from "@/lib/taxonomiaIndexacao";
import { POST } from "./route";

const mockedActor = vi.mocked(getActorFromRequest);
const mockedCreateSupabase = vi.mocked(createSupabaseAdminClient);
const mockedClassificar = vi.mocked(classificarDocumento);

function makeRequest(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/documentos/indexacao/reclassificar", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function makeSupabaseComPendentes(pendentes: { documento_id: string; texto: string }[]) {
  return {
    from: (tabela: string) => {
      if (tabela !== "documento_conteudo") {
        throw new Error(`tabela inesperada: ${tabela}`);
      }
      return {
        select: () => ({
          is: () => ({
            not: () => ({
              order: () => ({
                limit: async () => ({ data: pendentes, error: null }),
              }),
            }),
          }),
        }),
      };
    },
  };
}

beforeEach(() => {
  mockedActor.mockReset();
  mockedCreateSupabase.mockReset();
  mockedClassificar.mockReset().mockResolvedValue({ status: "classificado", termos: [] });
});

describe("POST /api/documentos/indexacao/reclassificar", () => {
  it("rejeita quem nao e admin", async () => {
    mockedActor.mockResolvedValueOnce({
      userId: "u1",
      email: "user@empresa.com",
      isAdmin: false,
      realUserId: "u1",
      realEmail: "user@empresa.com",
      realIsAdmin: false,
      isSimulating: false,
    });
    mockedCreateSupabase.mockReturnValueOnce(makeSupabaseComPendentes([]) as never);

    const response = await POST(makeRequest());
    expect(response.status).toBe(403);
  });

  it("classifica cada documento pendente e reporta os contadores", async () => {
    mockedActor.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@empresa.com",
      isAdmin: true,
      realUserId: "admin-1",
      realEmail: "admin@empresa.com",
      realIsAdmin: true,
      isSimulating: false,
    });
    mockedCreateSupabase.mockReturnValueOnce(
      makeSupabaseComPendentes([
        { documento_id: "doc-1", texto: "laudo do gerador" },
        { documento_id: "doc-2", texto: "nota fiscal" },
      ]) as never,
    );
    mockedClassificar
      .mockResolvedValueOnce({ status: "classificado", termos: ["gerador"] })
      .mockResolvedValueOnce({ status: "pulado", termos: [], detalhe: "sem_texto" });

    const response = await POST(makeRequest());
    const payload = (await response.json()) as {
      processados: number;
      classificados: number;
      pulados: number;
      erros: number;
      concluido: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      processados: 2,
      classificados: 1,
      pulados: 1,
      erros: 0,
      concluido: false,
    });
    expect(mockedClassificar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ documentoId: "doc-1", texto: "laudo do gerador", equipamentoTipo: null }),
    );
  });

  it("continua o lote quando classificarDocumento rejeita em um documento", async () => {
    mockedActor.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@empresa.com",
      isAdmin: true,
      realUserId: "admin-1",
      realEmail: "admin@empresa.com",
      realIsAdmin: true,
      isSimulating: false,
    });
    mockedCreateSupabase.mockReturnValueOnce(
      makeSupabaseComPendentes([
        { documento_id: "doc-1", texto: "laudo do gerador" },
        { documento_id: "doc-2", texto: "nota fiscal" },
        { documento_id: "doc-3", texto: "contrato de manutencao" },
      ]) as never,
    );
    mockedClassificar
      .mockResolvedValueOnce({ status: "classificado", termos: ["gerador"] })
      .mockRejectedValueOnce(new Error("falha inesperada"))
      .mockResolvedValueOnce({ status: "classificado", termos: ["contrato"] });

    const response = await POST(makeRequest());
    const payload = (await response.json()) as {
      processados: number;
      classificados: number;
      pulados: number;
      erros: number;
      concluido: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      processados: 3,
      classificados: 2,
      pulados: 0,
      erros: 1,
      concluido: false,
    });
    expect(mockedClassificar).toHaveBeenCalledTimes(3);
  });

  it("reporta concluido quando nao ha mais pendentes", async () => {
    mockedActor.mockResolvedValueOnce({
      userId: "admin-1",
      email: "admin@empresa.com",
      isAdmin: true,
      realUserId: "admin-1",
      realEmail: "admin@empresa.com",
      realIsAdmin: true,
      isSimulating: false,
    });
    mockedCreateSupabase.mockReturnValueOnce(makeSupabaseComPendentes([]) as never);

    const response = await POST(makeRequest());
    const payload = (await response.json()) as { concluido: boolean; processados: number };
    expect(payload).toEqual({ processados: 0, classificados: 0, pulados: 0, erros: 0, concluido: true });
  });
});
