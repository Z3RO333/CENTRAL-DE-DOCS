import type { AzureOpenAiTool } from "@/lib/azureOpenAi";
import {
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
} from "@/lib/apiAuth";
import {
  DECISAO_STATUS,
  isAprovadorInterno,
  normalizeEmail,
  parseValorTotal,
  type OrcamentoInternoStatus,
} from "@/lib/orcamentosInternos";
import {
  ORCAMENTO_INTERNO_STATUSES,
  STATUS_LABEL,
} from "@/lib/orcamentosInternosShared";
import { formatCurrencyBRL } from "@/lib/documentosApiUtils";
import { buildInsightItems, buildTrendItems } from "@/lib/assistenteInsights";
import type {
  AssistenteContext,
  AssistenteDominio,
  AssistenteInsights,
  AssistenteResultItem,
  AssistenteSearchOutcome,
  AssistenteToolResult,
} from "@/lib/assistenteTypes";

const ORCAMENTOS_MAX_ROWS = 500;
const ORCAMENTO_RESULT_LIMIT = 10;

const TOOLS: AzureOpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "buscar_orcamentos",
      description:
        "Busca orcamentos internos aplicando os filtros informados. Use depois de resolver lojaId/prestadorId com buscar_lojas/buscar_prestadores quando o usuario mencionar uma loja ou prestador.",
      parameters: {
        type: "object",
        properties: {
          termo: {
            type: "string",
            description: "Trecho de texto livre (numero do orcamento, descricao, prestador ou loja)",
          },
          status: { type: "string", enum: [...ORCAMENTO_INTERNO_STATUSES] },
          lojaId: { type: "string", description: "ID exato da loja, obtido via buscar_lojas" },
          prestadorId: { type: "string", description: "ID exato do prestador, obtido via buscar_prestadores" },
          gestorEmail: { type: "string", description: "E-mail do gestor responsavel pela aprovacao" },
          dataInicio: { type: "string", description: "Data inicial no formato AAAA-MM-DD" },
          dataFim: { type: "string", description: "Data final no formato AAAA-MM-DD" },
          valorMin: { type: "number", description: "Valor minimo do orcamento" },
          valorMax: { type: "number", description: "Valor maximo do orcamento" },
          escopo: {
            type: "string",
            enum: ["meus", "aprovacao", "todos"],
            description:
              "meus = so os do proprio usuario (padrao); aprovacao = pendentes de decisao; todos = todos os orcamentos, restrito a administradores e aprovadores",
          },
        },
        required: [],
      },
    },
  },
];

type OrcamentosAccessInfo = { podeVerTudo: boolean; isInternal: boolean };

async function getOrcamentosAccessInfo(ctx: AssistenteContext): Promise<OrcamentosAccessInfo> {
  const cacheKey = "orcamentos:access";
  if (ctx.cache.has(cacheKey)) {
    return ctx.cache.get(cacheKey) as OrcamentosAccessInfo;
  }
  const [prestadores, gerenteEntries, isAprovador] = await Promise.all([
    getAuthorizedPrestadorIds(ctx.email, ctx.supabaseAdmin),
    getGerenteAccessEntries(ctx.userId, ctx.email, ctx.supabaseAdmin),
    isAprovadorInterno(ctx.email, ctx.supabaseAdmin),
  ]);
  const isFornecedorExterno = !ctx.isAdmin && gerenteEntries.length === 0 && prestadores.length > 0;
  const info: OrcamentosAccessInfo = {
    isInternal: !isFornecedorExterno,
    podeVerTudo: ctx.isAdmin || isAprovador,
  };
  ctx.cache.set(cacheKey, info);
  return info;
}

type OrcamentosFiltros = {
  escopo: "meus" | "aprovacao" | "todos";
  status?: OrcamentoInternoStatus;
  lojaId?: string;
  prestadorId?: string;
  gestorEmail?: string;
  dataInicio?: string;
  dataFim?: string;
  valorMin?: number;
  valorMax?: number;
  termo?: string;
};

type OrcamentoRow = {
  id: string;
  numero_orcamento: string;
  prestador_nome: string;
  loja_id: string | null;
  loja_nome: string | null;
  status: OrcamentoInternoStatus;
  valor_total: number | string | null;
  created_at: string;
  arquivo_original_path: string;
  arquivo_assinado_path: string | null;
  solicitante_id: string;
  gestor_email: string;
};

const sanitizeTermo = (termo: string) =>
  termo.replace(/[,()%]/g, " ").replace(/\s+/g, " ").trim();

function buildOrcamentosQuery(
  supabaseAdmin: AssistenteContext["supabaseAdmin"],
  filters: OrcamentosFiltros,
  info: { userId: string; podeVerTudo: boolean },
) {
  let query = supabaseAdmin
    .from("orcamentos_internos")
    .select(
      "id,numero_orcamento,prestador_nome,loja_id,loja_nome,status,valor_total,created_at,arquivo_original_path,arquivo_assinado_path,solicitante_id,gestor_email",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (!info.podeVerTudo) {
    query = query.eq("solicitante_id", info.userId);
  }
  if (filters.escopo === "meus") {
    query = query.eq("solicitante_id", info.userId);
  } else if (filters.escopo === "aprovacao") {
    query = query.in("status", ["aguardando_aprovacao", "em_analise_gestor", "reenviado"]);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.lojaId) {
    query = query.eq("loja_id", filters.lojaId);
  }
  if (filters.prestadorId) {
    query = query.eq("prestador_id", filters.prestadorId);
  }
  if (filters.gestorEmail) {
    query = query.eq("gestor_email", filters.gestorEmail);
  }
  if (filters.dataInicio) {
    query = query.gte("created_at", filters.dataInicio);
  }
  if (filters.dataFim) {
    query = query.lte("created_at", `${filters.dataFim}T23:59:59`);
  }
  if (filters.valorMin !== undefined) {
    query = query.gte("valor_total", filters.valorMin);
  }
  if (filters.valorMax !== undefined) {
    query = query.lte("valor_total", filters.valorMax);
  }
  if (filters.termo) {
    const termo = sanitizeTermo(filters.termo);
    query = query.or(
      `numero_orcamento.ilike.%${termo}%,descricao.ilike.%${termo}%,prestador_nome.ilike.%${termo}%,loja_nome.ilike.%${termo}%`,
    );
  }
  return query;
}

function buildOrcamentosSummary(filters: OrcamentosFiltros): string {
  const partes: string[] = [];
  if (filters.status) partes.push(`status ${STATUS_LABEL[filters.status] ?? filters.status}`);
  if (filters.lojaId) partes.push(`loja ${filters.lojaId}`);
  if (filters.prestadorId) partes.push(`prestador ${filters.prestadorId}`);
  if (filters.gestorEmail) partes.push(`gestor ${filters.gestorEmail}`);
  if (filters.dataInicio) partes.push(`a partir de ${filters.dataInicio}`);
  if (filters.dataFim) partes.push(`até ${filters.dataFim}`);
  if (filters.valorMin !== undefined) partes.push(`valor mínimo ${filters.valorMin}`);
  if (filters.valorMax !== undefined) partes.push(`valor máximo ${filters.valorMax}`);
  if (filters.termo) partes.push(`termo "${filters.termo}"`);
  partes.push(`escopo ${filters.escopo}`);
  return `Critérios usados: ${partes.join(", ")}.`;
}

function buildResultItem(row: OrcamentoRow): AssistenteResultItem {
  const valor = Number(row.valor_total) || 0;
  return {
    id: row.id,
    titulo: `${row.numero_orcamento} — ${row.prestador_nome}`,
    subtitulo: `${STATUS_LABEL[row.status] ?? row.status} · ${formatCurrencyBRL(valor) ?? "sem valor"}`,
    abrirArquivoPath: row.arquivo_assinado_path ?? row.arquivo_original_path,
  };
}

function buildObservacoes(input: {
  total: number;
  valorTotalSoma: number;
  isTruncated: boolean;
}): string[] {
  const frases: string[] = [];
  if (input.total > 0) {
    frases.push(`Foram encontrados ${input.total} orçamento(s) nesta leitura.`);
    frases.push(`Valor total somado: ${formatCurrencyBRL(input.valorTotalSoma)}.`);
  }
  if (input.isTruncated) {
    frases.push(`A análise considera no máximo ${ORCAMENTOS_MAX_ROWS} registros por consulta.`);
  }
  return frases;
}

async function executarBuscarOrcamentos(
  args: Record<string, unknown>,
  ctx: AssistenteContext,
): Promise<AssistenteToolResult> {
  const { podeVerTudo } = await getOrcamentosAccessInfo(ctx);

  const escopoRaw = typeof args.escopo === "string" ? args.escopo : "meus";
  const escopo: "meus" | "aprovacao" | "todos" =
    escopoRaw === "aprovacao" || escopoRaw === "todos" ? escopoRaw : "meus";

  if (escopo === "todos" && !podeVerTudo) {
    return {
      content: JSON.stringify({
        erro: "Escopo 'todos' é restrito a administradores e aprovadores. Tente novamente com escopo 'meus'.",
      }),
    };
  }

  let status: OrcamentoInternoStatus | undefined;
  if (typeof args.status === "string" && args.status.trim()) {
    const statusTrim = args.status.trim();
    if (!(ORCAMENTO_INTERNO_STATUSES as readonly string[]).includes(statusTrim)) {
      return {
        content: JSON.stringify({
          erro: `Status inválido. Valores válidos: ${ORCAMENTO_INTERNO_STATUSES.join(", ")}.`,
        }),
      };
    }
    status = statusTrim as OrcamentoInternoStatus;
  }

  const filters: OrcamentosFiltros = {
    escopo,
    status,
    lojaId: typeof args.lojaId === "string" ? args.lojaId.trim() || undefined : undefined,
    prestadorId: typeof args.prestadorId === "string" ? args.prestadorId.trim() || undefined : undefined,
    gestorEmail: normalizeEmail(typeof args.gestorEmail === "string" ? args.gestorEmail : null) ?? undefined,
    dataInicio: typeof args.dataInicio === "string" ? args.dataInicio.trim() || undefined : undefined,
    dataFim: typeof args.dataFim === "string" ? args.dataFim.trim() || undefined : undefined,
    valorMin: parseValorTotal(args.valorMin) ?? undefined,
    valorMax: parseValorTotal(args.valorMax) ?? undefined,
    termo: typeof args.termo === "string" ? args.termo.trim() || undefined : undefined,
  };

  const query = buildOrcamentosQuery(ctx.supabaseAdmin, filters, {
    userId: ctx.userId,
    podeVerTudo,
  });
  const { data, error, count } = await query.range(0, ORCAMENTOS_MAX_ROWS - 1);
  if (error) {
    throw error;
  }

  const rows = (data ?? []) as OrcamentoRow[];
  const total = count ?? rows.length;
  const isTruncated = total > ORCAMENTOS_MAX_ROWS;

  const porStatus = buildInsightItems(
    rows,
    (r) => r.status,
    (r) => STATUS_LABEL[r.status] ?? r.status,
    rows.length,
    4,
  );
  const porLoja = buildInsightItems(
    rows,
    (r) => r.loja_id ?? r.loja_nome ?? null,
    (r) => r.loja_nome?.trim() || r.loja_id?.trim() || "Sem loja vinculada",
    rows.length,
    5,
  );
  const tendenciaMensal = buildTrendItems(rows, (r) => r.created_at, 6);
  const valorTotalSoma = rows.reduce((acc, r) => acc + (Number(r.valor_total) || 0), 0);
  const totalAguardando = rows.filter((r) => DECISAO_STATUS.has(r.status)).length;
  const totalAprovados = rows.filter((r) => r.status === "aprovado_assinado").length;

  const insights: AssistenteInsights = {
    totais: [
      { key: "totalOrcamentos", label: "Orçamentos", valor: total },
      { key: "totalAguardandoAprovacao", label: "Aguardando aprovação", valor: totalAguardando },
      { key: "totalAprovados", label: "Aprovados", valor: totalAprovados },
      { key: "valorTotal", label: "Valor total", valor: Number(valorTotalSoma.toFixed(2)) },
    ],
    isTruncated,
    porStatus,
    porLoja,
    tendenciaMensal,
    observacoes: buildObservacoes({ total, valorTotalSoma, isTruncated }),
  };

  const outcome: AssistenteSearchOutcome = {
    dominio: "orcamentos",
    filters: filters as unknown as Record<string, unknown>,
    filtrosUrl: "/documentos/orcamentos-internos",
    summary: buildOrcamentosSummary(filters),
    results: rows.slice(0, ORCAMENTO_RESULT_LIMIT).map(buildResultItem),
    total,
    insights,
  };

  const resumoParaModelo = {
    filtrosAplicados: filters,
    total,
    amostra: rows.slice(0, 5).map((r) => ({
      id: r.id,
      numero_orcamento: r.numero_orcamento,
      prestador_nome: r.prestador_nome,
      status: r.status,
      valor_total: r.valor_total,
      loja_nome: r.loja_nome,
      created_at: r.created_at,
    })),
    porStatus,
    porLoja,
  };

  return { content: JSON.stringify(resumoParaModelo), outcome };
}

export const dominioOrcamentos: AssistenteDominio = {
  id: "orcamentos",
  tools: TOOLS,
  podeAcessar: async (ctx) => (await getOrcamentosAccessInfo(ctx)).isInternal,
  descricaoPrompt: (ctx) => {
    const partes = [
      "Para o domínio de orçamentos internos, você tem a ferramenta buscar_orcamentos, além de buscar_lojas e buscar_prestadores (compartilhadas entre domínios).",
      "Por padrão, escopo é 'meus' (só os orçamentos do próprio usuário). Use escopo 'aprovacao' para pendentes de decisão, e 'todos' só se o usuário pedir claramente ver de todo mundo — isso só funciona para administradores e aprovadores; se der erro, explique a restrição e tente de novo com 'meus'.",
      "Se o usuário mencionar uma loja ou prestador por nome, apelido ou código (mesmo parcial), chame buscar_lojas ou buscar_prestadores primeiro para descobrir o ID exato — nunca invente um ID.",
      `Valores válidos de status: ${ORCAMENTO_INTERNO_STATUSES.join(", ")}.`,
    ];
    if (ctx.currentContext?.dominio === "orcamentos" && Object.keys(ctx.currentContext.filtros).length > 0) {
      partes.push(
        `A tela do usuário já está com estes filtros aplicados (contexto, não obrigação de usar): ${JSON.stringify(ctx.currentContext.filtros)}.`,
      );
    }
    return partes.join(" ");
  },
  executarTool: async (nome, args, ctx) => {
    if (nome === "buscar_orcamentos") {
      return executarBuscarOrcamentos(args, ctx);
    }
    return { content: JSON.stringify({ erro: `Ferramenta desconhecida: ${nome}` }) };
  },
};
