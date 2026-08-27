import {
  type AzureOpenAiChatMessage,
  type AzureOpenAiTool,
  type AzureOpenAiToolCall,
  callAzureOpenAiChat,
} from "@/lib/azureOpenAi";
import {
  DOCUMENTO_COPILOT_STATUS,
  DOCUMENTO_COPILOT_TYPES,
  buildSearchSummary,
  createEmptyInsights,
  queryDocumentoCandidates,
  stripKnownFilters,
  type DocumentoCopilotFilters,
  type DocumentoCopilotInsights,
  type DocumentoCopilotMatch,
  type DocumentoCopilotResponse,
} from "@/lib/documentosCopilot";
import {
  buscarLojasPorNome,
  buscarPrestadoresPorNome,
} from "@/lib/documentosCopilotEntitySearch";
import {
  ApiHttpError,
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
  hasDocumentosAccess,
  type GerenteAccessRow,
} from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

export type DocumentoCopilotAgentMessage = {
  role: "user" | "assistant";
  text: string;
};

export type DocumentoCopilotAgentRequest = {
  messages: DocumentoCopilotAgentMessage[];
  currentFilters?: DocumentoCopilotFilters;
};

export const MAX_AGENT_TOOL_ITERATIONS = 5;
const MAX_HISTORY_MESSAGES = 10;

const AGENT_TOOLS: AzureOpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "buscar_documentos",
      description:
        "Busca documentos no sistema aplicando os filtros informados. Use depois de resolver lojaId/prestadorId com buscar_lojas/buscar_prestadores quando o usuario mencionar uma loja ou prestador.",
      parameters: {
        type: "object",
        properties: {
          termo: { type: "string", description: "Trecho de texto livre (nome, numero de documento, etc.)" },
          tipo: { type: "string", enum: Object.keys(DOCUMENTO_COPILOT_TYPES) },
          status: { type: "string", enum: [...DOCUMENTO_COPILOT_STATUS] },
          tipoLaudo: { type: "string", description: "Tipo de laudo, quando mencionado" },
          ano: { type: "string", description: "Ano no formato AAAA" },
          mes: { type: "string", description: "Mes no formato MM (01-12)" },
          lojaId: { type: "string", description: "ID exato da loja, obtido via buscar_lojas" },
          prestadorId: { type: "string", description: "ID exato do prestador, obtido via buscar_prestadores" },
          somenteAssinados: { type: "boolean" },
          somenteDisponiveisLote: { type: "boolean" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_lojas",
      description:
        "Procura lojas por nome ou codigo parecido com o termo informado. Use quando o usuario mencionar uma loja por nome, apelido ou codigo parcial.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termo de busca (nome ou codigo parcial da loja)" },
        },
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
        properties: {
          query: { type: "string", description: "Termo de busca (nome parcial do prestador)" },
        },
        required: ["query"],
      },
    },
  },
];

const buildSystemPrompt = (currentFilters?: DocumentoCopilotFilters) => {
  const filtrosAtuais = currentFilters ? stripKnownFilters(currentFilters) : {};
  const partes = [
    "Você é um copiloto interno para encontrar documentos em um sistema corporativo.",
    "Você tem ferramentas: buscar_documentos, buscar_lojas e buscar_prestadores. Use quantas precisar, na ordem que fizer sentido, antes de responder.",
    "Se o usuário mencionar uma loja ou prestador por nome, apelido ou código (mesmo parcial), chame buscar_lojas ou buscar_prestadores primeiro para descobrir o ID exato — nunca invente um ID.",
    "Se buscar_lojas ou buscar_prestadores devolver mais de um resultado plausível e a pergunta não deixar claro qual é, pergunte ao usuário qual deles antes de chamar buscar_documentos.",
    "Nunca invente documentos, IDs ou dados fora do que as ferramentas devolveram. Nunca proponha executar uma ação (aplicar filtro, abrir documento, assinar) — você só busca e explica; quem decide agir é o usuário.",
    "Responda sempre em português do Brasil, de forma curta e direta, citando números relevantes (total encontrado, por exemplo) quando fizer sentido.",
    `Valores válidos de tipo: ${Object.keys(DOCUMENTO_COPILOT_TYPES).join(", ")}.`,
    `Valores válidos de status: ${DOCUMENTO_COPILOT_STATUS.join(", ")}.`,
  ];
  if (Object.keys(filtrosAtuais).length > 0) {
    partes.push(
      `A tela do usuário já está com estes filtros aplicados (contexto, não obrigação de usar): ${JSON.stringify(filtrosAtuais)}.`,
    );
  }
  return partes.join(" ");
};

type AgentContext = {
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
  userId: string;
  allowedPrestadores: string[];
  gerenteEntries: GerenteAccessRow[];
  canAccess: boolean;
};

type SearchOutcome = {
  filters: DocumentoCopilotFilters;
  matches: DocumentoCopilotMatch[];
  total: number;
  insights: DocumentoCopilotInsights;
};

const parseToolArguments = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

async function executeToolCall(
  toolCall: AzureOpenAiToolCall,
  ctx: AgentContext,
): Promise<{ content: string; searchOutcome?: SearchOutcome }> {
  const args = parseToolArguments(toolCall.function.arguments);

  if (toolCall.function.name === "buscar_documentos") {
    const filters = stripKnownFilters(args as DocumentoCopilotFilters);
    if (Object.keys(filters).length === 0) {
      return {
        content: JSON.stringify({
          erro: "Nenhum filtro foi informado. Peca ao usuario pelo menos um criterio (tipo, status, loja, prestador, mes/ano ou um trecho de texto) antes de buscar.",
        }),
      };
    }
    const { matches, total, insights } = await queryDocumentoCandidates({
      filters,
      userId: ctx.userId,
      allowedPrestadores: ctx.allowedPrestadores,
      gerenteEntries: ctx.gerenteEntries,
      canAccess: ctx.canAccess,
      supabaseAdmin: ctx.supabaseAdmin,
    });
    const resumoParaModelo = {
      filtrosAplicados: filters,
      total,
      amostra: matches.slice(0, 5).map((match) => ({
        id: match.id,
        tipo: match.tipo,
        status: match.status,
        identificacao: match.identificacao,
        lojaNome: match.lojaNome,
        prestadorNome: match.prestadorNome,
        created_at: match.created_at,
      })),
      porStatus: insights.porStatus,
      porLoja: insights.porLoja,
    };
    return {
      content: JSON.stringify(resumoParaModelo),
      searchOutcome: { filters, matches, total, insights },
    };
  }

  if (toolCall.function.name === "buscar_lojas") {
    const query = typeof args.query === "string" ? args.query : "";
    const lojas = await buscarLojasPorNome(query, ctx.supabaseAdmin);
    return { content: JSON.stringify({ lojas }) };
  }

  if (toolCall.function.name === "buscar_prestadores") {
    const query = typeof args.query === "string" ? args.query : "";
    const prestadores = await buscarPrestadoresPorNome(query, ctx.supabaseAdmin);
    return { content: JSON.stringify({ prestadores }) };
  }

  return {
    content: JSON.stringify({ erro: `Ferramenta desconhecida: ${toolCall.function.name}` }),
  };
}

export async function runDocumentoCopilotAgent(
  request: DocumentoCopilotAgentRequest,
  auth: { userId: string; email: string | null },
): Promise<DocumentoCopilotResponse> {
  const supabaseAdmin = createSupabaseAdminClient();
  const allowedPrestadores = await getAuthorizedPrestadorIds(auth.email, supabaseAdmin);
  const gerenteEntries = await getGerenteAccessEntries(auth.userId, auth.email, supabaseAdmin);
  const canAccess = await hasDocumentosAccess(auth.userId, auth.email, supabaseAdmin);

  const ctx: AgentContext = {
    supabaseAdmin,
    userId: auth.userId,
    allowedPrestadores,
    gerenteEntries,
    canAccess,
  };

  const history = request.messages.slice(-MAX_HISTORY_MESSAGES);
  const messages: AzureOpenAiChatMessage[] = [
    { role: "system", content: buildSystemPrompt(request.currentFilters) },
    ...history.map(
      (turn): AzureOpenAiChatMessage => ({ role: turn.role, content: turn.text }),
    ),
  ];

  let lastOutcome: SearchOutcome | null = null;
  let finalReply: string | null = null;

  for (let iteration = 0; iteration < MAX_AGENT_TOOL_ITERATIONS; iteration += 1) {
    const result = await callAzureOpenAiChat({
      messages,
      maxTokens: 700,
      tools: AGENT_TOOLS,
    });

    if (result.toolCalls.length === 0) {
      finalReply = result.content?.trim() || null;
      break;
    }

    messages.push({
      role: "assistant",
      content: result.content,
      tool_calls: result.toolCalls,
    });

    for (const toolCall of result.toolCalls) {
      let content: string;
      let searchOutcome: SearchOutcome | undefined;
      try {
        ({ content, searchOutcome } = await executeToolCall(toolCall, ctx));
      } catch (err) {
        if (err instanceof ApiHttpError) {
          throw err;
        }
        content = JSON.stringify({
          erro: "Nao foi possivel executar essa busca agora. Tente novamente ou ajuste o pedido.",
        });
      }
      if (searchOutcome) {
        lastOutcome = searchOutcome;
      }
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content,
      });
    }
  }

  const filters = lastOutcome?.filters ?? {};
  const reply =
    finalReply ||
    (lastOutcome
      ? lastOutcome.matches.length > 0
        ? `Encontrei ${lastOutcome.matches.length} documento(s) que parecem corresponder à sua busca.`
        : "Não encontrei documentos com esses critérios. Posso ajustar a busca se você me disser mais um detalhe."
      : "Posso procurar por tipo, status, loja, prestador, mês ou um trecho do nome do documento. Me diga um detalhe a mais.");

  return {
    reply,
    summary: buildSearchSummary(filters),
    filters,
    results: lastOutcome?.matches ?? [],
    total: lastOutcome?.total ?? 0,
    insights: lastOutcome?.insights ?? createEmptyInsights(),
  } satisfies DocumentoCopilotResponse;
}
