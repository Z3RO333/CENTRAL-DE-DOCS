import type { AzureOpenAiTool } from "@/lib/azureOpenAi";
import {
  DOCUMENTO_COPILOT_STATUS,
  DOCUMENTO_COPILOT_TYPES,
  buildSearchSummary,
  queryDocumentoCandidates,
  stripKnownFilters,
  type DocumentoCopilotFilters,
  type DocumentoCopilotInsights,
  type DocumentoCopilotMatch,
} from "@/lib/documentosCopilot";
import {
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
  hasDocumentosAccess,
  type GerenteAccessRow,
} from "@/lib/apiAuth";
import type {
  AssistenteContext,
  AssistenteDominio,
  AssistenteInsights,
  AssistenteResultItem,
  AssistenteSearchOutcome,
  AssistenteToolResult,
} from "@/lib/assistenteTypes";

const TOOLS: AzureOpenAiTool[] = [
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
];

type DocumentosAccessInfo = {
  allowedPrestadores: string[];
  gerenteEntries: GerenteAccessRow[];
  canAccess: boolean;
};

async function getDocumentosAccessInfo(ctx: AssistenteContext): Promise<DocumentosAccessInfo> {
  const cacheKey = "documentos:access";
  if (ctx.cache.has(cacheKey)) {
    return ctx.cache.get(cacheKey) as DocumentosAccessInfo;
  }
  const [allowedPrestadores, gerenteEntries, canAccess] = await Promise.all([
    getAuthorizedPrestadorIds(ctx.email, ctx.supabaseAdmin),
    getGerenteAccessEntries(ctx.userId, ctx.email, ctx.supabaseAdmin),
    hasDocumentosAccess(ctx.userId, ctx.email, ctx.supabaseAdmin),
  ]);
  const info: DocumentosAccessInfo = { allowedPrestadores, gerenteEntries, canAccess };
  ctx.cache.set(cacheKey, info);
  return info;
}

function buildDocumentosUrl(filters: DocumentoCopilotFilters): string {
  const params = new URLSearchParams();
  const appendString = (key: string, value?: string) => {
    if (value?.trim()) {
      params.set(key, value.trim());
    }
  };
  appendString("identificacao", filters.termo);
  appendString("tipo", filters.tipo);
  appendString("tipoLaudo", filters.tipoLaudo);
  appendString("status", filters.status);
  appendString("ano", filters.ano);
  appendString("mes", filters.mes);
  appendString("lojaId", filters.lojaId);
  appendString("prestadorId", filters.prestadorId);
  if (filters.somenteAssinados) {
    params.set("somenteAssinados", "true");
  }
  if (filters.somenteDisponiveisLote) {
    params.set("somenteDisponiveisLote", "true");
  }
  params.set("source", "assistente");
  return `/documentos?${params.toString()}`;
}

function buildResultItem(match: DocumentoCopilotMatch): AssistenteResultItem {
  return {
    id: match.id,
    titulo: match.nome,
    subtitulo: [match.identificacao, match.lojaNome].filter(Boolean).join(" · "),
    abrirArquivoPath: match.arquivoAssinadoPath ?? match.arquivoPath,
  };
}

function toAssistenteInsights(insights: DocumentoCopilotInsights): AssistenteInsights {
  return {
    totais: [
      { key: "totalDocumentos", label: "Documentos", valor: insights.totalDocumentos },
      { key: "totalLojas", label: "Lojas", valor: insights.totalLojas },
      { key: "totalPendentes", label: "Pendentes", valor: insights.totalPendentes },
      { key: "totalAssinados", label: "Assinados", valor: insights.totalAssinados },
    ],
    isTruncated: insights.isTruncated,
    porStatus: insights.porStatus,
    porLoja: insights.porLoja,
    tendenciaMensal: insights.tendenciaMensal,
    observacoes: insights.observacoes,
  };
}

async function executarBuscarDocumentos(
  args: Record<string, unknown>,
  ctx: AssistenteContext,
): Promise<AssistenteToolResult> {
  const filters = stripKnownFilters(args as DocumentoCopilotFilters);
  if (Object.keys(filters).length === 0) {
    return {
      content: JSON.stringify({
        erro:
          "Nenhum filtro foi informado. Peca ao usuario pelo menos um criterio (tipo, status, loja, prestador, mes/ano ou um trecho de texto) antes de buscar.",
      }),
    };
  }

  const { allowedPrestadores, gerenteEntries, canAccess } = await getDocumentosAccessInfo(ctx);
  const { matches, total, insights } = await queryDocumentoCandidates({
    filters,
    userId: ctx.userId,
    allowedPrestadores,
    gerenteEntries,
    canAccess,
    supabaseAdmin: ctx.supabaseAdmin,
  });

  const outcome: AssistenteSearchOutcome = {
    dominio: "documentos",
    filters,
    filtrosUrl: buildDocumentosUrl(filters),
    summary: buildSearchSummary(filters),
    results: matches.map(buildResultItem),
    total,
    insights: toAssistenteInsights(insights),
  };

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

  return { content: JSON.stringify(resumoParaModelo), outcome };
}

export const dominioDocumentos: AssistenteDominio = {
  id: "documentos",
  tools: TOOLS,
  podeAcessar: async () => true,
  descricaoPrompt: (ctx) => {
    const partes = [
      "Para o domínio de documentos, você tem a ferramenta buscar_documentos, além de buscar_lojas e buscar_prestadores (compartilhadas entre domínios).",
      "Se o usuário mencionar uma loja ou prestador por nome, apelido ou código (mesmo parcial), chame buscar_lojas ou buscar_prestadores primeiro para descobrir o ID exato — nunca invente um ID.",
      "Se buscar_lojas ou buscar_prestadores devolver mais de um resultado plausível e a pergunta não deixar claro qual é, pergunte ao usuário qual deles antes de chamar buscar_documentos.",
      `Valores válidos de tipo: ${Object.keys(DOCUMENTO_COPILOT_TYPES).join(", ")}.`,
      `Valores válidos de status: ${DOCUMENTO_COPILOT_STATUS.join(", ")}.`,
    ];
    if (ctx.currentContext?.dominio === "documentos") {
      const filtrosAtuais = stripKnownFilters(ctx.currentContext.filtros as DocumentoCopilotFilters);
      if (Object.keys(filtrosAtuais).length > 0) {
        partes.push(
          `A tela do usuário já está com estes filtros aplicados (contexto, não obrigação de usar): ${JSON.stringify(filtrosAtuais)}.`,
        );
      }
    }
    return partes.join(" ");
  },
  executarTool: async (nome, args, ctx) => {
    if (nome === "buscar_documentos") {
      return executarBuscarDocumentos(args, ctx);
    }
    return { content: JSON.stringify({ erro: `Ferramenta desconhecida: ${nome}` }) };
  },
};
