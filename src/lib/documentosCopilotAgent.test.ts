import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/azureOpenAi", () => ({
  callAzureOpenAiChat: vi.fn(),
}));
vi.mock("@/lib/supabaseAdminClient", () => ({
  createSupabaseAdminClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/apiAuth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/apiAuth")>(
    "@/lib/apiAuth",
  );
  return {
    ...actual,
    getAuthorizedPrestadorIds: vi.fn(async () => []),
    getGerenteAccessEntries: vi.fn(async () => []),
    hasDocumentosAccess: vi.fn(async () => true),
  };
});
vi.mock("@/lib/documentosCopilotEntitySearch", () => ({
  buscarLojasPorNome: vi.fn(async () => []),
  buscarPrestadoresPorNome: vi.fn(async () => []),
}));
vi.mock("@/lib/documentosCopilot", async () => {
  const actual = await vi.importActual<typeof import("@/lib/documentosCopilot")>(
    "@/lib/documentosCopilot",
  );
  return {
    ...actual,
    queryDocumentoCandidates: vi.fn(),
  };
});

import { callAzureOpenAiChat } from "@/lib/azureOpenAi";
import { createEmptyInsights, queryDocumentoCandidates } from "@/lib/documentosCopilot";
import {
  MAX_AGENT_TOOL_ITERATIONS,
  runDocumentoCopilotAgent,
} from "@/lib/documentosCopilotAgent";

const mockedChat = vi.mocked(callAzureOpenAiChat);
const mockedQuery = vi.mocked(queryDocumentoCandidates);

const auth = { userId: "user-1", email: "user@empresa.com" };

beforeEach(() => {
  mockedChat.mockReset();
  mockedQuery.mockReset();
});

describe("runDocumentoCopilotAgent", () => {
  it("retorna a resposta do modelo direto quando ele nao chama nenhuma ferramenta", async () => {
    mockedChat.mockResolvedValueOnce({
      content: "Posso ajudar a buscar documentos. Me diga um detalhe.",
      toolCalls: [],
    });

    const result = await runDocumentoCopilotAgent(
      { messages: [{ role: "user", text: "oi" }] },
      auth,
    );

    expect(result.reply).toBe("Posso ajudar a buscar documentos. Me diga um detalhe.");
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.filters).toEqual({});
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(mockedChat).toHaveBeenCalledTimes(1);
  });

  it("executa buscar_documentos e devolve os resultados encontrados", async () => {
    mockedChat
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "buscar_documentos",
              arguments: JSON.stringify({ tipo: "notas_fiscais" }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({ content: "Encontrei 1 nota fiscal.", toolCalls: [] });

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
          lojaId: null,
          lojaNome: null,
          prestadorId: null,
          prestadorNome: null,
          tipoLaudo: null,
          observacoes: null,
        },
      ],
      total: 1,
      insights: createEmptyInsights(),
    });

    const result = await runDocumentoCopilotAgent(
      { messages: [{ role: "user", text: "notas fiscais" }] },
      auth,
    );

    expect(result.reply).toBe("Encontrei 1 nota fiscal.");
    expect(result.results).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0][0].filters.tipo).toBe("notas_fiscais");
  });

  it("corta no maximo de iteracoes e ainda devolve o ultimo resultado de busca", async () => {
    mockedChat.mockImplementation(async () => ({
      content: null,
      toolCalls: [
        {
          id: "call-loop",
          type: "function",
          function: { name: "buscar_documentos", arguments: "{}" },
        },
      ],
    }));

    mockedQuery.mockResolvedValue({
      matches: [],
      total: 0,
      insights: createEmptyInsights(),
    });

    const result = await runDocumentoCopilotAgent(
      { messages: [{ role: "user", text: "documentos" }] },
      auth,
    );

    expect(mockedChat).toHaveBeenCalledTimes(MAX_AGENT_TOOL_ITERATIONS);
    expect(result.reply).toContain("Não encontrei documentos");
    expect(result.total).toBe(0);
  });

  it("manda o historico da conversa (ate 10 turnos) para o modelo", async () => {
    mockedChat.mockResolvedValueOnce({ content: "ok", toolCalls: [] });

    const messages = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `mensagem ${i}`,
    }));

    await runDocumentoCopilotAgent({ messages }, auth);

    const sentMessages = mockedChat.mock.calls[0][0].messages;
    const nonSystemMessages = sentMessages.filter((m) => m.role !== "system");
    expect(nonSystemMessages).toHaveLength(10);
    expect(nonSystemMessages[0]).toMatchObject({ content: "mensagem 2" });
  });
});
