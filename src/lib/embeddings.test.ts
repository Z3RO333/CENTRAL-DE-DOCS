import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_LOTE_MAX, gerarEmbeddings } from "@/lib/embeddings";

const respostaOk = (quantidade: number) => ({
  ok: true,
  json: async () => ({
    data: Array.from({ length: quantidade }, (_, index) => ({
      index,
      embedding: [index, index + 0.5],
    })),
  }),
});

beforeEach(() => {
  process.env.AZURE_OPENAI_API_KEY = "chave";
  process.env.AZURE_OPENAI_ENDPOINT = "https://exemplo.openai.azure.com";
  process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = "text-embedding-3-small";
  // Limpa a versao de API para o teste de URL nao depender do .env de quem roda.
  delete process.env.AZURE_OPENAI_EMBEDDING_API_VERSION;
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gerarEmbeddings", () => {
  it("retorna vazio sem chamar a API quando nao ha texto", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(gerarEmbeddings([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("monta a URL de embeddings a partir do endpoint base", async () => {
    const fetchMock = vi.fn(async (_url: string) => respostaOk(1));
    vi.stubGlobal("fetch", fetchMock);

    await gerarEmbeddings(["laudo do gerador"]);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(
      "/openai/deployments/text-embedding-3-small/embeddings",
    );
    expect(url).toContain("api-version=");
  });

  it("deriva a base quando o endpoint ja aponta para chat/completions", async () => {
    process.env.AZURE_OPENAI_ENDPOINT =
      "https://exemplo.openai.azure.com/openai/deployments/gpt-5-chat/chat/completions?api-version=2025-01-01-preview";
    const fetchMock = vi.fn(async (_url: string) => respostaOk(1));
    vi.stubGlobal("fetch", fetchMock);

    await gerarEmbeddings(["laudo"]);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(
      "https://exemplo.openai.azure.com/openai/deployments/text-embedding-3-small/embeddings?api-version=2024-02-01",
    );
  });

  it("divide em lotes e devolve os vetores na ordem original", async () => {
    const total = EMBEDDING_LOTE_MAX + 2;
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const enviados = (JSON.parse(init.body) as { input: string[] }).input;
      return respostaOk(enviados.length);
    });
    vi.stubGlobal("fetch", fetchMock);

    const vetores = await gerarEmbeddings(
      Array.from({ length: total }, (_, i) => `trecho ${i}`),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vetores).toHaveLength(total);
    expect(vetores[0]).toEqual([0, 0.5]);
  });

  it("reordena pela propriedade index quando a API devolve fora de ordem", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            { index: 1, embedding: [9] },
            { index: 0, embedding: [7] },
          ],
        }),
      })),
    );

    await expect(gerarEmbeddings(["a", "b"])).resolves.toEqual([[7], [9]]);
  });

  it("falha com mensagem clara quando falta configuracao", async () => {
    delete process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;
    vi.stubGlobal("fetch", vi.fn());
    await expect(gerarEmbeddings(["a"])).rejects.toThrow(
      /AZURE_OPENAI_EMBEDDING_DEPLOYMENT/,
    );
  });

  it("propaga erro da API com o status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "input muito longo" } }),
      })),
    );

    await expect(gerarEmbeddings(["a"])).rejects.toThrow("input muito longo");
  });
});
