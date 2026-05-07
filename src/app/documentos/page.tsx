"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Files } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { usePrestadores } from "@/hooks/usePrestadores";
import { useLojas } from "@/hooks/useLojas";
import { DocumentosBatchActions } from "./_components/DocumentosBatchActions";
import { DocumentDetailsDrawer } from "./_components/DocumentDetailsDrawer";
import { DocumentosEmptyState } from "./_components/DocumentosEmptyState";
import { DocumentosFilters } from "./_components/DocumentosFilters";
import { DocumentosPagination } from "./_components/DocumentosPagination";
import { TIPO_LABEL } from "./_lib/documentosShared";
import { fixMojibakeText } from "@/lib/textEncoding";

type FormularioRecord = {
  id: string;
  tipo: string;
  status: string;
  arquivo_path: string;
  arquivo_assinado_path?: string | null;
  created_at: string;
  dados: Record<string, unknown> | null;
  assinado_por?: string | null;
  prestador_id?: string | null;
  user_id?: string | null;
};

type EditField = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "date";
};

const tipoLabel: Record<string, string> = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
};

const EDIT_FIELDS_BY_TIPO: Record<string, EditField[]> = {
  retencao_trabalhista: [
    { name: "competencia", label: "Competência" },
    { name: "prestador", label: "Prestador" },
    { name: "observacoes", label: "Observações", type: "textarea" },
  ],
  registro_laudos: [
    { name: "prestador", label: "Prestador" },
    { name: "tipo_laudo", label: "Tipo de laudo" },
    { name: "responsavel", label: "Responsável" },
    { name: "data_emissao", label: "Data de emissão", type: "date" },
    { name: "observacoes", label: "Observações", type: "textarea" },
  ],
  notas_fiscais: [
    { name: "prestador", label: "Prestador" },
    { name: "numero_pedido", label: "Número do pedido" },
    { name: "numero_nf", label: "Número da nota" },
    { name: "valor", label: "Valor", type: "number" },
    { name: "descricao", label: "Descrição / Histórico", type: "textarea" },
  ],
};

const TIPO_ASSINAVEL = "registro_laudos";
const STORAGE_BUCKET = "formularios";
const SIGNED_URL_EXPIRES_IN = 60 * 30;
const LIST_STATE_STORAGE_KEY = "documentos:list-state";
const LIST_CACHE_STORAGE_KEY = "documentos:list-cache";
const FILTERS_CACHE_STORAGE_KEY = "documentos:filter-options";

type DocumentosListState = {
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

type AdminUserOption = {
  id: string;
  email: string | null;
  name: string | null;
};

const normalizeRegistroStatus = (registro: FormularioRecord) => {
  if (registro.tipo !== TIPO_ASSINAVEL && registro.status === "pendente") {
    return { ...registro, status: "em_analise" };
  }
  return registro;
};

async function getSignedFileUrl(
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

const formatStatusLabel = (status: string) =>
  statusLabelMap[status] ?? humanizeTexto(status);

const getTipoDescricao = (tipo: string) =>
  tipoLabel[tipo] ?? humanizeTexto(tipo);

const getEditFields = (tipo: string) => EDIT_FIELDS_BY_TIPO[tipo] ?? [];

const identificacaoFieldMap: Record<
  string,
  { label: string; campos: string[] }
> = {
  retencao_trabalhista: {
    label: "Empresa",
    campos: ["empresa"],
  },
  registro_laudos: {
    label: "Prestador",
    campos: ["prestador", "responsavel"],
  },
  notas_fiscais: {
    label: "Número do pedido",
    campos: ["numero_pedido"],
  },
};

const defaultIdentificacaoConfig = {
  label: "Prestador",
  campos: ["empresa", "responsavel"],
};

const MESES = [
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

const getIdentificacaoConfig = (tipo: string) =>
  identificacaoFieldMap[tipo] ?? defaultIdentificacaoConfig;

const getIdentificacaoValor = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, getIdentificacaoConfig(registro.tipo).campos);

const getIdentificacaoComplemento = (registro: FormularioRecord) => {
  switch (registro.tipo) {
    case "retencao_trabalhista":
      return getCampoTexto(registro.dados, ["cnpj"]);
    case "registro_laudos":
      return getCampoTexto(registro.dados, ["responsavel"]);
    case "notas_fiscais":
      return getCampoTexto(registro.dados, ["cnpj_emitente"]);
    default:
      return getCampoTexto(registro.dados, ["cnpj_emitente", "cnpj"]);
  }
};

const resolveSignedPdfPath = (path?: string | null) => {
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

const getCampoTexto = (
  dados: Record<string, unknown> | null,
  campos: string[],
): string | null => {
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

const getTipoLaudo = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, ["tipo_laudo"]);

const getObservacoes = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, ["observacoes"]);

const getPageCount = (registro: FormularioRecord) => {
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

const getDocumentoNome = (registro: FormularioRecord) => {
  const anexos = registro.dados?.anexos;
  if (Array.isArray(anexos) && anexos.length > 0) {
    const primeiro = anexos[0] as { nome?: unknown } | null;
    if (primeiro && typeof primeiro.nome === "string" && primeiro.nome.trim()) {
      return fixMojibakeText(primeiro.nome.trim());
    }
  }
  const path = registro.arquivo_assinado_path ?? registro.arquivo_path;
  if (path) {
    return fixMojibakeText(path.split("/").pop() ?? path);
  }
  return registro.id;
};

const getDownloadFileName = (registro: FormularioRecord, path: string) => {
  const documentName = getDocumentoNome(registro);
  if (documentName && documentName !== registro.id) {
    return documentName;
  }
  return path.split("/").pop() ?? "documento.pdf";
};

const downloadSignedUrlAsBlob = async (signedUrl: string, fileName: string) => {
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new Error("Nao foi possivel baixar o arquivo.");
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString("pt-BR");
};

const getEdicaoInfo = (registro: FormularioRecord) => {
  const editedBy = getCampoTexto(registro.dados, ["edited_by"]);
  const editedAtRaw = getCampoTexto(registro.dados, ["edited_at"]);
  if (!editedBy && !editedAtRaw) {
    return null;
  }
  const editedAt = editedAtRaw ? formatDateTime(editedAtRaw) : null;
  return { editedBy, editedAt };
};

const getNumeroNf = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, ["numero_nf"]);

const getNumeroPedido = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, ["numero_pedido"]);

const getCnpjDocumento = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, ["cnpj", "cnpj_emitente"]);

const getLojaNome = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, ["loja_nome"]);

const getPrestadorNome = (registro: FormularioRecord) =>
  getCampoTexto(registro.dados, ["prestador"]);

export default function DocumentosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlFiltersSignature = searchParams.toString();
  const hasUrlDrivenFilters = urlFiltersSignature.length > 0;
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const userId = user?.id ?? null;
  const { isAdmin, role, loading: accessLoading, error: accessError } =
    useDocumentsAccess();
  const canViewAllDocuments = isAdmin;
  const canManageDocuments = isAdmin;
  const {
    prestadores: prestadoresDoUsuario,
    loading: prestadoresUsuarioLoading,
  } = usePrestadores({
    assignedOnly: true,
    enabled: Boolean(userId) && !canViewAllDocuments && role !== "gerente_loja",
  });
  const { lojas } = useLojas({ enabled: canManageDocuments });
  const [loading, setLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registros, setRegistros] = useState<FormularioRecord[]>([]);
  const [tipoFilter, setTipoFilter] = useState<string>("todos");
  const [tipoLaudoFilter, setTipoLaudoFilter] = useState<string>("todos");
  const [userFilter, setUserFilter] = useState<string>("todos");
  const [lojaFilter, setLojaFilter] = useState<string>("todos");
  const [prestadorFilter, setPrestadorFilter] = useState<string>("todos");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [identificacaoFilter, setIdentificacaoFilter] = useState<string>("");
  const [identificacaoDebounced, setIdentificacaoDebounced] =
    useState<string>("");
  const [anoFilter, setAnoFilter] = useState<string>("todos");
  const [mesFilter, setMesFilter] = useState<string>("todos");
  const [somenteAssinados, setSomenteAssinados] = useState(false);
  const [somenteDisponiveisLote, setSomenteDisponiveisLote] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [startingBatch, setStartingBatch] = useState(false);
  const [viewMode, setViewMode] = useState<"tabela" | "cards">("tabela");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [restoredNotice, setRestoredNotice] = useState(false);
  const [pdfAction, setPdfAction] = useState<{
    id: string;
    type: "open" | "download";
  } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingBatch, setDeletingBatch] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  );
  const [hasRestoredState, setHasRestoredState] = useState(false);
  const [hasRestoredCache, setHasRestoredCache] = useState(false);
  const confirmCancelRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const listStateRef = useRef<DocumentosListState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    type: "single" | "batch";
    registro?: FormularioRecord;
  } | null>(null);
  const [editDialog, setEditDialog] = useState<{
    registro: FormularioRecord;
    values: Record<string, string>;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [filterOptions, setFilterOptions] = useState<{
    anos: string[];
    status: string[];
    tipoLaudo: string[];
    lojas: { id: string; nome: string; codigo: string | null }[];
    prestadores: { id: string; nome: string; tipo_servico?: string | null }[];
  }>({ anos: [], status: [], tipoLaudo: [], lojas: [], prestadores: [] });
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(false);
  const [hasRestoredFilterOptions, setHasRestoredFilterOptions] =
    useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUserOption[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  const getAccessToken = useCallback(async () => {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }
    const token = sessionData.session?.access_token;
    if (!token) {
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    return token;
  }, []);

  const carregarFiltros = useCallback(async () => {
    setFilterOptionsLoading(true);
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/documentos/filtros", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as {
        anos?: string[];
        status?: string[];
        tipoLaudo?: string[];
        lojas?: { id: string; nome: string; codigo: string | null }[];
        prestadores?: { id: string; nome: string; tipo_servico?: string | null }[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível carregar os filtros.");
      }
      setFilterOptions({
        anos: payload.anos ?? [],
        status: payload.status ?? [],
        tipoLaudo: payload.tipoLaudo ?? [],
        lojas: payload.lojas ?? [],
        prestadores: payload.prestadores ?? [],
      });
    } catch (err) {
      console.error("Erro ao carregar filtros:", err);
      setFilterOptions({
        anos: [],
        status: [],
        tipoLaudo: [],
        lojas: [],
        prestadores: [],
      });
    } finally {
      setFilterOptionsLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (!userId || authLoading || accessLoading || !canManageDocuments) {
      setAdminUsers([]);
      setAdminUsersLoading(false);
      return;
    }

    let active = true;
    const loadAdminUsers = async () => {
      setAdminUsersLoading(true);
      try {
        const token = await getAccessToken();
        const response = await fetch("/api/admin/users", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const payload = (await response.json()) as {
          users?: AdminUserOption[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Falha ao carregar usuarios.");
        }
        if (active) {
          setAdminUsers(payload.users ?? []);
        }
      } catch (err) {
        if (active) {
          setAdminUsers([]);
          console.error("Erro ao carregar usuarios para filtro:", err);
        }
      } finally {
        if (active) {
          setAdminUsersLoading(false);
        }
      }
    };

    void loadAdminUsers();
    return () => {
      active = false;
    };
  }, [userId, authLoading, accessLoading, canManageDocuments, getAccessToken]);

  useEffect(() => {
    if (hasRestoredFilterOptions || typeof window === "undefined") {
      return;
    }
    const raw = window.sessionStorage.getItem(FILTERS_CACHE_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          anos?: string[];
          status?: string[];
          tipoLaudo?: string[];
          lojas?: { id: string; nome: string; codigo: string | null }[];
          prestadores?: { id: string; nome: string; tipo_servico?: string | null }[];
        };
        setFilterOptions({
          anos: parsed.anos ?? [],
          status: parsed.status ?? [],
          tipoLaudo: parsed.tipoLaudo ?? [],
          lojas: parsed.lojas ?? [],
          prestadores: parsed.prestadores ?? [],
        });
      } catch {
        window.sessionStorage.removeItem(FILTERS_CACHE_STORAGE_KEY);
      }
    }
    setHasRestoredFilterOptions(true);
  }, [hasRestoredFilterOptions]);

  useEffect(() => {
    if (!confirmDialog) {
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }
      return;
    }

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      confirmCancelRef.current?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirmDialog(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [confirmDialog]);

  useEffect(() => {
    if (hasRestoredState || typeof window === "undefined") {
      return;
    }
    if (hasUrlDrivenFilters) {
      setHasRestoredState(true);
      setRestoredNotice(false);
      return;
    }

    const raw = window.sessionStorage.getItem(LIST_STATE_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<DocumentosListState>;
        if (parsed.tipoFilter) {
          setTipoFilter(parsed.tipoFilter);
        }
        if (parsed.tipoLaudoFilter) {
          setTipoLaudoFilter(parsed.tipoLaudoFilter);
        }
        if (parsed.userFilter) {
          setUserFilter(parsed.userFilter);
        }
        if (parsed.lojaFilter) {
          setLojaFilter(parsed.lojaFilter);
        }
        if (parsed.prestadorFilter) {
          setPrestadorFilter(parsed.prestadorFilter);
        }
        if (parsed.statusFilter) {
          setStatusFilter(parsed.statusFilter);
        }
        if (typeof parsed.identificacaoFilter === "string") {
          setIdentificacaoFilter(parsed.identificacaoFilter);
        }
        if (parsed.anoFilter) {
          setAnoFilter(parsed.anoFilter);
        }
        if (parsed.mesFilter) {
          setMesFilter(parsed.mesFilter);
        }
        if (typeof parsed.somenteAssinados === "boolean") {
          setSomenteAssinados(parsed.somenteAssinados);
        }
        if (typeof parsed.somenteDisponiveisLote === "boolean") {
          setSomenteDisponiveisLote(parsed.somenteDisponiveisLote);
        }
        if (parsed.viewMode === "tabela" || parsed.viewMode === "cards") {
          setViewMode(parsed.viewMode);
        }
        if (typeof parsed.page === "number" && parsed.page > 0) {
          setPage(parsed.page);
        }
        if (typeof parsed.scrollY === "number") {
          window.requestAnimationFrame(() => {
            window.scrollTo(0, parsed.scrollY ?? 0);
          });
        }
        listStateRef.current = {
          tipoFilter: parsed.tipoFilter ?? "todos",
          tipoLaudoFilter: parsed.tipoLaudoFilter ?? "todos",
          userFilter: parsed.userFilter ?? "todos",
          lojaFilter: parsed.lojaFilter ?? "todos",
          prestadorFilter: parsed.prestadorFilter ?? "todos",
          statusFilter: parsed.statusFilter ?? "todos",
          identificacaoFilter: parsed.identificacaoFilter ?? "",
          anoFilter: parsed.anoFilter ?? "todos",
          mesFilter: parsed.mesFilter ?? "todos",
          somenteAssinados: parsed.somenteAssinados ?? false,
          somenteDisponiveisLote: parsed.somenteDisponiveisLote ?? false,
          viewMode: parsed.viewMode === "cards" ? "cards" : "tabela",
          scrollY: parsed.scrollY ?? 0,
          page: parsed.page && parsed.page > 0 ? parsed.page : 1,
          pageSize:
            parsed.pageSize && parsed.pageSize > 0 ? parsed.pageSize : pageSize,
        };
        setRestoredNotice(true);
      } catch {
        window.sessionStorage.removeItem(LIST_STATE_STORAGE_KEY);
      }
    }

    setHasRestoredState(true);
  }, [hasRestoredState, hasUrlDrivenFilters, pageSize]);

  useEffect(() => {
    if (!urlFiltersSignature) {
      return;
    }

    const params = new URLSearchParams(urlFiltersSignature);
    let applied = false;
    const applyStringFilter = (
      key: string,
      setter: (value: string) => void,
      fallback = "todos",
    ) => {
      if (!params.has(key)) {
        return;
      }
      const value = params.get(key)?.trim();
      setter(value || fallback);
      applied = true;
    };

    applyStringFilter("tipo", setTipoFilter);
    applyStringFilter("tipoLaudo", setTipoLaudoFilter);
    applyStringFilter("status", setStatusFilter);
    applyStringFilter("userId", setUserFilter);
    applyStringFilter("lojaId", setLojaFilter);
    applyStringFilter("prestadorId", setPrestadorFilter);
    applyStringFilter("ano", setAnoFilter);
    applyStringFilter("mes", setMesFilter);
    applyStringFilter("identificacao", setIdentificacaoFilter, "");

    if (params.has("somenteAssinados")) {
      setSomenteAssinados(params.get("somenteAssinados") === "true");
      applied = true;
    }
    if (params.has("somenteDisponiveisLote")) {
      setSomenteDisponiveisLote(
        params.get("somenteDisponiveisLote") === "true",
      );
      applied = true;
    }
    if (params.has("documento")) {
      const documentoId = params.get("documento")?.trim();
      if (documentoId) {
        setSelectedDocumentId(documentoId);
      }
    }

    if (applied) {
      setPage(1);
      setRestoredNotice(false);
    }
  }, [urlFiltersSignature]);

  useEffect(() => {
    if (hasRestoredCache || typeof window === "undefined") {
      return;
    }
    if (hasUrlDrivenFilters) {
      setHasRestoredCache(true);
      return;
    }

    const raw = window.sessionStorage.getItem(LIST_CACHE_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          registros?: FormularioRecord[];
          totalCount?: number;
          page?: number;
          pageSize?: number;
        };
        if (Array.isArray(parsed.registros)) {
          setRegistros(parsed.registros);
          setLoading(false);
        }
        if (typeof parsed.totalCount === "number") {
          setTotalCount(parsed.totalCount);
        }
        if (typeof parsed.page === "number" && parsed.page > 0) {
          setPage(parsed.page);
        }
        setRestoredNotice(true);
      } catch {
        window.sessionStorage.removeItem(LIST_CACHE_STORAGE_KEY);
      }
    }

    setHasRestoredCache(true);
  }, [hasRestoredCache, hasUrlDrivenFilters]);

  useEffect(() => {
    if (!hasRestoredCache || typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      LIST_CACHE_STORAGE_KEY,
      JSON.stringify({ registros, totalCount, page, pageSize }),
    );
  }, [hasRestoredCache, registros, totalCount, page, pageSize]);

  useEffect(() => {
    if (!hasRestoredState || typeof window === "undefined") {
      return;
    }

    const next: DocumentosListState = {
      tipoFilter,
      tipoLaudoFilter,
      userFilter,
      lojaFilter,
      prestadorFilter,
      statusFilter,
      identificacaoFilter,
      anoFilter,
      mesFilter,
      somenteAssinados,
      somenteDisponiveisLote,
      viewMode,
      scrollY: listStateRef.current?.scrollY ?? window.scrollY,
      page,
      pageSize,
    };

    listStateRef.current = next;
    window.sessionStorage.setItem(
      LIST_STATE_STORAGE_KEY,
      JSON.stringify(next),
    );
  }, [
    hasRestoredState,
    tipoFilter,
    tipoLaudoFilter,
    userFilter,
    lojaFilter,
    prestadorFilter,
    statusFilter,
    identificacaoFilter,
    anoFilter,
    mesFilter,
    somenteAssinados,
    somenteDisponiveisLote,
    viewMode,
    page,
    pageSize,
  ]);

  useEffect(() => {
    if (!hasRestoredState || typeof window === "undefined") {
      return;
    }

    let writeTimer: number | null = null;
    const handleScroll = () => {
      if (writeTimer !== null) {
        return;
      }
      writeTimer = window.setTimeout(() => {
        writeTimer = null;
        const current = listStateRef.current;
        if (!current) {
          return;
        }
        const next = { ...current, scrollY: window.scrollY };
        listStateRef.current = next;
        window.sessionStorage.setItem(
          LIST_STATE_STORAGE_KEY,
          JSON.stringify(next),
        );
      }, 200);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (writeTimer !== null) {
        window.clearTimeout(writeTimer);
      }
    };
  }, [hasRestoredState, hasUrlDrivenFilters]);

  useEffect(() => {
    if (anoFilter === "todos" && mesFilter !== "todos") {
      setMesFilter("todos");
    }
  }, [anoFilter, mesFilter]);

  useEffect(() => {
    if (tipoFilter !== TIPO_ASSINAVEL && tipoLaudoFilter !== "todos") {
      setTipoLaudoFilter("todos");
    }
  }, [tipoFilter, tipoLaudoFilter]);

  useEffect(() => {
    setPage(1);
  }, [
    tipoFilter,
    tipoLaudoFilter,
    userFilter,
    lojaFilter,
    prestadorFilter,
    statusFilter,
    identificacaoDebounced,
    anoFilter,
    mesFilter,
    somenteAssinados,
    somenteDisponiveisLote,
  ]);

  useEffect(() => {
    const trimmed = identificacaoFilter.trim();
    const timer = window.setTimeout(() => {
      setIdentificacaoDebounced(trimmed);
    }, 350);
    return () => {
      window.clearTimeout(timer);
    };
  }, [identificacaoFilter]);

  useEffect(() => {
    if (authLoading || accessLoading) {
      return;
    }

    if (!userId) {
      router.replace("/login");
      return;
    }

    if (!canViewAllDocuments && role !== "gerente_loja" && prestadoresUsuarioLoading) {
      return;
    }

    let active = true;

    const load = async () => {
      const loadedOnce = hasLoadedOnceRef.current;
      if (!loadedOnce) {
        setLoading(true);
      } else {
        setIsFetching(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const params = new URLSearchParams();
        if (!canViewAllDocuments) {
          if (role === "gerente_loja") {
            // Usa o filtro por loja no backend.
          } else if (prestadoresDoUsuario.length > 0) {
            if (prestadorFilter !== "todos") {
              params.append("prestadorId", prestadorFilter);
            } else {
              prestadoresDoUsuario.forEach((prestador) => {
                params.append("prestadorId", prestador.id);
              });
            }
          } else {
            params.set("userId", userId);
          }
        }
        if (canManageDocuments && userFilter !== "todos") {
          params.set("userId", userFilter);
        }
        params.set("limit", pageSize.toString());
        params.set("offset", ((page - 1) * pageSize).toString());
        if (tipoFilter !== "todos") {
          params.set("tipo", tipoFilter);
        }
        if (tipoLaudoFilter !== "todos") {
          params.set("tipoLaudo", tipoLaudoFilter);
        }
        if (lojaFilter !== "todos") {
          params.set("lojaId", lojaFilter);
        }
        if (statusFilter !== "todos") {
          params.set("status", statusFilter);
        }
        if (anoFilter !== "todos") {
          params.set("ano", anoFilter);
        }
        if (mesFilter !== "todos") {
          params.set("mes", mesFilter);
        }
        if (identificacaoDebounced) {
          params.set("identificacao", identificacaoDebounced);
        }
        if (somenteAssinados) {
          params.set("somenteAssinados", "true");
        }
        if (somenteDisponiveisLote) {
          params.set("somenteDisponiveisLote", "true");
        }

        const url =
          params.size > 0 ? `/api/documentos?${params.toString()}` : "/api/documentos";
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const payload = (await response.json()) as {
          registros?: FormularioRecord[];
          total?: number;
          error?: string;
        };

        if (!response.ok || !payload.registros) {
          throw new Error(
            payload.error ?? "Não foi possível carregar os documentos.",
          );
        }
        const parsed = payload.registros ?? [];

        if (active) {
          setRegistros(
            parsed.map((registro) => normalizeRegistroStatus(registro)),
          );
          setTotalCount(payload.total ?? parsed.length);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível carregar os documentos.",
          );
          setRegistros([]);
          setTotalCount(0);
        }
      } finally {
        if (active) {
          if (!loadedOnce) {
            setLoading(false);
          }
          setIsFetching(false);
          hasLoadedOnceRef.current = true;
          setHasLoadedOnce(true);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [
    authLoading,
    accessLoading,
    userId,
    router,
    canViewAllDocuments,
    canManageDocuments,
    role,
    getAccessToken,
    prestadoresUsuarioLoading,
    prestadoresDoUsuario,
    page,
    pageSize,
    tipoFilter,
    tipoLaudoFilter,
    userFilter,
    lojaFilter,
    prestadorFilter,
    statusFilter,
    anoFilter,
    mesFilter,
    identificacaoDebounced,
    somenteAssinados,
    somenteDisponiveisLote,
    refreshNonce,
  ]);

  useEffect(() => {
    if (authLoading || accessLoading) {
      return;
    }
    if (!userId) {
      return;
    }
    if (!canViewAllDocuments && role !== "gerente_loja" && prestadoresUsuarioLoading) {
      return;
    }
    if (!hasRestoredFilterOptions) {
      return;
    }
    void carregarFiltros();
  }, [
    authLoading,
    accessLoading,
    userId,
    canViewAllDocuments,
    role,
    prestadoresUsuarioLoading,
    carregarFiltros,
    hasRestoredFilterOptions,
  ]);

  useEffect(() => {
    if (!hasRestoredFilterOptions || typeof window === "undefined") {
      return;
    }
    window.sessionStorage.setItem(
      FILTERS_CACHE_STORAGE_KEY,
      JSON.stringify(filterOptions),
    );
  }, [hasRestoredFilterOptions, filterOptions]);

  const getPathParaVisualizacao = (registro: FormularioRecord) =>
    resolveSignedPdfPath(registro.arquivo_assinado_path) ??
    registro.arquivo_assinado_path ??
    registro.arquivo_path;

  const getPathParaDownload = (registro: FormularioRecord) => {
    const assinadoPdf = resolveSignedPdfPath(registro.arquivo_assinado_path);
    if (assinadoPdf) {
      return assinadoPdf;
    }
    return registro.arquivo_assinado_path ?? registro.arquivo_path;
  };

  const registrarAuditoriaDocumento = useCallback(
    async (
      registro: FormularioRecord,
      eventType: "baixado",
      metadata?: Record<string, unknown>,
    ) => {
      try {
        const token = await getAccessToken();
        await fetch(`/api/documentos/${registro.id}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ eventType, metadata }),
        });
      } catch (err) {
        console.warn("Nao foi possivel registrar auditoria do documento.", err);
      }
    },
    [getAccessToken],
  );

  const abrirDocumento = async (registro: FormularioRecord) => {
    const path = getPathParaVisualizacao(registro);
    if (!path) {
      setError("Arquivo indisponível no momento.");
      return;
    }

    try {
      setPdfAction({ id: registro.id, type: "open" });
      setError(null);
      const signedUrl = await getSignedFileUrl(path);
      const anchor = document.createElement("a");
      anchor.href = signedUrl;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (err) {
      console.error("Erro ao abrir documento:", err);
      setError("Não foi possível abrir o PDF. Verifique se o arquivo existe e tente novamente.");
    } finally {
      setPdfAction(null);
    }
  };

  const baixarDocumento = async (registro: FormularioRecord) => {
    const path = getPathParaDownload(registro);
    if (!path) {
      setError("Arquivo indisponível no momento.");
      return;
    }

    try {
      setPdfAction({ id: registro.id, type: "download" });
      setError(null);
      const signedUrl = await getSignedFileUrl(path);
      await downloadSignedUrlAsBlob(
        signedUrl,
        getDownloadFileName(registro, path),
      );
      void registrarAuditoriaDocumento(registro, "baixado", {
        arquivo_path: path,
      });
    } catch (err) {
      console.error("Erro ao baixar documento:", err);
      setError("Não foi possível baixar o PDF. Verifique se o arquivo existe e tente novamente.");
    } finally {
      setPdfAction(null);
    }
  };

  const marcarComoRevisado = async (registro: FormularioRecord) => {
    if (!canManageDocuments) {
      setError("Ação restrita para administradores.");
      return;
    }
    if (registro.tipo === TIPO_ASSINAVEL) {
      setError("Use o fluxo de assinatura para este documento.");
      return;
    }

    try {
      setReviewingId(registro.id);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/documentos", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: registro.id,
          status: "revisado",
        }),
      });
      const payload = (await response.json()) as {
        registro?: FormularioRecord;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.error ?? "Não foi possível marcar o documento como revisado.",
        );
      }
      setRegistros((prev) =>
        prev.map((item) =>
          item.id === registro.id
            ? normalizeRegistroStatus(
                payload.registro ?? { ...item, status: "revisado" },
              )
            : item,
        ),
      );
    } catch (err) {
      console.error("Erro ao marcar documento como revisado:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível marcar o documento como revisado.",
      );
    } finally {
      setReviewingId(null);
    }
  };

  
  const removerDocumento = async (registro: FormularioRecord) => {
    if (!canManageDocuments) {
      setError("Ação restrita para administradores.");
      return;
    }
    setConfirmDialog({ type: "single", registro });
  };
  const abrirEdicao = (registro: FormularioRecord) => {
    if (!canManageDocuments) {
      setError("Ação restrita para administradores.");
      return;
    }
    const campos = getEditFields(registro.tipo);
    const values = campos.reduce<Record<string, string>>((acc, campo) => {
      const raw = registro.dados?.[campo.name];
      acc[campo.name] = raw === null || raw === undefined ? "" : String(raw);
      return acc;
    }, {});
    setEditDialog({ registro, values });
  };

  const atualizarEdicao = (campo: string, valor: string) => {
    setEditDialog((prev) =>
      prev
        ? {
            ...prev,
            values: {
              ...prev.values,
              [campo]: valor,
            },
          }
        : prev,
    );
  };

  const salvarEdicao = async () => {
    if (!editDialog) {
      return;
    }
    if (!canManageDocuments) {
      setError("Ação restrita para administradores.");
      return;
    }
    try {
      setSavingEdit(true);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/documentos", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: editDialog.registro.id,
          updates: editDialog.values,
        }),
      });
      const payload = (await response.json()) as {
        registro?: FormularioRecord;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.error ?? "Não foi possível atualizar o documento.",
        );
      }
      setRegistros((prev) =>
        prev.map((item) =>
          item.id === editDialog.registro.id
            ? normalizeRegistroStatus(
                payload.registro ?? {
                  ...item,
                  dados: {
                    ...(item.dados ?? {}),
                    ...editDialog.values,
                  },
                },
              )
            : item,
        ),
      );
      setEditDialog(null);
    } catch (err) {
      console.error("Erro ao atualizar documento:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível atualizar o documento.",
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmarRemocao = async () => {
    if (!confirmDialog) {
      return;
    }
    if (confirmDialog.type === "batch") {
      await executarRemocaoEmLote();
      return;
    }
    if (!confirmDialog.registro) {
      return;
    }

    try {
      setDeletingId(confirmDialog.registro.id);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch(
        `/api/documentos?id=${encodeURIComponent(confirmDialog.registro.id)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(
          payload.error ?? "Não foi possível remover o documento.",
        );
      }
      setRegistros((prev) =>
        prev.filter((item) => item.id !== confirmDialog.registro?.id),
      );
      setSelectedIds((prev) =>
        prev.filter((id) => id !== confirmDialog.registro?.id),
      );
    } catch (err) {
      console.error("Erro ao remover documento:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível remover o documento.",
      );
    } finally {
      setDeletingId(null);
      setConfirmDialog(null);
    }
  };

  const removerSelecionados = () => {
    if (!canManageDocuments) {
      setError("Ação restrita para administradores.");
      return;
    }
    if (selectedIds.length === 0) {
      return;
    }
    setConfirmDialog({ type: "batch" });
  };

  const executarRemocaoEmLote = async () => {
    if (!canManageDocuments) {
      setConfirmDialog(null);
      setError("Ação restrita para administradores.");
      return;
    }
    if (selectedIds.length === 0) {
      setConfirmDialog(null);
      return;
    }

    try {
      setDeletingBatch(true);
      setError(null);
      const token = await getAccessToken();
      const query = selectedIds
        .map((id) => `id=${encodeURIComponent(id)}`)
        .join("&");
      const response = await fetch(`/api/documentos?${query}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(
          payload.error ?? "Não foi possível remover os documentos.",
        );
      }
      setRegistros((prev) =>
        prev.filter((item) => !selectedIds.includes(item.id)),
      );
      setSelectedIds([]);
    } catch (err) {
      console.error("Erro ao remover documentos:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível remover os documentos.",
      );
    } finally {
      setDeletingBatch(false);
      setConfirmDialog(null);
    }
  };

  const anosDisponiveis = useMemo(() => {
    if (filterOptions.anos.length > 0) {
      return filterOptions.anos;
    }
    return Array.from(
      new Set(
        registros.map((r) => new Date(r.created_at).getFullYear().toString()),
      ),
    ).sort((a, b) => Number(b) - Number(a));
  }, [filterOptions.anos, registros]);

  const registrosFiltrados = useMemo(() => registros, [registros]);

  const assinaturasPendentes = useMemo(
    () =>
      registrosFiltrados
        .filter(
          (registro) =>
            registro.status !== "assinado" &&
            registro.tipo === TIPO_ASSINAVEL,
        )
        .map((registro) => registro.id),
    [registrosFiltrados],
  );

  const resumoStatus = useMemo(() => {
    const assinados = registrosFiltrados.filter(
      (registro) => registro.status === "assinado",
    ).length;
    const emAnalise = registrosFiltrados.filter(
      (registro) => registro.status === "em_analise",
    ).length;
    const pendentes = registrosFiltrados.filter(
      (registro) => registro.status !== "assinado" && registro.status !== "revisado",
    ).length;
    const now = new Date();
    const esteMes = registrosFiltrados.filter((registro) => {
      const createdAt = new Date(registro.created_at);
      return (
        !Number.isNaN(createdAt.getTime()) &&
        createdAt.getFullYear() === now.getFullYear() &&
        createdAt.getMonth() === now.getMonth()
      );
    }).length;
    return { pendentes, emAnalise, assinados, esteMes };
  }, [registrosFiltrados]);

  useEffect(() => {
    const idsDisponiveis = new Set(registrosFiltrados.map((item) => item.id));
    setSelectedIds((prev) => prev.filter((id) => idsDisponiveis.has(id)));
  }, [registrosFiltrados]);

  const toggleSelecionar = (id: string) => {
    if (!canManageDocuments) {
      return;
    }
    const registro = registrosFiltrados.find((item) => item.id === id);
    if (!registro) {
      return;
    }
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const selecionarTodos = () => {
    if (!canManageDocuments) {
      return;
    }
    const todosIds = registrosFiltrados.map((item) => item.id);
    if (todosIds.length === 0) {
      return;
    }
    const allSelected = todosIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : todosIds);
  };

  const iniciarAssinaturaEmLote = () => {
    if (!canManageDocuments) {
      setError("Ação restrita para administradores.");
      return;
    }
    const assinaturasSelecionadas = selectedIds.filter((id) =>
      assinaturasPendentes.includes(id),
    );
    if (assinaturasSelecionadas.length === 0) {
      setError("Selecione ao menos um documento pendente para assinar.");
      return;
    }
    setStartingBatch(true);
    const queue = assinaturasSelecionadas.join(",");
    if (assinaturasSelecionadas.length === 1) {
      router.push(`/documentos/${assinaturasSelecionadas[0]}`);
      return;
    }
    router.push(
      `/documentos/${assinaturasSelecionadas[0]}?lote=${encodeURIComponent(queue)}`,
    );
  };

  const limparSelecao = () => {
    setSelectedIds([]);
  };

  const resetFilters = useCallback(() => {
    setTipoFilter("todos");
    setTipoLaudoFilter("todos");
    setUserFilter("todos");
    setLojaFilter("todos");
    setPrestadorFilter("todos");
    setStatusFilter("todos");
    setIdentificacaoFilter("");
    setAnoFilter("todos");
    setMesFilter("todos");
    setSomenteAssinados(false);
    setSomenteDisponiveisLote(false);
    setPage(1);
    setRestoredNotice(false);
  }, []);

  const refreshDocumentosList = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(LIST_CACHE_STORAGE_KEY);
    }
    setRestoredNotice(false);
    setRefreshNonce((prev) => prev + 1);
  }, []);

  const clearRestoredFilters = useCallback(() => {
    resetFilters();
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(LIST_STATE_STORAGE_KEY);
      window.sessionStorage.removeItem(LIST_CACHE_STORAGE_KEY);
    }
    setRestoredNotice(false);
    setRefreshNonce((prev) => prev + 1);
  }, [resetFilters]);

  const aplicarFiltroRapido = useCallback(
    (
      filter:
        | "todos"
        | "pendentes"
        | "assinados"
        | "notas_fiscais"
        | "laudos"
        | "este_mes",
    ) => {
      if (filter === "todos") {
        resetFilters();
        return;
      }

      if (filter === "pendentes") {
        setStatusFilter("pendente");
        setSomenteAssinados(false);
        return;
      }

      if (filter === "assinados") {
        setStatusFilter("assinado");
        setSomenteAssinados(true);
        return;
      }

      if (filter === "notas_fiscais") {
        setTipoFilter("notas_fiscais");
        setTipoLaudoFilter("todos");
        return;
      }

      if (filter === "laudos") {
        setTipoFilter("registro_laudos");
        return;
      }

      const now = new Date();
      setAnoFilter(String(now.getFullYear()));
      setMesFilter(String(now.getMonth() + 1).padStart(2, "0"));
    },
    [resetFilters],
  );

  const tipoOptions = useMemo(
    () => {
      const extras = Array.from(
        new Set(
          registros
            .map((registro) => registro.tipo)
            .filter((tipo) => !(tipo in TIPO_LABEL)),
        ),
      );

      return [
        { value: "todos", label: "Todos os tipos" },
        ...Object.entries(TIPO_LABEL).map(([value, label]) => ({
          value,
          label,
        })),
        ...extras.map((tipo) => ({
          value: tipo,
          label: getTipoDescricao(tipo),
        })),
      ];
    },
    [registros],
  );

  const statusOptions = useMemo(() => {
    if (filterOptions.status.length > 0) {
      return ["todos", ...Array.from(new Set(filterOptions.status))];
    }
    const base = ["todos", "pendente", "em_analise", "revisado", "assinado"];
    const extras = Array.from(
      new Set(
        registros
          .map((registro) => registro.status)
          .filter((status) => !base.includes(status)),
      ),
    );
    const unique = Array.from(new Set([...base, ...extras]));
    const ordered = [
      ...base.filter((status) => unique.includes(status)),
      ...extras,
    ];
    const seen = new Set<string>();
    return ordered.filter((status) => {
      if (seen.has(status)) {
        return false;
      }
      seen.add(status);
      return true;
    });
  }, [filterOptions.status, registros]);

  const tipoLaudoOptions = useMemo(() => {
    if (filterOptions.tipoLaudo.length > 0) {
      return ["todos", ...Array.from(new Set(filterOptions.tipoLaudo))];
    }
    const valores = Array.from(
      new Set(
        registros
          .map((registro) => getCampoTexto(registro.dados, ["tipo_laudo"]))
          .filter((valor): valor is string => Boolean(valor)),
      ),
    );
    return ["todos", ...valores];
  }, [filterOptions.tipoLaudo, registros]);

  const colaboradorOptions = useMemo(
    () => [
      { value: "todos", label: "Todos os colaboradores" },
      ...adminUsers.map((item) => {
        const name = item.name?.trim();
        if (name && item.email) {
          return {
            value: item.id,
            label: `${name} (${item.email})`,
          };
        }
        return {
          value: item.id,
          label: item.email ?? name ?? item.id,
        };
      }),
    ],
    [adminUsers],
  );

  const lojaOptions = useMemo(() => {
    const formatLojaLabel = (codigo: string | null, nome: string) =>
      codigo ? `${codigo} - ${nome}` : nome;
    const base = [
      { value: "todos", label: "Todas as lojas" },
      ...lojas.map((loja) => ({
        value: loja.id,
        label: formatLojaLabel(loja.codigo, loja.nome),
      })),
    ];
    if (filterOptions.lojas.length === 0) {
      return base;
    }
    const extras = filterOptions.lojas.map((loja) => ({
      value: loja.id,
      label: formatLojaLabel(loja.codigo, loja.nome),
    }));
    const unique = new Map<string, { value: string; label: string }>();
    [...base, ...extras].forEach((item) => unique.set(item.value, item));
    return Array.from(unique.values());
  }, [lojas, filterOptions.lojas]);

  const prestadorOptions = useMemo(() => {
    const options = filterOptions.prestadores.length > 0
      ? filterOptions.prestadores
      : prestadoresDoUsuario.map((p) => ({ id: p.id, nome: p.nome, tipo_servico: p.tipo_servico }));
    return [
      { value: "todos", label: "Todos os prestadores" },
      ...options.map((prestador) => ({
        value: prestador.id,
        label: prestador.tipo_servico
          ? `${prestador.nome} - ${prestador.tipo_servico}`
          : prestador.nome,
      })),
    ];
  }, [filterOptions.prestadores, prestadoresDoUsuario]);

  const colaboradorLabelById = useMemo(() => {
    const map = new Map<string, string>();
    adminUsers.forEach((item) => {
      const name = item.name?.trim();
      map.set(item.id, name || item.email || item.id);
    });
    return map;
  }, [adminUsers]);

  const mesSelecionadoLabel =
    mesFilter === "todos"
      ? "Todos os meses"
      : anoFilter !== "todos"
        ? `${mesFilter}/${anoFilter}`
        : MESES.find((mes) => mes.value === mesFilter)?.label ?? "Atual";

  const activeFilterChips = useMemo(() => {
    const chips: {
      key: string;
      label: string;
      value: string;
      onRemove: () => void;
    }[] = [];

    if (tipoFilter !== "todos") {
      chips.push({
        key: "tipo",
        label: "Tipo",
        value: getTipoDescricao(tipoFilter),
        onRemove: () => setTipoFilter("todos"),
      });
    }
    if (statusFilter !== "todos") {
      chips.push({
        key: "status",
        label: "Status",
        value: formatStatusLabel(statusFilter),
        onRemove: () => setStatusFilter("todos"),
      });
    }
    if (lojaFilter !== "todos") {
      chips.push({
        key: "loja",
        label: "Loja",
        value:
          lojaOptions.find((option) => option.value === lojaFilter)?.label ??
          lojaFilter,
        onRemove: () => setLojaFilter("todos"),
      });
    }
    if (prestadorFilter !== "todos") {
      chips.push({
        key: "prestador",
        label: "Prestador",
        value:
          prestadorOptions.find((option) => option.value === prestadorFilter)
            ?.label ?? prestadorFilter,
        onRemove: () => setPrestadorFilter("todos"),
      });
    }
    if (userFilter !== "todos") {
      chips.push({
        key: "colaborador",
        label: "Colaborador",
        value:
          colaboradorOptions.find((option) => option.value === userFilter)
            ?.label ?? userFilter,
        onRemove: () => setUserFilter("todos"),
      });
    }
    if (tipoLaudoFilter !== "todos") {
      chips.push({
        key: "tipo-laudo",
        label: "Tipo de laudo",
        value: tipoLaudoFilter,
        onRemove: () => setTipoLaudoFilter("todos"),
      });
    }
    if (anoFilter !== "todos") {
      chips.push({
        key: "ano",
        label: "Ano",
        value: anoFilter,
        onRemove: () => setAnoFilter("todos"),
      });
    }
    if (mesFilter !== "todos") {
      chips.push({
        key: "mes",
        label: "Mes",
        value: mesSelecionadoLabel,
        onRemove: () => setMesFilter("todos"),
      });
    }
    if (identificacaoFilter.trim()) {
      chips.push({
        key: "busca",
        label: "Busca",
        value: identificacaoFilter.trim(),
        onRemove: () => setIdentificacaoFilter(""),
      });
    }
    if (somenteAssinados) {
      chips.push({
        key: "somente-assinados",
        label: "Assinados",
        value: "Somente assinados",
        onRemove: () => setSomenteAssinados(false),
      });
    }
    if (somenteDisponiveisLote) {
      chips.push({
        key: "lote",
        label: "Lote",
        value: "Disponiveis para lote",
        onRemove: () => setSomenteDisponiveisLote(false),
      });
    }

    return chips;
  }, [
    anoFilter,
    colaboradorOptions,
    identificacaoFilter,
    lojaFilter,
    lojaOptions,
    mesFilter,
    mesSelecionadoLabel,
    prestadorFilter,
    prestadorOptions,
    somenteAssinados,
    somenteDisponiveisLote,
    statusFilter,
    tipoFilter,
    tipoLaudoFilter,
    userFilter,
  ]);

  const showErrorMessage = error ?? authError ?? accessError;
  const hasSelection = selectedIds.length > 0;
  const assinaturasSelecionadasCount = selectedIds.filter((id) =>
    assinaturasPendentes.includes(id),
  ).length;
  const totalResultados = totalCount;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const canPrevPage = page > 1;
  const canNextPage = page < totalPages;
  const selectedRegistro = useMemo(
    () =>
      selectedDocumentId
        ? registros.find((registro) => registro.id === selectedDocumentId) ?? null
        : null,
    [registros, selectedDocumentId],
  );

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  if (authLoading || accessLoading || (!hasLoadedOnce && loading)) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando documentos...
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 py-4">
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-6" onClick={() => setConfirmDialog(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl shadow-slate-900/20" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc">
            <p id="confirm-title" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Confirmar exclusão
            </p>
            <p id="confirm-desc" className="mt-2 text-sm text-slate-700">
              {confirmDialog.type === "batch"
                ? "Tem certeza que deseja remover os documentos selecionados? Esta ação não pode ser desfeita."
                : "Tem certeza que deseja remover este documento? Esta ação não pode ser desfeita."}
            </p>
            {confirmDialog.type === "single" && confirmDialog.registro && (
              <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-mono text-[11px] text-slate-500">
                  {confirmDialog.registro.id}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {getTipoDescricao(confirmDialog.registro.tipo)}
                </p>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2 text-[11px]">
              <button
                type="button"
                ref={confirmCancelRef}
                onClick={() => setConfirmDialog(null)}
                className="rounded-full border border-slate-300 px-4 py-1.5 text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmarRemocao()}
                disabled={deletingBatch || deletingId !== null}
                className="rounded-full border border-red-200 bg-red-50 px-4 py-1.5 text-red-700 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {confirmDialog.type === "batch"
                  ? deletingBatch
                    ? "Removendo..."
                    : "Remover selecionados"
                  : deletingId
                    ? "Removendo..."
                    : "Remover documento"}
              </button>
            </div>
          </div>
        </div>
      )}
      {editDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-6"
          onClick={() => setEditDialog(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl shadow-slate-900/20"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
          >
            <p
              id="edit-title"
              className="text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Editar documento
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {getTipoDescricao(editDialog.registro.tipo)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {editDialog.registro.id}
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {getEditFields(editDialog.registro.tipo).map((campo) => {
                const value = editDialog.values[campo.name] ?? "";
                return (
                  <label
                    key={campo.name}
                    className={`text-xs font-semibold text-slate-600 ${
                      campo.type === "textarea" ? "md:col-span-2" : ""
                    }`}
                  >
                    {campo.label}
                    {campo.type === "textarea" ? (
                      <textarea
                        value={value}
                        onChange={(event) =>
                          atualizarEdicao(campo.name, event.target.value)
                        }
                        rows={3}
                        className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                      />
                    ) : (
                      <input
                        type={campo.type ?? "text"}
                        value={value}
                        onChange={(event) =>
                          atualizarEdicao(campo.name, event.target.value)
                        }
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                      />
                    )}
                  </label>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => setEditDialog(null)}
                className="rounded-full border border-slate-300 px-4 py-1.5 text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void salvarEdicao()}
                disabled={savingEdit}
                className="rounded-full bg-sky-600 px-4 py-1.5 font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {savingEdit ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
      <DocumentDetailsDrawer
        documentId={selectedDocumentId}
        fallbackRegistro={selectedRegistro}
        isOpen={Boolean(selectedDocumentId)}
        canManageDocuments={canManageDocuments}
        pdfAction={pdfAction}
        reviewingId={reviewingId}
        onClose={() => setSelectedDocumentId(null)}
        onOpenPdf={(registro) => void abrirDocumento(registro)}
        onDownloadPdf={(registro) => void baixarDocumento(registro)}
        onEdit={(registro) => abrirEdicao(registro)}
        onReview={(registro) => void marcarComoRevisado(registro)}
        onSign={(registro) => router.push(`/documentos/${registro.id}`)}
      />
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Files className="h-5 w-5 text-slate-700" />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Documentos enviados
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Consulte e filtre rapidamente os documentos enviados pelos
            formulários.
          </p>
        </div>
        <div className="hidden text-right text-xs text-slate-500 md:block">
          <p className="font-semibold text-slate-700">
            {totalResultados} resultado(s)
          </p>
          <p>
            {isFetching ? "Atualizando resultados..." : "Filtros ativos atualizam automaticamente."}
          </p>
        </div>
      </div>

      {showErrorMessage && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 shadow-sm shadow-red-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs sm:text-sm">{showErrorMessage}</p>
            {error && (
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-[11px] font-semibold text-red-600 underline underline-offset-2"
              >
                Fechar
              </button>
            )}
          </div>
        </div>
      )}

      {restoredNotice && (
        <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm text-sky-800 shadow-sm shadow-sky-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-medium">Filtros anteriores restaurados.</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={clearRestoredFilters}
                className="rounded-full border border-sky-200 bg-white px-3 py-1.5 font-semibold text-sky-700 transition hover:border-sky-300"
              >
                Limpar filtros
              </button>
              <button
                type="button"
                onClick={refreshDocumentosList}
                className="rounded-full bg-sky-600 px-3 py-1.5 font-semibold text-white transition hover:bg-sky-500"
              >
                Atualizar lista
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Total", value: totalResultados, detail: "no filtro atual" },
          { label: "Pendentes", value: resumoStatus.pendentes, detail: "nesta pagina" },
          { label: "Em analise", value: resumoStatus.emAnalise, detail: "nesta pagina" },
          { label: "Assinados", value: resumoStatus.assinados, detail: "nesta pagina" },
          { label: "Este mes", value: resumoStatus.esteMes, detail: "nesta pagina" },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {item.label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {item.value}
            </p>
            <p className="text-[11px] text-slate-500">{item.detail}</p>
          </div>
        ))}
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <div className="min-w-0 space-y-6">
          <DocumentosFilters
            canManageDocuments={canManageDocuments}
            filterOptionsLoading={filterOptionsLoading}
            adminUsersLoading={adminUsersLoading}
            viewMode={viewMode}
            identificacaoFilter={identificacaoFilter}
            tipoFilter={tipoFilter}
            tipoLaudoFilter={tipoLaudoFilter}
            statusFilter={statusFilter}
            userFilter={userFilter}
            lojaFilter={lojaFilter}
            prestadorFilter={prestadorFilter}
            anoFilter={anoFilter}
            mesFilter={mesFilter}
            somenteAssinados={somenteAssinados}
            somenteDisponiveisLote={somenteDisponiveisLote}
            tipoOptions={tipoOptions}
            tipoLaudoOptions={tipoLaudoOptions}
            statusOptions={statusOptions}
            colaboradorOptions={colaboradorOptions}
            lojaOptions={lojaOptions}
            prestadorOptions={prestadorOptions}
            anosDisponiveis={anosDisponiveis}
            meses={MESES}
            activeFilterCount={activeFilterChips.length}
            onResetFilters={resetFilters}
            onQuickFilter={aplicarFiltroRapido}
            onViewModeChange={setViewMode}
            onIdentificacaoFilterChange={setIdentificacaoFilter}
            onTipoFilterChange={setTipoFilter}
            onTipoLaudoFilterChange={setTipoLaudoFilter}
            onStatusFilterChange={setStatusFilter}
            onUserFilterChange={setUserFilter}
            onLojaFilterChange={setLojaFilter}
            onPrestadorFilterChange={setPrestadorFilter}
            onAnoFilterChange={setAnoFilter}
            onMesFilterChange={setMesFilter}
            onSomenteAssinadosChange={setSomenteAssinados}
            onSomenteDisponiveisLoteChange={setSomenteDisponiveisLote}
            formatStatusLabel={formatStatusLabel}
          />
        </div>

          {activeFilterChips.length > 0 && (
            <div className="rounded-2xl bg-white p-3 shadow-sm shadow-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Filtros ativos
                </span>
                {activeFilterChips.map((chip) => (
                  <span
                    key={chip.key}
                    className="inline-flex max-w-full items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
                  >
                    <span className="truncate">
                      {chip.label}: {chip.value}
                    </span>
                    <button
                      type="button"
                      onClick={chip.onRemove}
                      className="rounded-full bg-white px-1 text-slate-500 transition hover:text-slate-900"
                      aria-label={`Remover filtro ${chip.label}`}
                    >
                      x
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Limpar todos os filtros
                </button>
              </div>
            </div>
          )}

          {canManageDocuments && (
            <DocumentosBatchActions
              assinaturasPendentesCount={assinaturasPendentes.length}
              selectedIds={selectedIds}
              hasSelection={hasSelection}
              registrosFiltradosCount={registrosFiltrados.length}
              assinaturasSelecionadasCount={assinaturasSelecionadasCount}
              deletingBatch={deletingBatch}
              startingBatch={startingBatch}
              onToggleSelecionar={toggleSelecionar}
              onSelecionarTodos={selecionarTodos}
              onLimparSelecao={limparSelecao}
              onRemoverSelecionados={removerSelecionados}
              onIniciarAssinaturaEmLote={iniciarAssinaturaEmLote}
            />
          )}

          <DocumentosPagination
            totalResultados={totalResultados}
            page={page}
            pageSize={pageSize}
            totalPages={totalPages}
            canPrevPage={canPrevPage}
            canNextPage={canNextPage}
            onPrevPage={() => setPage((prev) => Math.max(prev - 1, 1))}
            onNextPage={() => setPage((prev) => Math.min(prev + 1, totalPages))}
          />

      {totalResultados === 0 ? (
        <DocumentosEmptyState
          hasYearFilter={anoFilter !== "todos"}
          onResetFilters={resetFilters}
          onSearchAllYears={() => setAnoFilter("todos")}
          onRefresh={refreshDocumentosList}
        />
      ) : (
        <>
          {viewMode === "tabela" && (
            <div className="hidden min-w-0 overflow-hidden rounded-2xl bg-white shadow-sm shadow-slate-200 xl:block">
              <div className="relative max-w-full overflow-x-auto">
                <table className="w-full min-w-[1280px] divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  {canManageDocuments && (
                    <th className="w-[52px] px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        onChange={selecionarTodos}
                        checked={
                          registrosFiltrados.length > 0 &&
                          registrosFiltrados.every((item) =>
                            selectedIds.includes(item.id),
                          )
                        }
                        disabled={registrosFiltrados.length === 0}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:cursor-not-allowed"
                        aria-label="Selecionar todos"
                      />
                    </th>
                  )}
                  <th className="w-[240px] px-4 py-3 text-left">Documento</th>
                  <th className="w-[300px] px-4 py-3 text-left">Identificação</th>
                  <th className="w-[140px] px-4 py-3 text-left">Tipo</th>
                  <th className="hidden w-[150px] px-4 py-3 text-left lg:table-cell">
                    Tipo de laudo
                  </th>
                  <th className="hidden w-[230px] px-4 py-3 text-left xl:table-cell">
                    Observações
                  </th>
                  <th className="w-[130px] px-4 py-3 text-left">Status</th>
                  <th className="hidden w-[180px] px-4 py-3 text-left md:table-cell">
                    Enviado em
                  </th>
                  <th className="sticky right-0 z-20 w-[180px] min-w-[180px] whitespace-nowrap border-l border-slate-100 bg-slate-50 px-4 py-3 text-right">
                    Ações
                  </th>
</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
                {registrosFiltrados.map((registro) => {
                  const identificacaoConfig = getIdentificacaoConfig(
                    registro.tipo,
                  );
                  const nomeDocumento = getDocumentoNome(registro);
                  const pageCount = getPageCount(registro);
                  const identificacaoValor =
                    getIdentificacaoValor(registro) ??
                    `${identificacaoConfig.label} não informado`;
                  const identificacaoComplemento =
                    getIdentificacaoComplemento(registro);
                  const edicaoInfo = getEdicaoInfo(registro);
                  const tipoLaudo = getTipoLaudo(registro);
                  const observacoes = getObservacoes(registro);
                  const numeroNf = getNumeroNf(registro);
                  const numeroPedido = getNumeroPedido(registro);
                  const cnpjDocumento = getCnpjDocumento(registro);
                  const lojaNome = getLojaNome(registro);
                  const prestadorNome = getPrestadorNome(registro);
                  const enviadoPor = registro.user_id
                    ? colaboradorLabelById.get(registro.user_id) ?? registro.user_id
                    : null;
                  const isSelecionavel =
                    registro.tipo === TIPO_ASSINAVEL &&
                    registro.status !== "assinado";
                  const isMarcado = selectedIds.includes(registro.id);
                  const opening = pdfAction?.id === registro.id && pdfAction.type === "open";
                  const downloading =
                    pdfAction?.id === registro.id && pdfAction.type === "download";

                  return (
                    <tr
                      key={registro.id}
                      className="cursor-pointer align-top transition hover:bg-slate-50"
                      tabIndex={0}
                      onClick={() => setSelectedDocumentId(registro.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedDocumentId(registro.id);
                        }
                      }}
                    >
                      {canManageDocuments && (
                        <td
                          className="px-4 py-3"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isMarcado}
                            onChange={() => toggleSelecionar(registro.id)}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:cursor-not-allowed"
                            aria-label="Selecionar documento para assinatura"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <p
                          className="max-w-[220px] break-words text-sm font-semibold text-slate-900"
                          title={nomeDocumento}
                        >
                          {nomeDocumento}
                        </p>
                        {pageCount ? (
                          <p className="text-xs text-slate-500">
                            {pageCount} página(s)
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {identificacaoConfig.label}
                        </p>
                        <p className="text-sm font-medium text-slate-900">
                          {identificacaoValor}
                        </p>
                        {identificacaoComplemento && (
                          <p className="text-xs text-slate-500">
                            {identificacaoComplemento}
                          </p>
                        )}
                        <div className="mt-2 flex max-w-[320px] flex-wrap gap-1.5 text-[11px] text-slate-500">
                          {lojaNome && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5">
                              Loja: {lojaNome}
                            </span>
                          )}
                          {prestadorNome && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5">
                              Prestador: {prestadorNome}
                            </span>
                          )}
                          {numeroNf && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5">
                              NF: {numeroNf}
                            </span>
                          )}
                          {numeroPedido && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5">
                              Pedido: {numeroPedido}
                            </span>
                          )}
                          {cnpjDocumento && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5">
                              CNPJ: {cnpjDocumento}
                            </span>
                          )}
                        </div>
                        {edicaoInfo && (
                          <p className="mt-1 text-[11px] font-semibold text-amber-700">
                            Documento alterado por {edicaoInfo.editedBy ?? "admin"}
                            {edicaoInfo.editedAt ? ` em ${edicaoInfo.editedAt}` : ""}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {getTipoDescricao(registro.tipo)}
                      </td>
                      <td className="hidden px-4 py-3 text-xs leading-5 text-slate-500 lg:table-cell">
                        {registro.tipo === TIPO_ASSINAVEL && tipoLaudo
                          ? tipoLaudo
                          : "-"}
                      </td>
                      <td className="hidden px-4 py-3 text-xs leading-5 text-slate-500 xl:table-cell">
                        {registro.tipo === TIPO_ASSINAVEL && observacoes
                          ? observacoes
                          : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                            registro.status === "assinado"
                              ? "bg-emerald-50 text-emerald-700"
                              : registro.status === "revisado"
                                ? "bg-sky-50 text-sky-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {formatStatusLabel(registro.status)}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">
                        {formatDateTime(registro.created_at)}
                        {enviadoPor && (
                          <p className="mt-1 max-w-[180px] truncate text-[11px] text-slate-400">
                            por {enviadoPor}
                          </p>
                        )}
                      </td>
                      <td
                        className="sticky right-0 z-10 w-[180px] min-w-[180px] whitespace-nowrap border-l border-slate-100 bg-white px-4 py-3"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex flex-col items-end gap-2 text-[11px]">
                          <button
                            type="button"
                            onClick={() => void abrirDocumento(registro)}
                            disabled={opening || downloading}
                            className="min-w-[88px] rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            {opening ? "Abrindo..." : "Ver PDF"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void baixarDocumento(registro)}
                            disabled={opening || downloading}
                            className="min-w-[88px] rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            {downloading ? "Baixando..." : "Baixar PDF"}
                          </button>
                          {canManageDocuments &&
                            registro.tipo !== TIPO_ASSINAVEL &&
                            registro.status !== "revisado" &&
                            registro.status !== "assinado" && (
                            <button
                              type="button"
                              onClick={() => void marcarComoRevisado(registro)}
                              disabled={reviewingId === registro.id}
                              className="min-w-[88px] rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {reviewingId === registro.id
                                ? "Salvando..."
                                : "Confirmar revisão"}
                            </button>
                          )}
                          {canManageDocuments && (
                            <button
                              type="button"
                              onClick={() => abrirEdicao(registro)}
                              className="min-w-[88px] rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                            >
                              Editar
                            </button>
                          )}
                          {canManageDocuments && (
                            <button
                              type="button"
                              onClick={() => void removerDocumento(registro)}
                              disabled={deletingId === registro.id}
                              className="min-w-[88px] rounded-full border border-red-200 px-3 py-1 text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {deletingId === registro.id
                                ? "Removendo..."
                                : "Remover"}
                            </button>
                          )}
                          {canManageDocuments && isSelecionavel && (
                            <button
                              type="button"
                              onClick={() => router.push(`/documentos/${registro.id}`)}
                              className="min-w-[88px] rounded-full bg-sky-500 px-3 py-1 text-white transition hover:bg-sky-400"
                            >
                              Assinar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
                </table>
              </div>
            </div>
          )}
          <div
            className={
              viewMode === "tabela"
                ? "grid gap-4 xl:hidden"
                : "grid gap-4 md:grid-cols-2"
            }
          >
            {registrosFiltrados.map((registro) => {
            const identificacaoConfig = getIdentificacaoConfig(registro.tipo);
            const nomeDocumento = getDocumentoNome(registro);
                  const pageCount = getPageCount(registro);
            const identificacaoValor =
              getIdentificacaoValor(registro) ??
              `${identificacaoConfig.label} não informado`;
            const identificacaoComplemento =
              getIdentificacaoComplemento(registro);
            const edicaoInfo = getEdicaoInfo(registro);
            const tipoLaudo = getTipoLaudo(registro);
            const observacoes = getObservacoes(registro);
            const numeroNf = getNumeroNf(registro);
            const numeroPedido = getNumeroPedido(registro);
            const cnpjDocumento = getCnpjDocumento(registro);
            const lojaNome = getLojaNome(registro);
            const prestadorNome = getPrestadorNome(registro);
            const enviadoPor = registro.user_id
              ? colaboradorLabelById.get(registro.user_id) ?? registro.user_id
              : null;
            const isSelecionavel =
              registro.tipo === TIPO_ASSINAVEL &&
              registro.status !== "assinado";
            const isMarcado = selectedIds.includes(registro.id);
            const opening = pdfAction?.id === registro.id && pdfAction.type === "open";
            const downloading =
              pdfAction?.id === registro.id && pdfAction.type === "download";

            return (
              <div
                key={registro.id}
                className="cursor-pointer rounded-2xl bg-white p-4 shadow-sm shadow-slate-200 transition hover:-translate-y-0.5 hover:shadow-md"
                role="button"
                tabIndex={0}
                onClick={() => setSelectedDocumentId(registro.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedDocumentId(registro.id);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Documento
                    </p>
                    <p
                      className="text-sm font-semibold text-slate-900"
                      title={nomeDocumento}
                    >
                      {nomeDocumento}
                    </p>
                    {pageCount ? (
                      <p className="text-xs text-slate-500">
                        {pageCount} página(s)
                      </p>
                    ) : null}
                  </div>
                  {canManageDocuments && (
                    <label
                      className="flex items-center gap-2 text-xs text-slate-500"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isMarcado}
                        onChange={() => toggleSelecionar(registro.id)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:cursor-not-allowed"
                      />
                      Selecionar
                    </label>
                  )}
                </div>
                <div className="mt-3 space-y-2 text-sm text-slate-600">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {identificacaoConfig.label}
                    </p>
                    <p className="text-sm font-semibold text-slate-900">
                      {identificacaoValor}
                    </p>
                    {identificacaoComplemento && (
                      <p className="text-xs text-slate-500">
                        {identificacaoComplemento}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                      {lojaNome && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">
                          Loja: {lojaNome}
                        </span>
                      )}
                      {prestadorNome && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">
                          Prestador: {prestadorNome}
                        </span>
                      )}
                      {numeroNf && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">
                          NF: {numeroNf}
                        </span>
                      )}
                      {numeroPedido && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">
                          Pedido: {numeroPedido}
                        </span>
                      )}
                      {cnpjDocumento && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">
                          CNPJ: {cnpjDocumento}
                        </span>
                      )}
                    </div>
                    {edicaoInfo && (
                      <p className="mt-1 text-[11px] font-semibold text-amber-700">
                        Documento alterado por {edicaoInfo.editedBy ?? "admin"}
                        {edicaoInfo.editedAt ? ` em ${edicaoInfo.editedAt}` : ""}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500">
                      Tipo
                    </p>
                    <p>{getTipoDescricao(registro.tipo)}</p>
                  </div>
                  {registro.tipo === TIPO_ASSINAVEL && tipoLaudo && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500">
                        Tipo de laudo
                      </p>
                      <p>{tipoLaudo}</p>
                    </div>
                  )}
                  {registro.tipo === TIPO_ASSINAVEL && observacoes && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500">
                        Observações
                      </p>
                      <p className="text-xs text-slate-500">{observacoes}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                        registro.status === "assinado"
                          ? "bg-emerald-50 text-emerald-700"
                          : registro.status === "revisado"
                            ? "bg-sky-50 text-sky-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {formatStatusLabel(registro.status)}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {formatDateTime(registro.created_at)}
                    </span>
                    {enviadoPor && (
                      <span className="text-[11px] text-slate-400">
                        por {enviadoPor}
                      </span>
                    )}
                  </div>
                </div>
                <div
                  className="mt-4 flex flex-wrap gap-2 text-[11px]"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => void abrirDocumento(registro)}
                    disabled={opening || downloading}
                    className="min-w-[88px] rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    {opening ? "Abrindo..." : "Ver PDF"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void baixarDocumento(registro)}
                    disabled={opening || downloading}
                    className="min-w-[88px] rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    {downloading ? "Baixando..." : "Baixar PDF"}
                  </button>
                  {canManageDocuments &&
                    registro.tipo !== TIPO_ASSINAVEL &&
                    registro.status !== "revisado" &&
                    registro.status !== "assinado" && (
                    <button
                      type="button"
                      onClick={() => void marcarComoRevisado(registro)}
                      disabled={reviewingId === registro.id}
                      className="min-w-[88px] rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {reviewingId === registro.id
                        ? "Salvando..."
                        : "Confirmar revisão"}
                    </button>
                  )}
                  {canManageDocuments && (
                    <button
                      type="button"
                      onClick={() => abrirEdicao(registro)}
                      className="min-w-[88px] rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      Editar
                    </button>
                  )}
                  {canManageDocuments && (
                    <button
                      type="button"
                      onClick={() => void removerDocumento(registro)}
                      disabled={deletingId === registro.id}
                      className="min-w-[88px] rounded-full border border-red-200 px-3 py-1 text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingId === registro.id ? "Removendo..." : "Remover"}
                    </button>
                  )}
                  {canManageDocuments && isSelecionavel && (
                    <button
                      type="button"
                      onClick={() => router.push(`/documentos/${registro.id}`)}
                      className="min-w-[88px] rounded-full bg-sky-500 px-3 py-1 text-white transition hover:bg-sky-400"
                    >
                      Assinar
                    </button>
                  )}
                </div>
              </div>
            );
            })}
          </div>
        </>
      )}
      </div>
    </div>
  );
}
























































