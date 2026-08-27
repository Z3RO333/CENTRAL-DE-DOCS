export type AzureOpenAiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type AzureOpenAiChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: AzureOpenAiToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type AzureOpenAiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AzureOpenAiChatResult = {
  content: string | null;
  toolCalls: AzureOpenAiToolCall[];
};

const DEFAULT_AZURE_OPENAI_ENDPOINT =
  "https://bml-azure-openai-agents.openai.azure.com/openai/deployments/gpt-5-chat/chat/completions?api-version=2025-01-01-preview";

type CallAzureOpenAiChatInput = {
  messages: AzureOpenAiChatMessage[];
  maxTokens?: number;
  tools?: AzureOpenAiTool[];
};

export async function callAzureOpenAiChat({
  messages,
  maxTokens = 700,
  tools,
}: CallAzureOpenAiChatInput): Promise<AzureOpenAiChatResult> {
  const endpoint =
    process.env.AZURE_OPENAI_ENDPOINT?.trim() ||
    DEFAULT_AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();

  if (!endpoint || !apiKey) {
    throw new Error("Configure AZURE_OPENAI_API_KEY na sua variável de ambiente.");
  }

  const payload: Record<string, unknown> = {
    messages,
    max_completion_tokens: maxTokens,
  };
  if (tools && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }

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
            tool_calls?: AzureOpenAiToolCall[];
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

  const message = raw?.choices?.[0]?.message;
  return {
    content: message?.content?.trim() || null,
    toolCalls: message?.tool_calls ?? [],
  };
}
