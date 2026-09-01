import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiAuth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/apiAuth")>("@/lib/apiAuth");
  return {
    ...actual,
    getAuthorizedPrestadorIds: vi.fn(async () => []),
    getGerenteAccessEntries: vi.fn(async () => []),
    hasDocumentosAccess: vi.fn(async () => true),
  };
});
vi.mock("@/lib/documentosCopilot", async () => {
  const actual = await vi.importActual<typeof import("@/lib/documentosCopilot")>(
    "@/lib/documentosCopilot",
  );
  return { ...actual, queryDocumentoCandidates: vi.fn() };
});

import { createEmptyInsights, queryDocumentoCandidates } from "@/lib/documentosCopilot";
import { dominioDocumentos } from "@/lib/assistenteDominioDocumentos";
import type { AssistenteContext } from "@/lib/assistenteTypes";

const mockedQuery = vi.mocked(queryDocumentoCandidates);

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
  mockedQuery.mockReset();
});

describe("dominioDocumentos.podeAcessar", () => {
  it("sempre permite (a query interna já filtra por escopo)", async () => {
    await expect(dominioDocumentos.podeAcessar(makeCtx())).resolves.toBe(true);
  });
});

describe("dominioDocumentos.executarTool buscar_documentos", () => {
  it("retorna erro quando nenhum filtro foi informado", async () => {
    const result = await dominioDocumentos.executarTool("buscar_documentos", {}, makeCtx());
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toHaveProperty("erro");
    expect(result.outcome).toBeUndefined();
  });

  it("busca documentos e mapeia para AssistenteResultItem/AssistenteInsights", async () => {
    mockedQuery.mockResolvedValueOnce({
      matches: [
        {
          id: "doc-1",
          tipo: "notas_fiscais",
          status: "pendente",
          created_at: "2026-01-01T00:00:00.000Z",
          nome: "nf1.pdf",
          identificacao: "123",
          complemento: null,
          lojaId: "loja-1",
          lojaNome: "Loja 1",
          prestadorId: null,
          prestadorNome: null,
          tipoLaudo: null,
          observacoes: null,
          arquivoPath: "notas_fiscais/nf1.pdf",
          arquivoAssinadoPath: null,
        },
      ],
      total: 1,
      insights: {
        ...createEmptyInsights(),
        totalDocumentos: 1,
        totalLojas: 1,
        totalPendentes: 1,
        porStatus: [{ key: "pendente", label: "Pendente", total: 1, percentual: 100 }],
      },
    });

    const result = await dominioDocumentos.executarTool(
      "buscar_documentos",
      { tipo: "notas_fiscais" },
      makeCtx(),
    );

    expect(result.outcome).toBeDefined();
    const outcome = result.outcome!;
    expect(outcome.dominio).toBe("documentos");
    expect(outcome.results).toEqual([
      {
        id: "doc-1",
        titulo: "nf1.pdf",
        subtitulo: "123 · Loja 1",
        abrirArquivoPath: "notas_fiscais/nf1.pdf",
      },
    ]);
    expect(outcome.total).toBe(1);
    expect(outcome.filtrosUrl).toBe("/documentos?tipo=notas_fiscais&source=assistente");
    expect(outcome.insights.totais).toEqual(
      expect.arrayContaining([{ key: "totalDocumentos", label: "Documentos", valor: 1 }]),
    );
  });
});

describe("dominioDocumentos.descricaoPrompt", () => {
  it("inclui os filtros atuais da tela quando o dominio do contexto e documentos", () => {
    const prompt = dominioDocumentos.descricaoPrompt(
      makeCtx({ currentContext: { dominio: "documentos", filtros: { status: "pendente" } } }),
    );
    expect(prompt).toContain("pendente");
  });

  it("nao inclui filtros quando o contexto e de outro dominio", () => {
    const prompt = dominioDocumentos.descricaoPrompt(
      makeCtx({ currentContext: { dominio: "orcamentos", filtros: { status: "rascunho" } } }),
    );
    expect(prompt).not.toContain("rascunho");
  });
});
