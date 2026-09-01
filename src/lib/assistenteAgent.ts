import {
  callAzureOpenAiChat,
  type AzureOpenAiChatMessage,
  type AzureOpenAiTool,
} from "@/lib/azureOpenAi";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { ApiHttpError } from "@/lib/apiAuth";
import {
  appendConversaTurno,
  getConversaMensagens,
  type AssistenteMensagem,
} from "@/lib/assistenteConversas";
import {
  buscarLojasPorNome,
  buscarPrestadoresPorNome,
} from "@/lib/documentosCopilotEntitySearch";
import { dominioDocumentos } from "@/lib/assistenteDominioDocumentos";
import {
  createEmptyAssistenteInsights,
  type AssistenteContext,
  type AssistenteDominio,
  type AssistenteDominioId,
  type AssistenteInsights,
  type AssistenteResultItem,
  type AssistenteSearchOutcome,
} from "@/lib/assistenteTypes";

export const MAX_AGENT_TOOL_ITERATIONS = 5;
const MAX_HISTORY_MESSAGES = 10;

const DOMINIOS_REGISTRADOS: AssistenteDominio[] = [dominioDocumentos];

const INTRO_PROMPT =
  "Você é um assistente virtual interno do sistema. Nunca invente documentos, IDs ou dados fora do que as ferramentas devolveram. " +
  "Nunca proponha executar uma ação (aplicar filtro, abrir documento, disparar cobrança, aprovar orçamento) — você só busca e explica; " +
  "quem decide agir é o usuário. Responda sempre em português do Brasil, de forma curta e direta, citando números relevantes quando fizer sentido.";

const SHARED_TOOLS: AzureOpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "buscar_lojas",
      description:
        "Procura lojas por nome ou codigo parecido com o termo informado. Use quando o usuario mencionar uma loja por nome, apelido ou codigo parcial.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Termo de busca (nome ou codigo parcial da loja)" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_prestadores",
      description:
        "Procura prestadores por nome parecido com o termo informado. Use quando o usuario mencionar um prestador por nome ou apelido.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Termo de busca (nome parcial do prestador)" } },
        required: ["query"],
      },
    },
  },
];

const SHARED_TOOL_NAMES = new Set(SHARED_TOOLS.map((tool) => tool.function.name));

export type AssistenteAgentAuth = {
  userId: string;
  email: string | null;
  isAdmin: boolean;
};

export type AssistenteAgentRequest = {
  pergunta: string;
  currentContext?: { dominio: AssistenteDominioId; filtros: Record<string, unknown> };
};

export type AssistenteResponse = {
  reply: string;
  dominio: AssistenteDominioId | null;
  summary: string;
  filters: Record<string, unknown>;
  filtrosUrl: string | null;
  results: AssistenteResultItem[];
  total: number;
  insights: AssistenteInsights;
};

const parseToolArguments = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export async function runAssistenteAgent(
  request: AssistenteAgentRequest,
  auth: AssistenteAgentAuth,
  dominios: AssistenteDominio[] = DOMINIOS_REGISTRADOS,
): Promise<AssistenteResponse> {
  const supabaseAdmin = createSupabaseAdminClient();
  const ctx: AssistenteContext = {
    supabaseAdmin,
    userId: auth.userId,
    email: auth.email,
    isAdmin: auth.isAdmin,
    currentContext: request.currentContext,
    cache: new Map(),
  };

  const acessiveisFlags = await Promise.all(dominios.map((dominio) => dominio.podeAcessar(ctx)));
  const acessiveis = dominios.filter((_, index) => acessiveisFlags[index]);

  const toolOwner = new Map<string, AssistenteDominio>();
  for (const dominio of acessiveis) {
    for (const tool of dominio.tools) {
      toolOwner.set(tool.function.name, dominio);
    }
  }

  const tools: AzureOpenAiTool[] = [...SHARED_TOOLS, ...acessiveis.flatMap((d) => d.tools)];
  const systemPrompt = [INTRO_PROMPT, ...acessiveis.map((d) => d.descricaoPrompt(ctx))].join(" ");

  const historico = await getConversaMensagens(auth.userId, supabaseAdmin);
  const perguntaMensagem: AssistenteMensagem = {
    role: "user",
    text: request.pergunta,
    criado_em: new Date().toISOString(),
  };

  const messages: AzureOpenAiChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...historico.slice(-MAX_HISTORY_MESSAGES).map(
      (m): AzureOpenAiChatMessage =>
        m.role === "user" ? { role: "user", content: m.text } : { role: "assistant", content: m.text },
    ),
    { role: "user", content: request.pergunta },
  ];

  let lastOutcome: AssistenteSearchOutcome | null = null;
  let finalReply: string | null = null;

  for (let iteration = 0; iteration < MAX_AGENT_TOOL_ITERATIONS; iteration += 1) {
    const result = await callAzureOpenAiChat({ messages, maxTokens: 700, tools });

    if (result.toolCalls.length === 0) {
      finalReply = result.content?.trim() || null;
      break;
    }

    messages.push({ role: "assistant", content: result.content, tool_calls: result.toolCalls });

    for (const toolCall of result.toolCalls) {
      const args = parseToolArguments(toolCall.function.arguments);
      let content: string;
      let outcome: AssistenteSearchOutcome | undefined;

      try {
        if (toolCall.function.name === "buscar_lojas") {
          const lojas = await buscarLojasPorNome(typeof args.query === "string" ? args.query : "", supabaseAdmin);
          content = JSON.stringify({ lojas });
        } else if (toolCall.function.name === "buscar_prestadores") {
          const prestadores = await buscarPrestadoresPorNome(
            typeof args.query === "string" ? args.query : "",
            supabaseAdmin,
          );
          content = JSON.stringify({ prestadores });
        } else {
          const dominio = toolOwner.get(toolCall.function.name);
          if (!dominio) {
            content = JSON.stringify({ erro: `Ferramenta desconhecida: ${toolCall.function.name}` });
          } else {
            const toolResult = await dominio.executarTool(toolCall.function.name, args, ctx);
            content = toolResult.content;
            outcome = toolResult.outcome;
          }
        }
      } catch (err) {
        if (err instanceof ApiHttpError) {
          throw err;
        }
        content = JSON.stringify({
          erro: "Nao foi possivel executar essa acao agora. Tente novamente ou ajuste o pedido.",
        });
      }

      if (outcome) {
        lastOutcome = outcome;
      }
      messages.push({ role: "tool", tool_call_id: toolCall.id, content });
    }
  }

  const reply =
    finalReply ||
    (lastOutcome
      ? lastOutcome.results.length > 0
        ? `Encontrei ${lastOutcome.results.length} resultado(s) que parecem corresponder à sua busca.`
        : "Não encontrei resultados com esses critérios. Posso ajustar a busca se você me disser mais um detalhe."
      : "Me diga um pouco mais sobre o que você precisa.");

  const respostaMensagem: AssistenteMensagem = {
    role: "assistant",
    text: reply,
    dominio: lastOutcome?.dominio,
    criado_em: new Date().toISOString(),
  };
  await appendConversaTurno(
    auth.userId,
    { pergunta: perguntaMensagem, resposta: respostaMensagem },
    supabaseAdmin,
  );

  return {
    reply,
    dominio: lastOutcome?.dominio ?? null,
    summary: lastOutcome?.summary ?? "Sem filtros aplicados.",
    filters: lastOutcome?.filters ?? {},
    filtrosUrl: lastOutcome?.filtrosUrl ?? null,
    results: lastOutcome?.results ?? [],
    total: lastOutcome?.total ?? 0,
    insights: lastOutcome?.insights ?? createEmptyAssistenteInsights(),
  };
}

export const isSharedToolName = (name: string) => SHARED_TOOL_NAMES.has(name);
