export const EMBEDDING_DIMENSOES = 1536;
export const EMBEDDING_LOTE_MAX = 16;

const TENTATIVAS_MAX = 3;
const API_VERSION_PADRAO = "2024-02-01";

function getConfig() {
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
  const deployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT?.trim();
  const apiVersion =
    process.env.AZURE_OPENAI_EMBEDDING_API_VERSION?.trim() || API_VERSION_PADRAO;

  if (!apiKey || !endpoint || !deployment) {
    throw new Error(
      "Configure AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT e AZURE_OPENAI_EMBEDDING_DEPLOYMENT no .env.",
    );
  }

  // AZURE_OPENAI_ENDPOINT pode conter a URL completa de chat/completions
  // (e o padrao do projeto em azureOpenAi.ts e exatamente essa forma).
  // Aqui interessa so a base do recurso.
  const base = endpoint.includes("/openai/")
    ? endpoint.slice(0, endpoint.indexOf("/openai/"))
    : endpoint.replace(/\/+$/, "");

  const url = `${base}/openai/deployments/${encodeURIComponent(
    deployment,
  )}/embeddings?api-version=${encodeURIComponent(apiVersion)}`;

  return { apiKey, url };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function gerarLote(
  textos: string[],
  config: { apiKey: string; url: string },
): Promise<number[][]> {
  let ultimoErro: Error | null = null;

  for (let tentativa = 1; tentativa <= TENTATIVAS_MAX; tentativa += 1) {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "api-key": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: textos }),
    });

    const raw = (await response.json().catch(() => null)) as
      | {
          error?: { message?: string };
          data?: Array<{ index?: number; embedding?: number[] }>;
        }
      | null;

    if (response.ok) {
      const dados = raw?.data ?? [];
      if (dados.length !== textos.length) {
        throw new Error(
          `Azure OpenAI devolveu ${dados.length} embeddings para ${textos.length} textos.`,
        );
      }
      return dados
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((item) => item.embedding ?? []);
    }

    const mensagem =
      raw?.error?.message ?? `Azure OpenAI retornou status ${response.status}.`;
    ultimoErro = new Error(mensagem);

    const recuperavel = response.status === 429 || response.status >= 500;
    if (!recuperavel || tentativa === TENTATIVAS_MAX) {
      throw ultimoErro;
    }
    await sleep(500 * 2 ** (tentativa - 1));
  }

  throw ultimoErro ?? new Error("Falha ao gerar embeddings.");
}

export async function gerarEmbeddings(textos: string[]): Promise<number[][]> {
  if (textos.length === 0) {
    return [];
  }
  const config = getConfig();
  const vetores: number[][] = [];

  for (let inicio = 0; inicio < textos.length; inicio += EMBEDDING_LOTE_MAX) {
    const lote = textos.slice(inicio, inicio + EMBEDDING_LOTE_MAX);
    vetores.push(...(await gerarLote(lote, config)));
  }

  return vetores;
}
