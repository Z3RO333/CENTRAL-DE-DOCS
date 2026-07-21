import { supabase } from "@/lib/supabaseClient";
export { getValorOrcamento, formatCurrencyBRL } from "@/lib/documentosApiUtils";

export type FormularioRecord = {
  id: string;
  tipo: string;
  status: string;
  arquivo_path: string;
  arquivo_assinado_path?: string | null;
  created_at: string;
  dados: Record<string, unknown> | null;
  assinado_por?: string | null;
  prestador_id?: string | null;
};

export type EditField = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "date";
};

const tipoLabel: Record<string, string> = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
  contratos: "Contratos",
  orcamentos: "Orçamentos",
};
export const TIPO_LABEL = tipoLabel;

const EDIT_FIELDS_BY_TIPO: Record<string, EditField[]> = {
  retencao_trabalhista: [
    { name: "competencia", label: "Competência" },
    { name: "tipo_laudo", label: "Tipo de documento" },
    { name: "prestador", label: "Prestador" },
    { name: "responsavel", label: "Responsável (diretor/dono)" },
    { name: "observacoes", label: "Observações", type: "textarea" },
  ],
  registro_laudos: [
    { name: "competencia", label: "Competência" },
    { name: "prestador", label: "Prestador" },
    { name: "tipo_laudo", label: "Tipo de laudo" },
    { name: "responsavel", label: "Responsável" },
    { name: "observacoes", label: "Observações", type: "textarea" },
  ],
  notas_fiscais: [
    { name: "competencia", label: "Competência" },
    { name: "prestador", label: "Prestador" },
    { name: "numero_pedido", label: "Número do pedido" },
    { name: "numero_nf", label: "Número da nota" },
    { name: "valor", label: "Valor", type: "number" },
    { name: "descricao", label: "Descrição / Histórico", type: "textarea" },
  ],
  contratos: [
    { name: "prestador", label: "Prestador" },
    { name: "numero_contrato", label: "Número do contrato" },
    { name: "tipo_servico", label: "Tipo de serviço" },
    { name: "descricao", label: "Descrição do contrato", type: "textarea" },
    { name: "data_assinatura", label: "Data de assinatura", type: "date" },
    { name: "data_vencimento", label: "Data de vencimento", type: "date" },
    { name: "objeto", label: "Objeto do contrato", type: "textarea" },
    { name: "data_inicio", label: "Data de início", type: "date" },
    { name: "data_fim", label: "Data de término", type: "date" },
    { name: "valor", label: "Valor", type: "number" },
    { name: "observacoes", label: "Observações", type: "textarea" },
  ],
  orcamentos: [
    { name: "prestador", label: "Prestador" },
    { name: "numero_orcamento", label: "Número do orçamento" },
    { name: "descricao", label: "Descrição dos serviços", type: "textarea" },
    { name: "valor", label: "Valor", type: "number" },
    { name: "data_validade", label: "Validade do orçamento", type: "date" },
    { name: "observacoes", label: "Observações", type: "textarea" },
  ],
};

export const TIPO_ASSINAVEL = "registro_laudos";
export const STORAGE_BUCKET = "formularios";
export const SIGNED_URL_EXPIRES_IN = 60 * 30;
export const LIST_STATE_STORAGE_KEY = "documentos:list-state";
export const LIST_CACHE_STORAGE_KEY = "documentos:list-cache";
export const FILTERS_CACHE_STORAGE_KEY = "documentos:filter-options";

export type DocumentosListState = {
  tipoFilter: string;
  tipoLaudoFilter: string;
  userFilter: string;
  lojaFilter: string;
  prestadorFilter: string;
  statusFilter: string;
  identificacaoFilter: string;
  anoFilter: string;
  mesFilter: string;
  somenteAssinados: boolean;
  somenteDisponiveisLote: boolean;
  viewMode: "tabela" | "cards";
  scrollY: number;
  page: number;
  pageSize: number;
};

export type AdminUserOption = {
  id: string;
  email: string | null;
  name: string | null;
};

export const normalizeRegistroStatus = (registro: FormularioRecord) => {
  if (registro.tipo !== TIPO_ASSINAVEL && registro.status === "pendente") {
    return { ...registro, status: "em_analise" };
  }
  return registro;
};

export async function getSignedFileUrl(
  path: string,
  expiresIn = SIGNED_URL_EXPIRES_IN,
) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    throw error ?? new Error("Não foi possível gerar o link do arquivo.");
  }

  return data.signedUrl;
}

const statusLabelMap: Record<string, string> = {
  pendente: "Pendente",
  assinado: "Assinado",
  em_analise: "Em análise",
  revisado: "Revisado",
};

const humanizeTexto = (value: string) =>
  value
    .split("_")
    .map((part) =>
      part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part,
    )
    .join(" ");

export const formatStatusLabel = (status: string) =>
  statusLabelMap[status] ?? humanizeTexto(status);

export const getTipoDescricao = (tipo: string) =>
  tipoLabel[tipo] ?? humanizeTexto(tipo);

export const getEditFields = (tipo: string) => EDIT_FIELDS_BY_TIPO[tipo] ?? [];

const identificacaoFieldMap: Record<
  string,
  { label: string; campos: string[] }
> = {
  retencao_trabalhista: {
    label: "Empresa",
    campos: ["prestador"],
  },
  registro_laudos: {
    label: "Prestador",
    campos: ["prestador", "responsavel"],
  },
  notas_fiscais: {
    label: "Número do pedido",
    campos: ["numero_pedido"],
  },
  contratos: {
    label: "Número do contrato",
    campos: ["numero_contrato", "prestador"],
  },
  orcamentos: {
    label: "Número do orçamento",
    campos: ["numero_orcamento", "prestador"],
  },
};

const defaultIdentificacaoConfig = {
  label: "Prestador",
  campos: ["empresa", "responsavel"],
};

export const MESES = [
  { value: "01", label: "Janeiro" },
  { value: "02", label: "Fevereiro" },
  { value: "03", label: "Março" },
  { value: "04", label: "Abril" },
  { value: "05", label: "Maio" },
  { value: "06", label: "Junho" },
  { value: "07", label: "Julho" },
  { value: "08", label: "Agosto" },
  { value: "09", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

export const getIdentificacaoConfig = (tipo: string) =>
  identificacaoFieldMap[tipo] ?? defaultIdentificacaoConfig;

export const getCampoTexto = (
  dados: Record<string, unknown> | null,
  campos: string[],
): string | null => {
  if (!dados) {
    return null;
  }
  for (const campo of campos) {
    const valor = dados[campo];
    if (typeof valor === "string" && valor.trim()) {
      return valor.trim();
    }
  }
  return null;
};

export const getIdentificacaoValor = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, getIdentificacaoConfig(registro.tipo).campos);

export const getIdentificacaoComplemento = (registro: FormularioRecord) => {
  switch (registro.tipo) {
    case "retencao_trabalhista":
      return getCampoTexto(registro.dados, ["cnpj"]);
    case "registro_laudos":
      return getCampoTexto(registro.dados, ["responsavel"]);
    case "notas_fiscais":
      return getCampoTexto(registro.dados, ["cnpj_emitente"]);
    case "contratos":
      return getCampoTexto(registro.dados, ["data_inicio"]);
    case "orcamentos":
      return getCampoTexto(registro.dados, ["data_validade"]);
    default:
      return getCampoTexto(registro.dados, ["cnpj_emitente", "cnpj"]);
  }
};

export const resolveSignedPdfPath = (path?: string | null) => {
  if (!path) {
    return null;
  }
  if (path.endsWith("-view.html")) {
    return path.replace(/-view\.html$/, ".pdf");
  }
  if (path.endsWith(".html")) {
    return path.replace(/\.html$/, ".pdf");
  }
  return path;
};

export const getTipoLaudo = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, ["tipo_laudo"]);

export const getObservacoes = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, ["observacoes"]);

export const getDescricaoContrato = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, ["descricao", "objeto"]);

export const getTipoServicoContrato = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, ["tipo_servico"]);

export const getDataAssinatura = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, ["data_assinatura"]);

export const getDataVencimento = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, ["data_vencimento"]);

export const formatDateBR = (value: string | null) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
};

export type SemaforoStatus = "verde" | "amarelo" | "vermelho" | "indefinido";

export const SEMAFORO_BADGE: Record<SemaforoStatus, string> = {
  verde: "bg-emerald-50 text-emerald-700",
  amarelo: "bg-amber-50 text-amber-700",
  vermelho: "bg-red-50 text-red-700",
  indefinido: "bg-slate-100 text-slate-500",
};

export const getSemaforoVencimento = (
  dataVencimento: string | null,
): { status: SemaforoStatus; label: string } => {
  if (!dataVencimento) {
    return { status: "indefinido", label: "Sem data" };
  }
  const vencimento = new Date(`${dataVencimento}T00:00:00`);
  if (Number.isNaN(vencimento.getTime())) {
    return { status: "indefinido", label: "Sem data" };
  }
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dias = Math.ceil((vencimento.getTime() - hoje.getTime()) / 86400000);
  if (dias < 0) {
    return { status: "vermelho", label: `Vencido há ${Math.abs(dias)}d` };
  }
  if (dias <= 14) {
    return {
      status: "vermelho",
      label: dias === 0 ? "Vence hoje" : `Vence em ${dias}d`,
    };
  }
  if (dias <= 60) {
    return { status: "amarelo", label: `Vence em ${dias}d` };
  }
  return { status: "verde", label: "Em dia" };
};

export const getPageCount = (registro: FormularioRecord) => {
  const raw = registro.dados?.page_count;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

export const getDocumentoNome = (registro: FormularioRecord) => {
  const anexos = registro.dados?.anexos;
  if (Array.isArray(anexos) && anexos.length > 0) {
    const primeiro = anexos[0] as { nome?: unknown } | null;
    if (primeiro && typeof primeiro.nome === "string" && primeiro.nome.trim()) {
      return primeiro.nome.trim();
    }
  }
  const path = registro.arquivo_assinado_path ?? registro.arquivo_path;
  if (path) {
    return path.split("/").pop() ?? path;
  }
  return registro.id;
};

export const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString("pt-BR");
};

export const getEdicaoInfo = (registro: FormularioRecord) => {
  const editedBy = getCampoTexto(registro.dados, ["edited_by"]);
  const editedAtRaw = getCampoTexto(registro.dados, ["edited_at"]);
  if (!editedBy && !editedAtRaw) {
    return null;
  }
  const editedAt = editedAtRaw ? formatDateTime(editedAtRaw) : null;
  return { editedBy, editedAt };
};
