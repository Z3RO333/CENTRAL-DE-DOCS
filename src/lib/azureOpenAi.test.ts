import { afterEach, describe, expect, it, vi } from "vitest";
import { callAzureOpenAiChat } from "@/lib/azureOpenAi";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

const mockFetchOnce = (body: unknown, status = 200) => {
  global.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
};

describe("callAzureOpenAiChat", () => {
  it("devolve o content quando o modelo responde texto direto", async () => {
    vi.stubEnv("AZURE_OPENAI_API_KEY", "chave-teste");
    mockFetchOnce({
      choices: [{ message: { content: "Ola!", tool_calls: undefined } }],
    });

    const result = await callAzureOpenAiChat({
      messages: [{ role: "user", content: "oi" }],
    });

    expect(result).toEqual({ content: "Ola!", toolCalls: [] });
  });

  it("devolve toolCalls e content null quando o modelo chama uma ferramenta", async () => {
    vi.stubEnv("AZURE_OPENAI_API_KEY", "chave-teste");
    mockFetchOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "buscar_documentos", arguments: '{"tipo":"notas_fiscais"}' },
              },
            ],
          },
        },
      ],
    });

    const result = await callAzureOpenAiChat({
      messages: [{ role: "user", content: "notas fiscais" }],
      tools: [
        {
          type: "function",
          function: { name: "buscar_documentos", description: "busca", parameters: { type: "object", properties: {} } },
        },
      ],
    });

    expect(result.content).toBeNull();
    expect(result.toolCalls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "buscar_documentos", arguments: '{"tipo":"notas_fiscais"}' },
      },
    ]);
  });

  it("lanca erro com a mensagem da Azure quando a resposta nao e ok", async () => {
    vi.stubEnv("AZURE_OPENAI_API_KEY", "chave-teste");
    mockFetchOnce({ error: { message: "chave invalida" } }, 401);

    await expect(
      callAzureOpenAiChat({ messages: [{ role: "user", content: "oi" }] }),
    ).rejects.toThrow("chave invalida");
  });

  it("lanca erro quando falta a api key", async () => {
    vi.stubEnv("AZURE_OPENAI_API_KEY", "");

    await expect(
      callAzureOpenAiChat({ messages: [{ role: "user", content: "oi" }] }),
    ).rejects.toThrow("Configure AZURE_OPENAI_API_KEY");
  });
});
