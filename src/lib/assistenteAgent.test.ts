import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/azureOpenAi", () => ({ callAzureOpenAiChat: vi.fn() }));
vi.mock("@/lib/supabaseAdminClient", () => ({ createSupabaseAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/documentosCopilotEntitySearch", () => ({
  buscarLojasPorNome: vi.fn(async () => []),
  buscarPrestadoresPorNome: vi.fn(async () => []),
}));
vi.mock("@/lib/assistenteConversas", () => ({
  getConversaMensagens: vi.fn(async () => []),
  appendConversaTurno: vi.fn(async () => undefined),
  MAX_STORED_MESSAGES: 10,
}));

import { callAzureOpenAiChat } from "@/lib/azureOpenAi";
import { appendConversaTurno, getConversaMensagens } from "@/lib/assistenteConversas";
import {
  buscarLojasPorNome,
  buscarPrestadoresPorNome,
} from "@/lib/documentosCopilotEntitySearch";
import { MAX_AGENT_TOOL_ITERATIONS, runAssistenteAgent } from "@/lib/assistenteAgent";
import { createEmptyAssistenteInsights, type AssistenteDominio } from "@/lib/assistenteTypes";

const mockedChat = vi.mocked(callAzureOpenAiChat);
const mockedGetHistorico = vi.mocked(getConversaMensagens);
const mockedAppend = vi.mocked(appendConversaTurno);
const mockedBuscarLojas = vi.mocked(buscarLojasPorNome);
const mockedBuscarPrestadores = vi.mocked(buscarPrestadoresPorNome);

const auth = { userId: "user-1", email: "user@empresa.com", isAdmin: false };

function fakeDominio(overrides: Partial<AssistenteDominio> = {}): AssistenteDominio {
  return {
    id: "documentos",
    tools: [
      {
        type: "function",
        function: { name: "ferramenta_teste", description: "teste", parameters: { type: "object", properties: {} } },
      },
    ],
    descricaoPrompt: () => "Regras do dominio de teste.",
    podeAcessar: async () => true,
    executarTool: async () => ({ content: "{}" }),
    ...overrides,
  };
}

beforeEach(() => {
  mockedChat.mockReset();
  mockedGetHistorico.mockReset().mockResolvedValue([]);
  mockedAppend.mockReset().mockResolvedValue(undefined);
  mockedBuscarLojas.mockReset();
  mockedBuscarPrestadores.mockReset();
});

describe("runAssistenteAgent", () => {
  it("retorna a resposta do modelo direto quando ele nao chama nenhuma ferramenta", async () => {
    mockedChat.mockResolvedValueOnce({ content: "Posso ajudar. Me diga um detalhe.", toolCalls: [] });

    const result = await runAssistenteAgent({ pergunta: "oi" }, auth, [fakeDominio()]);

    expect(result.reply).toBe("Posso ajudar. Me diga um detalhe.");
    expect(result.dominio).toBeNull();
    expect(result.results).toEqual([]);
    expect(result.insights).toEqual(createEmptyAssistenteInsights());
    expect(mockedAppend).toHaveBeenCalledTimes(1);
  });

  it("nao inclui dominios sem acesso nas tools nem no prompt", async () => {
    mockedChat.mockResolvedValueOnce({ content: "ok", toolCalls: [] });
    const dominioSemAcesso = fakeDominio({
      id: "cobrancas",
      podeAcessar: async () => false,
      descricaoPrompt: () => "NUNCA_DEVE_APARECER",
    });

    await runAssistenteAgent({ pergunta: "oi" }, auth, [fakeDominio(), dominioSemAcesso]);

    const sentSystemMessage = mockedChat.mock.calls[0][0].messages[0];
    expect(sentSystemMessage.content).not.toContain("NUNCA_DEVE_APARECER");
  });

  it("despacha um tool_call para o dominio dono da ferramenta e usa seu outcome na resposta", async () => {
    const outcome = {
      dominio: "documentos" as const,
      filters: { tipo: "notas_fiscais" },
      filtrosUrl: "/documentos?tipo=notas_fiscais",
      summary: "Critérios usados: tipo notas_fiscais.",
      results: [{ id: "doc-1", titulo: "nf1.pdf", subtitulo: "123" }],
      total: 1,
      insights: createEmptyAssistenteInsights(),
    };
    const executarTool = vi.fn(async () => ({ content: JSON.stringify({ total: 1 }), outcome }));

    mockedChat
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          { id: "call-1", type: "function", function: { name: "ferramenta_teste", arguments: "{}" } },
        ],
      })
      .mockResolvedValueOnce({ content: "Encontrei 1 nota fiscal.", toolCalls: [] });

    const result = await runAssistenteAgent(
      { pergunta: "notas fiscais" },
      auth,
      [fakeDominio({ executarTool })],
    );

    expect(executarTool).toHaveBeenCalledWith("ferramenta_teste", {}, expect.anything());
    expect(result.reply).toBe("Encontrei 1 nota fiscal.");
    expect(result.dominio).toBe("documentos");
    expect(result.results).toEqual(outcome.results);
    expect(result.filtrosUrl).toBe(outcome.filtrosUrl);
  });

  it("corta no maximo de iteracoes e ainda devolve uma resposta utilizavel", async () => {
    mockedChat.mockImplementation(async () => ({
      content: null,
      toolCalls: [
        { id: "call-loop", type: "function", function: { name: "ferramenta_teste", arguments: "{}" } },
      ],
    }));
    const executarTool = vi.fn(async () => ({
      content: JSON.stringify({ total: 0 }),
      outcome: {
        dominio: "documentos" as const,
        filters: {},
        filtrosUrl: null,
        summary: "Sem filtros aplicados.",
        results: [],
        total: 0,
        insights: createEmptyAssistenteInsights(),
      },
    }));

    const result = await runAssistenteAgent(
      { pergunta: "documentos" },
      auth,
      [fakeDominio({ executarTool })],
    );

    expect(mockedChat).toHaveBeenCalledTimes(MAX_AGENT_TOOL_ITERATIONS);
    expect(result.reply).toContain("Não encontrei resultados");
  });

  it("chama buscar_lojas diretamente (ferramenta compartilhada, nao pertence a nenhum dominio)", async () => {
    mockedChat
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          { id: "call-1", type: "function", function: { name: "buscar_lojas", arguments: JSON.stringify({ query: "avenida" }) } },
        ],
      })
      .mockResolvedValueOnce({ content: "Achei a loja Avenida.", toolCalls: [] });
    mockedBuscarLojas.mockResolvedValueOnce([{ id: "loja-302", nome: "302 - Avenida Paulista", codigo: "302" }]);

    const result = await runAssistenteAgent({ pergunta: "loja avenida" }, auth, [fakeDominio()]);

    expect(mockedBuscarLojas).toHaveBeenCalledWith("avenida", expect.anything());
    expect(result.reply).toBe("Achei a loja Avenida.");
  });

  it("persiste a pergunta e a resposta no historico ao final do turno", async () => {
    mockedChat.mockResolvedValueOnce({ content: "ok", toolCalls: [] });

    await runAssistenteAgent({ pergunta: "oi" }, auth, [fakeDominio()]);

    expect(mockedAppend).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        pergunta: expect.objectContaining({ role: "user", text: "oi" }),
        resposta: expect.objectContaining({ role: "assistant", text: "ok" }),
      }),
      expect.anything(),
    );
  });

  it("manda o historico persistido (ate 10 mensagens) para o modelo", async () => {
    mockedGetHistorico.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        text: `mensagem ${i}`,
        criado_em: "2026-01-01T00:00:00.000Z",
      })),
    );
    mockedChat.mockResolvedValueOnce({ content: "ok", toolCalls: [] });

    await runAssistenteAgent({ pergunta: "nova pergunta" }, auth, [fakeDominio()]);

    const sentMessages = mockedChat.mock.calls[0][0].messages;
    const nonSystemMessages = sentMessages.filter((m) => m.role !== "system");
    // 10 mensagens do historico (das 12, cortadas) + a pergunta nova
    expect(nonSystemMessages).toHaveLength(11);
    expect(nonSystemMessages[0]).toMatchObject({ content: "mensagem 2" });
  });
});
