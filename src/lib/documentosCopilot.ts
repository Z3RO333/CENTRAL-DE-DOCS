import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  buildDocumentosTextSearchOr,
  normalizeIds,
  safeParseDados,
  sanitizeId,
} from "@/lib/documentosApiUtils";
import { buildDocumentosAccessOr } from "@/lib/documentosAccessFilters";
import { callAzureOpenAiChat } from "@/lib/azureOpenAi";
import {
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
  hasDocumentosAccess,
  type GerenteAccessRow,
} from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { fixMojibakeText, normalizeDisplayData } from "@/lib/textEncoding";

export const DOCUMENTO_COPILOT_LIMIT = 8;

export const DOCUMENTO_COPILOT_TYPES = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
} as const;

export const DOCUMENTO_COPILOT_STATUS = [
  "pendente",
  "em_analise",
  "revisado",
  "assinado",
] as const;

export type DocumentoCopilotFilters = {
  termo?: string;
  tipo?: string;
  tipoLaudo?: string;
  status?: string;
  ano?: string;
  mes?: string;
  lojaId?: string;
  prestadorId?: string;
  somenteAssinados?: boolean;
  somenteDisponiveisLote?: boolean;
};

export type DocumentoCopilotMatch = {
  id: string;
  tipo: string;
  status: string;
  created_at: string;
  nome: string;
  identificacao: string;
  complemento: string | null;
  lojaId: string | null;
  lojaNome: string | null;
  prestadorId: string | null;
  prestadorNome: string | null;
  tipoLaudo: string | null;
  observacoes: string | null;
};

export type DocumentoCopilotInsightItem = {
  key: string;
  label: string;
  total: number;
  percentual: number;
};

export type DocumentoCopilotTrendItem = {
  key: string;
  label: string;
  total: number;
};

export type DocumentoCopilotInsights = {
  totalDocumentos: number;
  totalLojas: number;
  totalPrestadores: number;
  totalAssinados: number;
  totalPendentes: number;
  totalEmAnalise: number;
  isTruncated: boolean;
  porStatus: DocumentoCopilotInsightItem[];
  porTipo: DocumentoCopilotInsightItem[];
  porLoja: DocumentoCopilotInsightItem[];
  tendenciaMensal: DocumentoCopilotTrendItem[];
  observacoes: string[];
};

export type DocumentoCopilotResponse = {
  reply: string;
  summary: string;
  filters: DocumentoCopilotFilters;
  results: DocumentoCopilotMatch[];
  total: number;
  insights: DocumentoCopilotInsights;
};

export type DocumentoCopilotRequest = {
  message?: string;
  currentFilters?: DocumentoCopilotFilters;
};

type Row = {
  id: string;
  tipo: string;
  status: string;
  created_at: string;
  dados: Record<string, unknown> | string | null;
  arquivo_path: string;
  arquivo_assinado_path: string | null;
  prestador_id: string | null;
  user_id: string;
};

type CandidateRow = Row & {
  lojaId: string | null;
  identificacao: string;
  complemento: string | null;
  tipoLaudo: string | null;
  observacoes: string | null;
  nome: string;
  lojaNome: string | null;
};

type EntityRow = {
  id: string;
  nome: string | null;
};

type LojaLookupRow = {
  id: string;
  nome: string | null;
  codigo: string | null;
};

type PrestadorLookupRow = {
  id: string;
  nome: string | null;
};

type InsightCount = {
  key: string;
  label: string;
  total: number;
};

const humanize = (value: string) =>
  value
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeTipoValue = (value: string) => {
  const normalized = normalizeText(value).toLowerCase();
  const map: Record<string, string> = {
    retencao_trabalhista: "retencao_trabalhista",
    "retencao trabalhista": "retencao_trabalhista",
    "retenção trabalhista": "retencao_trabalhista",
    registro_laudos: "registro_laudos",
    "registro e laudos": "registro_laudos",
    "registro laudos": "registro_laudos",
    notas_fiscais: "notas_fiscais",
    "notas fiscais": "notas_fiscais",
  };
  return map[normalized] ?? null;
};

const normalizeStatusValue = (value: string) => {
  const normalized = normalizeText(value).toLowerCase();
  const map: Record<string, string> = {
    pendente: "pendente",
    "em analise": "em_analise",
    em_analise: "em_analise",
    revisado: "revisado",
    assinado: "assinado",
    assinados: "assinado",
  };
  return map[normalized] ?? null;
};

const normalizeMesValue = (value: string) => {
  const normalized = normalizeText(value).toLowerCase();
  if (/^(0?[1-9]|1[0-2])$/.test(normalized)) {
    return normalized.padStart(2, "0");
  }
  const map: Record<string, string> = {
    janeiro: "01",
    fevereiro: "02",
    marco: "03",
    abril: "04",
    maio: "05",
    junho: "06",
    julho: "07",
    agosto: "08",
    setembro: "09",
    outubro: "10",
    novembro: "11",
    dezembro: "12",
  };
  return map[normalized] ?? null;
};

const getCampoTexto = (
  dados: Record<string, unknown> | null,
  campos: string[],
) => {
  if (!dados) {
    return null;
  }

  for (const campo of campos) {
    const valor = dados[campo];
    if (typeof valor === "string" && valor.trim()) {
      return fixMojibakeText(valor.trim());
    }
  }

  return null;
};

const getIdentificacao = (registro: {
  tipo: string;
  dados: Record<string, unknown> | null;
}) => {
  switch (registro.tipo) {
    case "retencao_trabalhista":
      return getCampoTexto(registro.dados, ["empresa"]);
    case "registro_laudos":
      return getCampoTexto(registro.dados, ["prestador", "responsavel"]);
    case "notas_fiscais":
      return getCampoTexto(registro.dados, ["numero_pedido", "numero_nf"]);
    default:
      return getCampoTexto(registro.dados, ["empresa", "prestador"]);
  }
};

const getComplemento = (registro: {
  tipo: string;
  dados: Record<string, unknown> | null;
}) => {
  switch (registro.tipo) {
    case "retencao_trabalhista":
      return getCampoTexto(registro.dados, ["cnpj"]);
    case "registro_laudos":
      return getCampoTexto(registro.dados, ["responsavel"]);
    case "notas_fiscais":
      return getCampoTexto(registro.dados, ["cnpj_emitente"]);
    default:
      return getCampoTexto(registro.dados, ["observacoes", "cnpj"]);
  }
};

const getTipoLaudo = (dados: Record<string, unknown> | null) =>
  getCampoTexto(dados, ["tipo_laudo"]);

const getObservacoes = (dados: Record<string, unknown> | null) =>
  getCampoTexto(dados, ["observacoes", "descricao"]);

const getLojaId = (dados: Record<string, unknown> | null) =>
  getCampoTexto(dados, ["loja_id"]);

const getLojaNome = (dados: Record<string, unknown> | null) =>
  getCampoTexto(dados, ["loja_nome"]);

const getNomeDocumento = (registro: Row) => {
  const dados = safeParseDados(registro.dados);
  const anexos = dados?.anexos;
  if (Array.isArray(anexos) && anexos.length > 0) {
    const primeiro = anexos[0] as { nome?: unknown } | null;
    if (primeiro && typeof primeiro.nome === "string" && primeiro.nome.trim()) {
      return fixMojibakeText(primeiro.nome.trim());
    }
  }

  const path = registro.arquivo_assinado_path ?? registro.arquivo_path;
  return fixMojibakeText(path.split("/").pop() ?? registro.id);
};

const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  em_analise: "Em análise",
  revisado: "Revisado",
  assinado: "Assinado",
};

const TIPO_LABELS: Record<string, string> = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
};

const MONTH_LABELS: Record<string, string> = {
  "01": "janeiro",
  "02": "fevereiro",
  "03": "março",
  "04": "abril",
  "05": "maio",
  "06": "junho",
  "07": "julho",
  "08": "agosto",
  "09": "setembro",
  "10": "outubro",
  "11": "novembro",
  "12": "dezembro",
};

const formatStatusLabel = (value: string) =>
  STATUS_LABELS[value] ?? humanize(value);

const formatTipoLabel = (value: string) =>
  TIPO_LABELS[value] ?? humanize(value);

const getInsightLabel = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return "Não informado";
  }
  const trimmed = value.trim();
  return trimmed || "Não informado";
};

const buildInsightItems = (
  rows: CandidateRow[],
  getKey: (row: CandidateRow) => string | null | undefined,
  getLabel: (row: CandidateRow) => string,
  totalBase: number,
  limit = 5,
) => {
  const grouped = new Map<string, InsightCount>();

  rows.forEach((row) => {
    const rawKey = getKey(row);
    const key = getInsightLabel(rawKey);
    const current = grouped.get(key);
    if (current) {
      current.total += 1;
      return;
    }
    grouped.set(key, {
      key,
      label: getLabel(row),
      total: 1,
    });
  });

  return Array.from(grouped.values())
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((item) => ({
      key: item.key,
      label: item.label,
      total: item.total,
      percentual:
        totalBase > 0 ? Number(((item.total / totalBase) * 100).toFixed(1)) : 0,
    }));
};

const buildTrendItems = (rows: CandidateRow[], limit = 6) => {
  if (rows.length === 0) {
    return [];
  }

  const grouped = new Map<string, number>();
  rows.forEach((row) => {
    const date = new Date(row.created_at);
    if (Number.isNaN(date.getTime())) {
      return;
    }
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  });

  const baseDate = new Date(rows[0].created_at);
  if (Number.isNaN(baseDate.getTime())) {
    return [];
  }

  const points: { key: string; label: string }[] = [];
  const cursor = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  for (let index = 0; index < limit; index += 1) {
    const monthDate = new Date(
      cursor.getFullYear(),
      cursor.getMonth() - (limit - 1 - index),
      1,
    );
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
    points.push({
      key,
      label: monthDate.toLocaleDateString("pt-BR", {
        month: "short",
        year: "2-digit",
      }).replace(".", ""),
    });
  }

  return points.map((point) => ({
    ...point,
    total: grouped.get(point.key) ?? 0,
  }));
};

const buildInsightsSummary = (input: {
  total: number;
  totalAssinados: number;
  totalPendentes: number;
  totalEmAnalise: number;
  topLoja?: DocumentoCopilotInsightItem | null;
  topStatus?: DocumentoCopilotInsightItem | null;
  isTruncated: boolean;
}) => {
  const frases: string[] = [];
  if (input.total > 0) {
    frases.push(`Foram encontrados ${input.total} documentos nesta leitura.`);
  }
  if (input.topLoja) {
    frases.push(
      `${input.topLoja.label} lidera com ${input.topLoja.total} documento(s) (${input.topLoja.percentual}%).`,
    );
  }
  if (input.totalPendentes > 0 || input.totalEmAnalise > 0 || input.totalAssinados > 0) {
    frases.push(
      `${input.totalPendentes} pendentes, ${input.totalEmAnalise} em análise e ${input.totalAssinados} assinados.`,
    );
  }
  if (input.topStatus) {
    frases.push(
      `O status mais frequente é ${input.topStatus.label.toLowerCase()}.`,
    );
  }
  if (input.isTruncated) {
    frases.push("A análise considera no máximo 1000 registros por consulta.");
  }

  return frases.slice(0, 4);
};

const buildAnalyticInsights = (input: {
  rows: CandidateRow[];
  total: number;
  isTruncated: boolean;
}) => {
  const { rows, total, isTruncated } = input;
  const porStatus = buildInsightItems(
    rows,
    (row) => row.status,
    (row) => formatStatusLabel(row.status),
    rows.length,
    4,
  );
  const porTipo = buildInsightItems(
    rows,
    (row) => row.tipo,
    (row) => formatTipoLabel(row.tipo),
    rows.length,
    3,
  );
  const porLoja = buildInsightItems(
    rows,
    (row) => row.lojaId ?? row.lojaNome ?? null,
    (row) =>
      row.lojaNome?.trim() ||
      row.lojaId?.trim() ||
      "Sem loja vinculada",
    rows.length,
    5,
  );
  const tendenciaMensal = buildTrendItems(rows);

  const totalAssinados = porStatus.find((item) => item.key === "assinado")?.total ?? 0;
  const totalPendentes = porStatus.find((item) => item.key === "pendente")?.total ?? 0;
  const totalEmAnalise = porStatus.find((item) => item.key === "em_analise")?.total ?? 0;
  const topLoja = porLoja[0] ?? null;
  const topStatus = porStatus[0] ?? null;
  const totalLojas = new Set(rows.map((row) => row.lojaId ?? row.lojaNome ?? "Sem loja")).size;
  const totalPrestadores = new Set(
    rows.map((row) => row.prestador_id ?? "Sem prestador"),
  ).size;

  return {
    totalDocumentos: total,
    totalLojas,
    totalPrestadores,
    totalAssinados,
    totalPendentes,
    totalEmAnalise,
    isTruncated,
    porStatus,
    porTipo,
    porLoja,
    tendenciaMensal,
    observacoes: buildInsightsSummary({
      total,
      totalAssinados,
      totalPendentes,
      totalEmAnalise,
      topLoja,
      topStatus,
      isTruncated,
    }),
    } satisfies DocumentoCopilotInsights;
};

const createEmptyInsights = (): DocumentoCopilotInsights => ({
  totalDocumentos: 0,
  totalLojas: 0,
  totalPrestadores: 0,
  totalAssinados: 0,
  totalPendentes: 0,
  totalEmAnalise: 0,
  isTruncated: false,
  porStatus: [],
  porTipo: [],
  porLoja: [],
  tendenciaMensal: [],
  observacoes: [],
});

const buildTemporalReply = (input: {
  message: string;
  filters: DocumentoCopilotFilters;
  insights: DocumentoCopilotInsights;
  matches: DocumentoCopilotMatch[];
  total: number;
}) => {
  const normalizedMessage = normalizeText(input.message).toLowerCase();
  const asksMonthlyBreakdown =
    /(por mês|por mes|mensal|evolu|tendên|tenden|últimos meses|ultimos meses|mês teve mais|mes teve mais)/.test(
      normalizedMessage,
    );
  const asksHighestMonth =
    /(mês teve mais|mes teve mais|qual mês|qual mes|maior volume|pico)/.test(
      normalizedMessage,
    );
  const hasMonthFilter = typeof input.filters.mes === "string" && input.filters.mes.trim();
  const monthLabel = hasMonthFilter
    ? MONTH_LABELS[input.filters.mes as string] ?? input.filters.mes
    : null;

  if (hasMonthFilter && input.filters.ano) {
    const totalLabel = input.total === 1 ? "documento" : "documentos";
    return `Em ${monthLabel} de ${input.filters.ano} encontrei ${input.total} ${totalLabel}.`;
  }

  if (asksHighestMonth && input.insights.tendenciaMensal.length > 0) {
    const topMonth = [...input.insights.tendenciaMensal].sort(
      (a, b) => b.total - a.total || a.label.localeCompare(b.label),
    )[0];
    if (topMonth) {
      const totalLabel = topMonth.total === 1 ? "documento" : "documentos";
      return `O mês com mais documentos no recorte atual foi ${topMonth.label}, com ${topMonth.total} ${totalLabel}.`;
    }
  }

  if (asksMonthlyBreakdown && input.insights.tendenciaMensal.length > 0) {
    const itens = input.insights.tendenciaMensal
      .filter((item) => item.total > 0)
      .map((item) => `${item.label}: ${item.total}`)
      .join(", ");
    if (itens) {
      return `No recorte atual, o volume por mês ficou assim: ${itens}.`;
    }
  }

  if (hasMonthFilter && !input.filters.ano) {
    const currentYear = new Date().getFullYear();
    const totalLabel = input.total === 1 ? "documento" : "documentos";
    return `Em ${monthLabel} de ${currentYear} encontrei ${input.total} ${totalLabel}.`;
  }

  return null;
};

const buildTextSearchOr = (term: string) =>
  buildDocumentosTextSearchOr(normalizeText(term));

const parseJsonObject = <T,>(raw: string, fallback: T): T => {
  try {
    const parsed = JSON.parse(raw) as T;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    return fallback;
  }
  return fallback;
};

const hasAnyFilter = (filters: DocumentoCopilotFilters) =>
  Boolean(
    filters.termo ||
      filters.tipo ||
      filters.tipoLaudo ||
      filters.status ||
      filters.ano ||
      filters.mes ||
      filters.lojaId ||
      filters.prestadorId ||
      filters.somenteAssinados ||
      filters.somenteDisponiveisLote,
  );

const stripKnownFilters = (filters: DocumentoCopilotFilters) => {
  const cleaned: DocumentoCopilotFilters = {};

  if (typeof filters.termo === "string" && filters.termo.trim()) {
    cleaned.termo = filters.termo.trim();
  }
  if (typeof filters.tipo === "string" && filters.tipo.trim()) {
    cleaned.tipo = normalizeTipoValue(filters.tipo.trim()) ?? filters.tipo.trim();
  }
  if (typeof filters.status === "string" && filters.status.trim()) {
    cleaned.status =
      normalizeStatusValue(filters.status.trim()) ?? filters.status.trim();
  }
  if (typeof filters.tipoLaudo === "string" && filters.tipoLaudo.trim()) {
    cleaned.tipoLaudo = filters.tipoLaudo.trim();
  }
  if (typeof filters.ano === "string" && filters.ano.trim()) {
    cleaned.ano = filters.ano.trim();
  }
  if (typeof filters.mes === "string" && filters.mes.trim()) {
    cleaned.mes = normalizeMesValue(filters.mes.trim()) ?? filters.mes.trim();
  }
  if (typeof filters.lojaId === "string" && filters.lojaId.trim()) {
    cleaned.lojaId = sanitizeId(filters.lojaId.trim());
  }
  if (typeof filters.prestadorId === "string" && filters.prestadorId.trim()) {
    cleaned.prestadorId = sanitizeId(filters.prestadorId.trim());
  }
  if (typeof filters.somenteAssinados === "boolean") {
    cleaned.somenteAssinados = filters.somenteAssinados;
  }
  if (typeof filters.somenteDisponiveisLote === "boolean") {
    cleaned.somenteDisponiveisLote = filters.somenteDisponiveisLote;
  }

  return cleaned;
};

const extractLojaMention = (message: string) => {
  const normalized = normalizeText(message).toLowerCase();
  const match = normalized.match(/\bloja\s+([a-z0-9._-]+)/i);
  return match?.[1] ?? null;
};

const applyDeterministicFilters = (
  filters: DocumentoCopilotFilters,
  message: string,
) => {
  const normalized = normalizeText(message).toLowerCase();
  const next = { ...filters };

  if (!next.tipo) {
    if (/\bnotas?\s+fiscais?\b/.test(normalized)) {
      next.tipo = "notas_fiscais";
    } else if (/\blaudos?\b|\bregistro\s+e\s+laudos?\b/.test(normalized)) {
      next.tipo = "registro_laudos";
    } else if (/\bretencao\s+trabalhista\b/.test(normalized)) {
      next.tipo = "retencao_trabalhista";
    }
  }

  if (!next.status) {
    const status = normalizeStatusValue(normalized);
    if (status) {
      next.status = status;
    }
  }

  if (!next.mes) {
    Object.entries(MONTH_LABELS).some(([value, label]) => {
      if (normalized.includes(normalizeText(label).toLowerCase())) {
        next.mes = value;
        return true;
      }
      return false;
    });
  }

  if (!next.ano) {
    const yearMatch = normalized.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      next.ano = yearMatch[1];
    } else if (next.mes) {
      next.ano = String(new Date().getFullYear());
    }
  }

  return next;
};

const resolveEntityFilters = async (input: {
  filters: DocumentoCopilotFilters;
  message: string;
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
}) => {
  const { message, supabaseAdmin } = input;
  const filters = { ...input.filters };
  const lojaToken = filters.lojaId?.trim() || extractLojaMention(message);

  if (lojaToken) {
    const normalizedToken = normalizeText(lojaToken).toLowerCase();
    const { data: lojasData, error: lojasError } = await supabaseAdmin
      .from("lojas")
      .select("id,nome,codigo")
      .limit(2000);
    if (lojasError) {
      throw lojasError;
    }
    const lojas = ((lojasData as LojaLookupRow[]) ?? []) as LojaLookupRow[];
    const match = lojas.find((loja) => {
      const values = [loja.id, loja.codigo ?? "", loja.nome ?? ""].map((value) =>
        normalizeText(value).toLowerCase(),
      );
      return values.some((value) => value === normalizedToken);
    });
    if (match) {
      filters.lojaId = match.id;
    }
  }

  if (filters.prestadorId) {
    const normalizedPrestador = normalizeText(filters.prestadorId).toLowerCase();
    const { data: prestadoresData, error: prestadoresError } =
      await supabaseAdmin
        .from("prestadores")
        .select("id,nome")
        .limit(2000);
    if (prestadoresError) {
      throw prestadoresError;
    }
    const prestadores = ((prestadoresData as PrestadorLookupRow[]) ?? []) as PrestadorLookupRow[];
    const match = prestadores.find((prestador) => {
      const values = [prestador.id, prestador.nome ?? ""].map((value) =>
        normalizeText(value).toLowerCase(),
      );
      return values.some((value) => value === normalizedPrestador);
    });
    if (match) {
      filters.prestadorId = match.id;
    }
  }

  return filters;
};

const buildSearchSummary = (filters: DocumentoCopilotFilters) => {
  const partes: string[] = [];
  if (filters.tipo) {
    partes.push(`tipo ${humanize(filters.tipo)}`);
  }
  if (filters.status) {
    partes.push(`status ${humanize(filters.status)}`);
  }
  if (filters.tipoLaudo) {
    partes.push(`tipo de laudo "${filters.tipoLaudo}"`);
  }
  if (filters.ano) {
    partes.push(`ano ${filters.ano}`);
  }
  if (filters.mes) {
    partes.push(`mês ${filters.mes}`);
  }
  if (filters.lojaId) {
    partes.push(`loja ${filters.lojaId}`);
  }
  if (filters.prestadorId) {
    partes.push(`prestador ${filters.prestadorId}`);
  }
  if (filters.termo) {
    partes.push(`termo "${filters.termo}"`);
  }
  if (filters.somenteAssinados) {
    partes.push("somente assinados");
  }
  if (filters.somenteDisponiveisLote) {
    partes.push("disponíveis para lote");
  }

  return partes.length > 0
    ? `Critérios usados: ${partes.join(", ")}.`
    : "Sem filtros específicos, usei a intenção principal da pergunta.";
};

const buildPrompt = (input: {
  message: string;
  currentFilters?: DocumentoCopilotFilters;
}) => {
  const currentFilters = input.currentFilters
    ? stripKnownFilters(input.currentFilters)
    : {};

  return [
    {
      role: "system" as const,
      content: [
        "Você é um copiloto interno para encontrar documentos em um sistema corporativo.",
        "Seu trabalho é converter a pergunta do usuário em filtros simples e responder em português brasileiro.",
        "Regras: nunca invente documentos, nunca mencione dados fora do conjunto retornado, e nunca peça acesso admin.",
        "Se faltarem dados para filtrar com confiança, peça uma única pergunta de clarificação curta.",
        "Retorne sempre JSON válido com as chaves reply, filters e intent.",
        "Valores válidos de tipo: retencao_trabalhista, registro_laudos, notas_fiscais.",
        "Valores válidos de status: pendente, em_analise, revisado, assinado.",
        "Se o usuário mencionar um tipo de laudo, preencha tipoLaudo.",
      ].join(" "),
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        pergunta: input.message,
        filtrosAtuais: currentFilters,
        formatoEsperado: {
          intent: "search|clarify|explain",
          reply: "texto curto e útil",
          filters: {
            termo: "opcional",
            tipo: "opcional",
            status: "opcional",
            tipoLaudo: "opcional",
            ano: "opcional",
            mes: "opcional",
            lojaId: "opcional",
            prestadorId: "opcional",
            somenteAssinados: "opcional",
            somenteDisponiveisLote: "opcional",
          },
        },
      }),
    },
  ];
};

const buildDocumentoCandidatesQuery = (input: {
  filters: DocumentoCopilotFilters;
  userId: string;
  allowedPrestadores: string[];
  gerenteEntries: GerenteAccessRow[];
  canAccess: boolean;
  supabaseAdmin?: ReturnType<typeof createSupabaseAdminClient>;
}) => {
  const {
    filters,
    userId,
    allowedPrestadores,
    gerenteEntries,
    canAccess,
    supabaseAdmin = createSupabaseAdminClient(),
  } = input;

  const filterPrestadores = normalizeIds(
    [filters.prestadorId ?? ""].filter(Boolean),
  );
  const filterLojas = normalizeIds([filters.lojaId ?? ""].filter(Boolean));
  const accessOr = buildDocumentosAccessOr({
    canAccess,
    allowedPrestadores,
    gerenteEntries,
    userId,
    filterUserId: null,
    filterPrestadores,
    filterLojas,
  });

  let query = supabaseAdmin
    .from("formularios")
    .select(
      "id,tipo,status,created_at,dados,arquivo_path,arquivo_assinado_path,prestador_id,user_id",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (!canAccess && accessOr.length > 0) {
    query = query.or(accessOr.join(","));
  }

  if (filters.tipo) {
    query = query.eq("tipo", filters.tipo);
  }

  if (filters.status) {
    query = query.eq("status", filters.status);
  }

  if (filters.tipoLaudo) {
    const tipoLaudo = normalizeText(filters.tipoLaudo);
    if (tipoLaudo) {
      query = query.ilike("dados->>tipo_laudo", `%${tipoLaudo}%`);
    }
  }

  if (filters.somenteAssinados) {
    query = query.eq("status", "assinado");
  }

  if (filters.somenteDisponiveisLote) {
    query = query.eq("tipo", "registro_laudos").neq("status", "assinado");
  }

  if (filters.ano && /^\d{4}$/.test(filters.ano)) {
    const ano = Number(filters.ano);
    if (!Number.isNaN(ano)) {
      if (filters.mes && /^(0[1-9]|1[0-2])$/.test(filters.mes)) {
        const mes = Number(filters.mes);
        const start = new Date(ano, mes - 1, 1);
        const end = new Date(ano, mes, 1);
        query = query
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString());
      } else {
        const start = new Date(ano, 0, 1);
        const end = new Date(ano + 1, 0, 1);
        query = query
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString());
      }
    }
  } else if (filters.mes && /^(0[1-9]|1[0-2])$/.test(filters.mes)) {
    const anoAtual = new Date().getFullYear();
    const mes = Number(filters.mes);
    const start = new Date(anoAtual, mes - 1, 1);
    const end = new Date(anoAtual, mes, 1);
    query = query
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());
  }

  const textOr = filters.termo ? buildTextSearchOr(filters.termo) : null;
  if (textOr && textOr.length > 0) {
    query = query.or(textOr.join(","));
  }

  return query;
};

const queryDocumentoCandidates = async (input: {
  filters: DocumentoCopilotFilters;
  userId: string;
  allowedPrestadores: string[];
  gerenteEntries: GerenteAccessRow[];
  canAccess: boolean;
  supabaseAdmin?: ReturnType<typeof createSupabaseAdminClient>;
}) => {
  const {
    supabaseAdmin = createSupabaseAdminClient(),
  } = input;

  const baseQuery = buildDocumentoCandidatesQuery({
    ...input,
    supabaseAdmin,
  });

  const { data, error, count } = await baseQuery.range(0, DEFAULT_LIMIT - 1);
  if (error) {
    throw error;
  }

  const total = count ?? ((data as Row[] | null)?.length ?? 0);
  const rowsRaw = ((data as Row[]) ?? []) as Row[];
  const maxRowsToFetch = Math.min(total, MAX_LIMIT);

  for (let offset = DEFAULT_LIMIT; offset < maxRowsToFetch; offset += DEFAULT_LIMIT) {
    const { data: nextData, error: nextError } = await buildDocumentoCandidatesQuery({
      ...input,
      supabaseAdmin,
    }).range(offset, Math.min(offset + DEFAULT_LIMIT - 1, maxRowsToFetch - 1));
    if (nextError) {
      throw nextError;
    }
    const nextRows = ((nextData as Row[]) ?? []) as Row[];
    rowsRaw.push(...nextRows);
    if (nextRows.length < DEFAULT_LIMIT) {
      break;
    }
  }

  const rows = rowsRaw.map((registro) => {
    const dados = normalizeDisplayData(safeParseDados(registro.dados)) as Record<
      string,
      unknown
    > | null;
    const lojaId = getLojaId(dados);
    return {
      id: registro.id,
      tipo: registro.tipo,
      status: registro.status,
      created_at: registro.created_at,
      dados,
      arquivo_path: registro.arquivo_path,
      arquivo_assinado_path: registro.arquivo_assinado_path,
      prestador_id: registro.prestador_id,
      user_id: registro.user_id,
      lojaId,
      identificacao:
        getIdentificacao({ tipo: registro.tipo, dados }) ?? "Não informado",
      complemento: getComplemento({ tipo: registro.tipo, dados }),
      tipoLaudo: getTipoLaudo(dados),
      observacoes: getObservacoes(dados),
      nome: getNomeDocumento(registro),
      lojaNome: getLojaNome(dados),
    } satisfies CandidateRow;
  });

  const lojasMap = new Map<string, string | null>();
  const prestadoresMap = new Map<string, string | null>();

  const lojaIds = Array.from(
    new Set(
      rows
        .map((row) => row.lojaId)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  if (lojaIds.length > 0) {
    const { data: lojasData } = await supabaseAdmin
      .from("lojas")
      .select("id,nome")
      .in("id", lojaIds);
    (lojasData as EntityRow[] | null)?.forEach((item) => {
      lojasMap.set(item.id, item.nome ?? null);
    });
  }

  const prestadorIds = Array.from(
    new Set(
      rows
        .map((row) => row.prestador_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  if (prestadorIds.length > 0) {
    const { data: prestadoresData } = await supabaseAdmin
      .from("prestadores")
      .select("id,nome")
      .in("id", prestadorIds);
    (prestadoresData as EntityRow[] | null)?.forEach((item) => {
      prestadoresMap.set(
        item.id,
        item.nome ? fixMojibakeText(item.nome) : null,
      );
    });
  }

  const matches = rows.slice(0, DOCUMENTO_COPILOT_LIMIT).map((row) => ({
    id: row.id,
    tipo: row.tipo,
    status: row.status,
    created_at: row.created_at,
    nome: row.nome,
    identificacao: row.identificacao,
    complemento: row.complemento,
    lojaId: row.lojaId ?? null,
    lojaNome: row.lojaId ? lojasMap.get(row.lojaId) ?? row.lojaNome : null,
    prestadorId: row.prestador_id ?? null,
    prestadorNome: row.prestador_id
      ? prestadoresMap.get(row.prestador_id) ?? null
      : null,
    tipoLaudo: row.tipoLaudo,
    observacoes: row.observacoes,
  }));

  return {
    matches,
    total,
    insights: buildAnalyticInsights({
      rows,
      total,
      isTruncated: total > rows.length,
    }),
  };
};

export async function runDocumentoCopilot(
  request: DocumentoCopilotRequest,
  auth: {
    userId: string;
    email: string | null;
  },
) {
  const supabaseAdmin = createSupabaseAdminClient();
  const allowedPrestadores = await getAuthorizedPrestadorIds(
    auth.email,
    supabaseAdmin,
  );
  const gerenteEntries = await getGerenteAccessEntries(
    auth.userId,
    auth.email,
    supabaseAdmin,
  );
  const canAccess = await hasDocumentosAccess(
    auth.userId,
    auth.email,
    supabaseAdmin,
  );

  const promptMessages = buildPrompt({
    message: request.message?.trim() || "",
    currentFilters: request.currentFilters,
  });

  const raw = await callAzureOpenAiChat({
    messages: promptMessages,
    temperature: 0.1,
    maxTokens: 650,
  });

  const parsed = parseJsonObject<{
    reply?: string;
    intent?: "search" | "clarify" | "explain";
    filters?: DocumentoCopilotFilters;
  }>(raw, {});

  let filters = stripKnownFilters(parsed.filters ?? {});
  const message = request.message?.trim() ?? "";
  filters = applyDeterministicFilters(filters, message);
  filters = await resolveEntityFilters({
    filters,
    message,
    supabaseAdmin,
  });
  const hasParsedFilters = hasAnyFilter(filters);
  const fallbackTerm = normalizeText(message);
  if (!filters.termo && fallbackTerm && !hasParsedFilters) {
    filters.termo = fallbackTerm;
  }

  const summary = buildSearchSummary(filters);
  const intent = parsed.intent ?? (filters.termo ? "search" : "clarify");

  if (intent === "clarify" && !hasAnyFilter(filters)) {
    return {
      reply:
        parsed.reply?.trim() ||
        "Posso procurar por tipo, status, loja, prestador, mês ou um trecho do nome do documento. Me diga um detalhe a mais.",
      summary,
      filters,
      results: [],
      total: 0,
      insights: createEmptyInsights(),
    } satisfies DocumentoCopilotResponse;
  }

  const { matches, total, insights } = await queryDocumentoCandidates({
    filters,
    userId: auth.userId,
    allowedPrestadores,
    gerenteEntries,
    canAccess,
    supabaseAdmin,
  });
  const temporalReply = buildTemporalReply({
    message,
    filters,
    insights,
    matches,
    total,
  });

  return {
    reply:
      temporalReply ||
      parsed.reply?.trim() ||
      (matches.length > 0
        ? `Encontrei ${matches.length} documento(s) que parecem corresponder à sua busca.`
        : "Não encontrei documentos com esses critérios. Posso ajustar a busca se você me disser mais um detalhe."),
    summary,
    filters,
    results: matches,
    total,
    insights,
  } satisfies DocumentoCopilotResponse;
}
