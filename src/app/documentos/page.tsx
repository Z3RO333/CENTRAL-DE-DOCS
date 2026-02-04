"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Files, Filter, LayoutGrid, Table as TableIcon } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { usePrestadores } from "@/hooks/usePrestadores";
import { useLojas } from "@/hooks/useLojas";

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

type DocumentosListState = {
  tipoFilter: string;
  tipoLaudoFilter: string;
  lojaFilter: string;
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
      return valor.trim();
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
      return primeiro.nome.trim();
    }
  }
  const path = registro.arquivo_assinado_path ?? registro.arquivo_path;
  if (path) {
    return path.split("/").pop() ?? path;
  }
  return registro.id;
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

export default function DocumentosPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const { isAdmin, role, loading: accessLoading, error: accessError } =
    useDocumentsAccess();
  const canViewAllDocuments = isAdmin;
  const canManageDocuments = isAdmin;
  const {
    prestadores: prestadoresDoUsuario,
    loading: prestadoresUsuarioLoading,
  } = usePrestadores({
    assignedOnly: true,
    enabled: Boolean(user) && !canViewAllDocuments && role !== "gerente_loja",
  });
  const { lojas } = useLojas({ enabled: canManageDocuments });
  const [loading, setLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registros, setRegistros] = useState<FormularioRecord[]>([]);
  const [tipoFilter, setTipoFilter] = useState<string>("todos");
  const [tipoLaudoFilter, setTipoLaudoFilter] = useState<string>("todos");
  const [lojaFilter, setLojaFilter] = useState<string>("todos");
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingBatch, setDeletingBatch] = useState(false);
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
        if (parsed.lojaFilter) {
          setLojaFilter(parsed.lojaFilter);
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
          lojaFilter: parsed.lojaFilter ?? "todos",
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
      } catch {
        window.sessionStorage.removeItem(LIST_STATE_STORAGE_KEY);
      }
    }

    setHasRestoredState(true);
  }, [hasRestoredState]);

  useEffect(() => {
    if (hasRestoredCache || typeof window === "undefined") {
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
      } catch {
        window.sessionStorage.removeItem(LIST_CACHE_STORAGE_KEY);
      }
    }

    setHasRestoredCache(true);
  }, [hasRestoredCache]);

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
      lojaFilter,
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
    lojaFilter,
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
  }, [hasRestoredState]);

  useEffect(() => {
    if (anoFilter === "todos" && mesFilter !== "todos") {
      setMesFilter("todos");
    }
  }, [anoFilter, mesFilter]);

  useEffect(() => {
    setPage(1);
  }, [
    tipoFilter,
    tipoLaudoFilter,
    lojaFilter,
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

    if (!user) {
      router.replace("/login");
      return;
    }

    if (!user) {
      router.replace("/login");
      return;
    }

    if (!canViewAllDocuments && role !== "gerente_loja" && prestadoresUsuarioLoading) {
      return;
    }

    let active = true;

    const load = async () => {
      if (!hasLoadedOnce) {
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
            prestadoresDoUsuario.forEach((prestador) => {
              params.append("prestadorId", prestador.id);
            });
          } else {
            params.set("userId", user.id);
          }
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
          if (!hasLoadedOnce) {
            setLoading(false);
          }
          setIsFetching(false);
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
    user,
    router,
    canViewAllDocuments,
    role,
    getAccessToken,
    prestadoresUsuarioLoading,
    prestadoresDoUsuario,
    page,
    pageSize,
    tipoFilter,
    tipoLaudoFilter,
    lojaFilter,
    statusFilter,
    anoFilter,
    mesFilter,
    identificacaoDebounced,
    somenteAssinados,
    somenteDisponiveisLote,
  ]);

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

  const abrirDocumento = async (registro: FormularioRecord) => {
    const path = getPathParaVisualizacao(registro);
    if (!path) {
      setError("Arquivo indisponível no momento.");
      return;
    }

    try {
      const signedUrl = await getSignedFileUrl(path);
      const opened = window.open(signedUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        setError("Não foi possível abrir o documento. Verifique o bloqueador de pop-up.");
      }
    } catch (err) {
      console.error("Erro ao abrir documento:", err);
      setError("Não foi possível abrir o documento. Tente novamente.");
    }
  };

  const baixarDocumento = async (registro: FormularioRecord) => {
    const path = getPathParaDownload(registro);
    if (!path) {
      setError("Arquivo indisponível no momento.");
      return;
    }

    try {
      const signedUrl = await getSignedFileUrl(path);
      const link = document.createElement("a");
      link.href = signedUrl;
      link.download = path.split("/").pop() ?? "documento.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Erro ao baixar documento:", err);
      setError("Não foi possível gerar o link de download.");
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

  const anosDisponiveis = useMemo(
    () =>
      Array.from(
        new Set(
          registros.map((r) => new Date(r.created_at).getFullYear().toString()),
        ),
      ).sort((a, b) => Number(b) - Number(a)),
    [registros],
  );

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

  const registrosRecentes = useMemo(() => registros.slice(0, 3), [registros]);

  const resumoStatus = useMemo(() => {
    const total = registrosFiltrados.length;
    const assinados = registrosFiltrados.filter(
      (registro) => registro.status === "assinado",
    ).length;
    const pendentes = total - assinados;
    const assinaveis = registrosFiltrados.filter(
      (registro) => registro.tipo === TIPO_ASSINAVEL,
    ).length;
    return { total, pendentes, assinados, assinaveis };
  }, [registrosFiltrados]);

  const contagemPorTipo = useMemo(
    () =>
      registros.reduce<Record<string, number>>((acc, registro) => {
        acc[registro.tipo] = (acc[registro.tipo] ?? 0) + 1;
        return acc;
      }, {}),
    [registros],
  );

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

  const resetFilters = () => {
    setTipoFilter("todos");
    setTipoLaudoFilter("todos");
    setLojaFilter("todos");
    setStatusFilter("todos");
    setIdentificacaoFilter("");
    setAnoFilter("todos");
    setMesFilter("todos");
    setSomenteAssinados(false);
    setSomenteDisponiveisLote(false);
  };

  const tipoOptions = useMemo(
    () => {
      const extras = Array.from(
        new Set(
          registros
            .map((registro) => registro.tipo)
            .filter((tipo) => !(tipo in tipoLabel)),
        ),
      );

      return [
        { value: "todos", label: "Todos os tipos" },
        ...Object.entries(tipoLabel).map(([value, label]) => ({
          value,
          label,
        })),
        ...extras.map((tipo) => ({
          value: tipo,
          label: humanizeTexto(tipo),
        })),
      ];
    },
    [registros],
  );

  const statusOptions = useMemo(() => {
    const base = ["todos", "pendente", "em_analise", "assinado"];
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
  }, [registros]);

  const tipoLaudoOptions = useMemo(() => {
    const valores = Array.from(
      new Set(
        registros
          .map((registro) => getCampoTexto(registro.dados, ["tipo_laudo"]))
          .filter((valor): valor is string => Boolean(valor)),
      ),
    );
    return ["todos", ...valores];
  }, [registros]);

  const lojaOptions = useMemo(
    () => [
      { value: "todos", label: "Todas as lojas" },
      ...lojas.map((loja) => ({
        value: loja.id,
        label: loja.codigo ? `${loja.nome} - ${loja.codigo}` : loja.nome,
      })),
    ],
    [lojas],
  );

  const showErrorMessage = error ?? authError ?? accessError;
  const hasSelection = selectedIds.length > 0;
  const assinaturasSelecionadasCount = selectedIds.filter((id) =>
    assinaturasPendentes.includes(id),
  ).length;
  const totalResultados = totalCount;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const canPrevPage = page > 1;
  const canNextPage = page < totalPages;
  const mesSelecionadoLabel =
    mesFilter === "todos"
      ? "Todos os meses"
      : MESES.find((mes) => mes.value === mesFilter)?.label ?? "Atual";
  const anoSelecionadoLabel =
    anoFilter === "todos" ? "Todos os anos" : anoFilter;

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
    <div className="flex flex-1 flex-col gap-6 py-4">
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

      <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Filter className="h-4 w-4 text-slate-400" />
            Painel de filtros
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Limpar filtros
            </button>
            <div className="inline-flex overflow-hidden rounded-full border border-slate-200 bg-slate-50 text-slate-600">
              <button
                type="button"
                onClick={() => setViewMode("tabela")}
                className={`flex items-center gap-1 px-3 py-1 text-xs font-semibold transition ${
                  viewMode === "tabela"
                    ? "bg-white text-slate-900"
                    : "text-slate-500"
                }`}
                aria-pressed={viewMode === "tabela"}
              >
                <TableIcon className="h-4 w-4" />
                Tabela
              </button>
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                className={`flex items-center gap-1 border-l border-slate-200 px-3 py-1 text-xs font-semibold transition ${
                  viewMode === "cards"
                    ? "bg-white text-slate-900"
                    : "text-slate-500"
                }`}
                aria-pressed={viewMode === "cards"}
              >
                <LayoutGrid className="h-4 w-4" />
                Cartões
              </button>
            </div>
          </div>
        </div>

                <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="text-xs font-semibold text-slate-600">
            Identificação (Empresa/Prestador/Número do pedido)
            <input
              type="text"
              value={identificacaoFilter}
              onChange={(event) => setIdentificacaoFilter(event.target.value)}
              placeholder="Busque pela empresa, prestador ou número do pedido"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Tipo de formulário
            <select
              value={tipoFilter}
              onChange={(event) => setTipoFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            >
              {tipoOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Tipo de laudo
            <select
              value={tipoLaudoFilter}
              onChange={(event) => setTipoLaudoFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            >
              {tipoLaudoOptions.map((tipoLaudo) => (
                <option key={tipoLaudo} value={tipoLaudo}>
                  {tipoLaudo === "todos" ? "Todos os tipos" : tipoLaudo}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            >
              {statusOptions.map((statusOption) => (
                <option key={statusOption} value={statusOption}>
                  {statusOption === "todos"
                    ? "Todos os status"
                    : formatStatusLabel(statusOption)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {canManageDocuments && (
            <label className="text-xs font-semibold text-slate-600">
              Loja
              <select
                value={lojaFilter}
                onChange={(event) => setLojaFilter(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
              >
                {lojaOptions.map((loja) => (
                  <option key={loja.value} value={loja.value}>
                    {loja.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs font-semibold text-slate-600">
            Ano de envio
            <select
              value={anoFilter}
              onChange={(event) => setAnoFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            >
              <option value="todos">Todos os anos</option>
              {anosDisponiveis.map((ano) => (
                <option key={ano} value={ano}>
                  {ano}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Mês de envio
            <select
              value={mesFilter}
              onChange={(event) => setMesFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            >
              <option value="todos">Todos os meses</option>
              {MESES.map((mes) => (
                <option key={mes.value} value={mes.value}>
                  {mes.label}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-xl bg-slate-50 p-3 text-[11px] text-slate-500">
            Os filtros acima são aplicados automaticamente. Período selecionado:{" "}
            {anoSelecionadoLabel}, {mesSelecionadoLabel}.
          </div>
        </div>
<div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              checked={somenteAssinados}
              onChange={(event) => setSomenteAssinados(event.target.checked)}
            />
            Mostrar apenas assinados
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              checked={somenteDisponiveisLote}
              onChange={(event) =>
                setSomenteDisponiveisLote(event.target.checked)
              }
            />
            Apenas disponíveis para assinatura em lote
          </label>
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            Combine os filtros para chegar ao subconjunto desejado.
          </div>
        </div>
      </div>

      {canManageDocuments && (
        <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Assinaturas disponíveis
              </p>
              <p className="text-sm text-slate-600">
                {assinaturasPendentes.length > 0 ? (
                  <>
                    {assinaturasPendentes.length} documento(s) pendentes do tipo
                    Registro e Laudos podem ser assinados.
                  </>
                ) : (
                  <>Nenhum documento pendente para assinatura em lote.</>
                )}
              </p>
              {hasSelection && (
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                  {selectedIds.slice(0, 4).map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 font-mono text-[10px] text-slate-600"
                    >
                      {id.slice(0, 8)}...
                      <button
                        type="button"
                        onClick={() => toggleSelecionar(id)}
                        className="text-[10px] font-semibold text-slate-500 transition hover:text-slate-800"
                        title="Remover da seleção"
                      >
                        x
                      </button>
                    </span>
                  ))}
                  {selectedIds.length > 4 && (
                    <span className="text-[11px] text-slate-500">
                      +{selectedIds.length - 4} outros
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <button
                type="button"
                onClick={selecionarTodos}
                disabled={registrosFiltrados.length === 0}
                className="rounded-full border border-slate-200 px-4 py-1.5 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {registrosFiltrados.length === 0
                  ? "Nenhum registro"
                  : "Selecionar todos"}
              </button>
              <button
                type="button"
                onClick={limparSelecao}
                disabled={!hasSelection}
                className="rounded-full border border-slate-200 px-4 py-1.5 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Limpar seleção
              </button>
              <button
                type="button"
                onClick={removerSelecionados}
                disabled={!hasSelection || deletingBatch}
                className="rounded-full border border-red-200 px-4 py-1.5 text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingBatch ? "Removendo..." : "Remover selecionados"}
              </button>
              <button
                type="button"
                onClick={iniciarAssinaturaEmLote}
                disabled={assinaturasSelecionadasCount === 0 || startingBatch}
                className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm shadow-emerald-200 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {startingBatch
                  ? "Abrindo..."
                  : assinaturasSelecionadasCount > 1
                    ? "Assinar em lote"
                    : "Assinar selecionados"}
              </button>
            </div>
          </div>
        </div>
      )}

      {totalResultados > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-3 text-xs text-slate-500 shadow-sm shadow-slate-200">
          <span>
            {totalResultados} resultado(s) · Página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
              disabled={!canPrevPage}
              className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
              disabled={!canNextPage}
              className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {totalResultados === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm shadow-slate-200">
          <p className="text-base font-semibold text-slate-700">
            Nenhum documento encontrado
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Ajuste ou limpe os filtros para visualizar todos os registros.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-full border border-slate-300 px-4 py-1.5 text-xs text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              Limpar filtros
            </button>
          </div>
        </div>
      ) : viewMode === "tabela" ? (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm shadow-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  {canManageDocuments && (
                    <th className="px-4 py-3 text-left">
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
                  <th className="px-4 py-3 text-left">Documento</th>
                  <th className="px-4 py-3 text-left">Identificação</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="hidden px-4 py-3 text-left lg:table-cell">
                    Tipo de laudo
                  </th>
                  <th className="hidden px-4 py-3 text-left xl:table-cell">
                    Observações
                  </th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="hidden px-4 py-3 text-left md:table-cell">
                    Enviado em
                  </th>
                  <th className="px-4 py-3 text-right">Ações</th>
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
                  const isSelecionavel =
                    registro.tipo === TIPO_ASSINAVEL &&
                    registro.status !== "assinado";
                  const isMarcado = selectedIds.includes(registro.id);

                  return (
                    <tr key={registro.id} className="align-top">
                      {canManageDocuments && (
                        <td className="px-4 py-3">
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
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {formatStatusLabel(registro.status)}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">
                        {formatDateTime(registro.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-end gap-2 text-[11px]">
                          <button
                            type="button"
                            onClick={() => void abrirDocumento(registro)}
                            className="min-w-[88px] rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            Abrir
                          </button>
                          <button
                            type="button"
                            onClick={() => void baixarDocumento(registro)}
                            className="min-w-[88px] rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            Baixar
                          </button>
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
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
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
            const isSelecionavel =
              registro.tipo === TIPO_ASSINAVEL &&
              registro.status !== "assinado";
            const isMarcado = selectedIds.includes(registro.id);

            return (
              <div
                key={registro.id}
                className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200"
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
                    <label className="flex items-center gap-2 text-xs text-slate-500">
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
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {formatStatusLabel(registro.status)}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {formatDateTime(registro.created_at)}
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => void abrirDocumento(registro)}
                    className="min-w-[88px] rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    Abrir
                  </button>
                  <button
                    type="button"
                    onClick={() => void baixarDocumento(registro)}
                    className="min-w-[88px] rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    Baixar
                  </button>
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
      )}
    </div>
  );
}
























































