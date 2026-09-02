import type { AzureOpenAiTool } from "@/lib/azureOpenAi";
import { interpretarConsulta } from "@/lib/documentosInterpretacao";
import { buscarDocumentosConteudo } from "@/lib/documentosRecuperacao";
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
import {
  createEmptyAssistenteInsights,
  type AssistenteContext,
  type AssistenteDominio,
  type AssistenteInsights,
  type AssistenteResultItem,
  type AssistenteSearchOutcome,
  type AssistenteToolResult,
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
  {
    type: "function",
    function: {
      name: "buscar_documentos_conteudo",
      description:
        "Busca documentos pelo CONTEÚDO (texto de laudos, contratos, relatórios) usando busca semântica e textual. Use para perguntas sobre assuntos técnicos, equipamentos, problemas encontrados ou qualquer consulta sobre O QUE está escrito no documento. NÃO use para listagens por metadados (ex.: 'todas as NFs de março') — para isso use buscar_documentos.",
      parameters: {
        type: "object" as const,
        properties: {
          pergunta: {
            type: "string",
            description: "A pergunta em linguagem natural sobre o conteúdo dos documentos",
          },
        },
        required: ["pergunta"],
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

async function executarBuscarDocumentosConteudo(
  args: Record<string, unknown>,
  ctx: AssistenteContext,
): Promise<AssistenteToolResult> {
  const pergunta = typeof args.pergunta === "string" ? args.pergunta : "";
  if (!pergunta.trim()) {
    return { content: JSON.stringify({ erro: "Informe uma pergunta para buscar pelo conteúdo." }) };
  }

  // Load taxonomy terms
  const { data: termosData, error: termosError } = await ctx.supabaseAdmin
    .from("taxonomia_termos")
    .select("termo")
    .eq("ativo", true);
  if (termosError) throw termosError;
  const termosDisponiveis = (termosData ?? []).map((t: { termo: string }) => t.termo);

  // Interpret the question
  const consulta = await interpretarConsulta(pergunta, termosDisponiveis);

  // Resolve lojaTermo → lojaId (best-effort)
  let lojaId: string | undefined;
  if (consulta.lojaTermo) {
    const { data: lojas } = await ctx.supabaseAdmin
      .from("lojas")
      .select("id")
      .ilike("nome", `%${consulta.lojaTermo}%`)
      .limit(1);
    lojaId = (lojas as Array<{ id: string }> | null)?.[0]?.id;
  }

  const { allowedPrestadores, gerenteEntries, canAccess } = await getDocumentosAccessInfo(ctx);

  const resultado = await buscarDocumentosConteudo(
    {
      consulta,
      lojaId,
      userId: ctx.userId,
      allowedPrestadores,
      gerenteEntries,
      canAccess,
      filterPrestadores: [],
      filterLojas: [],
    },
    ctx.supabaseAdmin,
    pergunta,
  );

  // Enrich with metadata (titulo, abrirArquivoPath)
  const metadataMap = new Map<string, { titulo: string; abrirArquivoPath: string | null }>();
  if (resultado.documentos.length > 0) {
    const ids = resultado.documentos.map((d) => d.documentoId);
    const { data: forms } = await ctx.supabaseAdmin
      .from("formularios")
      .select("id, tipo, dados, arquivo_path")
      .in("id", ids);
    for (const f of (forms ?? []) as Array<{
      id: string; tipo: string; dados: Record<string, unknown>; arquivo_path: string | null;
    }>) {
      const lojaNome = typeof f.dados?.["loja_nome"] === "string" ? f.dados["loja_nome"] : "";
      const competencia = typeof f.dados?.["competencia"] === "string" ? f.dados["competencia"] : "";
      const titulo = [f.tipo, lojaNome, competencia].filter(Boolean).join(" — ");
      metadataMap.set(f.id, { titulo, abrirArquivoPath: f.arquivo_path });
    }
  }

  const outcome: AssistenteSearchOutcome = {
    dominio: "documentos",
    filters: resultado.filtrosAplicados,
    filtrosUrl: null,
    summary: resultado.recorteExcedido
      ? resultado.sugestaoRefinamento ?? "Muitos documentos. Refine a busca."
      : resultado.documentos.length === 0
        ? "Nenhum documento encontrado para essa consulta."
        : `Encontrei ${resultado.documentos.length} documento(s) relevante(s).`,
    results: resultado.documentos.map((d) => {
      const meta = metadataMap.get(d.documentoId);
      return {
        id: d.documentoId,
        titulo: meta?.titulo ?? d.documentoId,
        subtitulo: d.trecho.slice(0, 120),
        abrirArquivoPath: meta?.abrirArquivoPath ?? null,
        justificativa: d.justificativa,
        trechoCitado: d.trecho,
        pagina: d.pagina ?? undefined,
      };
    }),
    total: resultado.documentos.length,
    insights: createEmptyAssistenteInsights(),
    confianca: resultado.confianca,
    sugestaoRefinamento: resultado.sugestaoRefinamento,
  };

  const resumoParaModelo = {
    confianca: resultado.confianca,
    recorteExcedido: resultado.recorteExcedido,
    sugestaoRefinamento: resultado.sugestaoRefinamento,
    filtrosAplicados: resultado.filtrosAplicados,
    total: resultado.documentos.length,
    amostra: resultado.documentos.slice(0, 5).map((d) => ({
      documentoId: d.documentoId,
      trecho: d.trecho.slice(0, 200),
      justificativa: d.justificativa,
      pagina: d.pagina,
    })),
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
    partes.push(
      "Use buscar_documentos_conteudo para perguntas sobre o CONTEÚDO dos documentos: assuntos técnicos, equipamentos, laudos, problemas. Use buscar_documentos para LISTAR ou FILTRAR por metadados.",
      "Exemplos: 'laudo do gerador da Matriz' → buscar_documentos_conteudo. 'notas fiscais de março' → buscar_documentos. 'tem recomendação de troca de peças do elevador?' → buscar_documentos_conteudo.",
    );
    return partes.join(" ");
  },
  executarTool: async (nome, args, ctx) => {
    if (nome === "buscar_documentos") {
      return executarBuscarDocumentos(args, ctx);
    }
    if (nome === "buscar_documentos_conteudo") {
      return executarBuscarDocumentosConteudo(args, ctx);
    }
    return { content: JSON.stringify({ erro: `Ferramenta desconhecida: ${nome}` }) };
  },
};
