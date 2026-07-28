export type AzureOpenAiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const DEFAULT_AZURE_OPENAI_ENDPOINT =
  "https://bml-azure-openai-agents.openai.azure.com/openai/deployments/gpt-5-chat/chat/completions?api-version=2025-01-01-preview";

type CallAzureOpenAiChatInput = {
  messages: AzureOpenAiChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

export async function callAzureOpenAiChat({
  messages,
  temperature = 0.2,
  maxTokens = 700,
}: CallAzureOpenAiChatInput) {
  const endpoint =
    process.env.AZURE_OPENAI_ENDPOINT?.trim() ||
    DEFAULT_AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();

  if (!endpoint || !apiKey) {
    throw new Error("Configure AZURE_OPENAI_API_KEY na sua variável de ambiente.");
  }

  const payload = {
    messages,
    temperature,
    max_completion_tokens: maxTokens,
    response_format: { type: "json_object" },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  const raw = (await response.json().catch(() => null)) as
    | {
        error?: { message?: string };
        choices?: Array<{
          message?: {
            content?: string | null;
          };
        }>;
      }
    | null;

  if (!response.ok) {
    throw new Error(
      raw?.error?.message ??
        `Azure OpenAI retornou status ${response.status}.`,
    );
  }

  const content = raw?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Azure OpenAI não retornou conteúdo útil.");
  }

  return content;
}
