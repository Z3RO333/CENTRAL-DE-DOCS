"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BriefcaseBusiness,
  FileBadge,
  Files,
  Filter,
  LayoutGrid,
  ReceiptText,
  Table as TableIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { usePrestadores } from "@/hooks/usePrestadores";

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

const tipoLabel: Record<string, string> = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
};

type FilterCardConfig = {
  value: keyof typeof tipoLabel;
  label: string;
  description: string;
  icon: LucideIcon;
  accent: string;
};

const FORM_FILTER_CARDS: FilterCardConfig[] = [
  {
    value: "retencao_trabalhista",
    label: tipoLabel.retencao_trabalhista,
    description: "Documentos ligados a retenção de tributos trabalhistas.",
    icon: BriefcaseBusiness,
    accent: "from-sky-100 via-sky-50 to-transparent",
  },
  {
    value: "registro_laudos",
    label: tipoLabel.registro_laudos,
    description: "Registros técnicos e laudos enviados para validação.",
    icon: FileBadge,
    accent: "from-emerald-100 via-emerald-50 to-transparent",
  },
  {
    value: "notas_fiscais",
    label: tipoLabel.notas_fiscais,
    description: "Notas emitidas e anexadas via formulários.",
    icon: ReceiptText,
    accent: "from-amber-100 via-amber-50 to-transparent",
  },
];

const TIPO_ASSINAVEL = "registro_laudos";
const STORAGE_BUCKET = "formularios";
const SIGNED_URL_EXPIRES_IN = 60 * 30;
const LIST_STATE_STORAGE_KEY = "documentos:list-state";
const LIST_CACHE_STORAGE_KEY = "documentos:list-cache";

type DocumentosListState = {
  tipoFilter: string;
  statusFilter: string;
  identificacaoFilter: string;
  anoFilter: string;
  mesFilter: string;
  somenteAssinados: boolean;
  somenteDisponiveisLote: boolean;
  viewMode: "tabela" | "cards";
  scrollY: number;
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
  { value: "03", label: "Marco" },
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

const mesAtual = String(new Date().getMonth() + 1).padStart(2, "0");
const anoAtual = new Date().getFullYear().toString();

export default function DocumentosPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const {
    modules: modulesAccess,
    loading: accessLoading,
    error: accessError,
  } = useDocumentsAccess();
  const canAccessDocumentos = modulesAccess.documentos;
  const canViewAllDocuments = modulesAccess.dashboards;
  const {
    prestadores: prestadoresDoUsuario,
    loading: prestadoresUsuarioLoading,
  } = usePrestadores({
    assignedOnly: true,
    enabled: canAccessDocumentos && !canViewAllDocuments,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registros, setRegistros] = useState<FormularioRecord[]>([]);
  const [tipoFilter, setTipoFilter] = useState<string>("todos");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [identificacaoFilter, setIdentificacaoFilter] = useState<string>("");
  const [anoFilter, setAnoFilter] = useState<string>(anoAtual);
  const [mesFilter, setMesFilter] = useState<string>(mesAtual);
  const [somenteAssinados, setSomenteAssinados] = useState(false);
  const [somenteDisponiveisLote, setSomenteDisponiveisLote] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [startingBatch, setStartingBatch] = useState(false);
  const [viewMode, setViewMode] = useState<"tabela" | "cards">("tabela");
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
        if (typeof parsed.scrollY === "number") {
          window.requestAnimationFrame(() => {
            window.scrollTo(0, parsed.scrollY ?? 0);
          });
        }
        listStateRef.current = {
          tipoFilter: parsed.tipoFilter ?? "todos",
          statusFilter: parsed.statusFilter ?? "todos",
          identificacaoFilter: parsed.identificacaoFilter ?? "",
          anoFilter: parsed.anoFilter ?? anoAtual,
          mesFilter: parsed.mesFilter ?? mesAtual,
          somenteAssinados: parsed.somenteAssinados ?? false,
          somenteDisponiveisLote: parsed.somenteDisponiveisLote ?? false,
          viewMode: parsed.viewMode === "cards" ? "cards" : "tabela",
          scrollY: parsed.scrollY ?? 0,
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
        };
        if (Array.isArray(parsed.registros)) {
          setRegistros(parsed.registros);
          setLoading(false);
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
      JSON.stringify({ registros }),
    );
  }, [hasRestoredCache, registros]);

  useEffect(() => {
    if (!hasRestoredState || typeof window === "undefined") {
      return;
    }

    const next: DocumentosListState = {
      tipoFilter,
      statusFilter,
      identificacaoFilter,
      anoFilter,
      mesFilter,
      somenteAssinados,
      somenteDisponiveisLote,
      viewMode,
      scrollY: listStateRef.current?.scrollY ?? window.scrollY,
    };

    listStateRef.current = next;
    window.sessionStorage.setItem(
      LIST_STATE_STORAGE_KEY,
      JSON.stringify(next),
    );
  }, [
    hasRestoredState,
    tipoFilter,
    statusFilter,
    identificacaoFilter,
    anoFilter,
    mesFilter,
    somenteAssinados,
    somenteDisponiveisLote,
    viewMode,
  ]);

  useEffect(() => {
    if (!hasRestoredState || typeof window === "undefined") {
      return;
    }

    const handleScroll = () => {
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
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [hasRestoredState]);

  useEffect(() => {
    if (authLoading || accessLoading) {
      return;
    }

    if (!user) {
      router.replace("/login");
      return;
    }

    if (!canAccessDocumentos) {
      router.replace("/dashboard");
      return;
    }

    if (!canViewAllDocuments && prestadoresUsuarioLoading) {
      return;
    }

    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const token = await getAccessToken();
        const params = new URLSearchParams();
        if (!canViewAllDocuments) {
          if (prestadoresDoUsuario.length > 0) {
            prestadoresDoUsuario.forEach((prestador) => {
              params.append("prestadorId", prestador.id);
            });
          } else {
            params.set("userId", user.id);
          }
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
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível carregar os documentos.",
          );
          setRegistros([]);
        }
      } finally {
        if (active) {
          setLoading(false);
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
    canAccessDocumentos,
    router,
    canViewAllDocuments,
    getAccessToken,
    prestadoresUsuarioLoading,
    prestadoresDoUsuario,
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
      setError("Arquivo indisponivel no momento.");
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
      setError("Arquivo indisponivel no momento.");
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
    setConfirmDialog({ type: "single", registro });
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
    if (selectedIds.length === 0) {
      return;
    }
    setConfirmDialog({ type: "batch" });
  };

  const executarRemocaoEmLote = async () => {
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

  const registrosFiltrados = useMemo(
    () =>
      registros.filter((registro) => {
        if (tipoFilter !== "todos" && registro.tipo !== tipoFilter) {
          return false;
        }

        if (statusFilter !== "todos" && registro.status !== statusFilter) {
          return false;
        }

        const dataReg = new Date(registro.created_at);
        if (anoFilter !== "todos") {
          const anoRegistro = dataReg.getFullYear().toString();
          if (anoRegistro !== anoFilter) {
            return false;
          }
        }

        if (mesFilter !== "todos") {
          const mesRegistro = String(dataReg.getMonth() + 1).padStart(2, "0");
          if (mesRegistro !== mesFilter) {
            return false;
          }
        }

        if (identificacaoFilter.trim()) {
          const query = identificacaoFilter.toLowerCase();
          const identificacaoValor = getIdentificacaoValor(registro);
          if (
            !identificacaoValor ||
            !identificacaoValor.toLowerCase().includes(query)
          ) {
            return false;
          }
        }

        if (somenteAssinados && registro.status !== "assinado") {
          return false;
        }

        if (somenteDisponiveisLote) {
          if (
            registro.tipo !== TIPO_ASSINAVEL ||
            registro.status === "assinado"
          ) {
            return false;
          }
        }

        return true;
      }),
    [
      registros,
      tipoFilter,
      statusFilter,
      anoFilter,
      mesFilter,
      identificacaoFilter,
      somenteAssinados,
      somenteDisponiveisLote,
    ],
  );

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
    const registro = registrosFiltrados.find((item) => item.id === id);
    if (!registro) {
      return;
    }
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const selecionarTodos = () => {
    const todosIds = registrosFiltrados.map((item) => item.id);
    if (todosIds.length === 0) {
      return;
    }
    const allSelected = todosIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : todosIds);
  };

  const iniciarAssinaturaEmLote = () => {
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
    setStatusFilter("todos");
    setIdentificacaoFilter("");
    setAnoFilter(anoAtual);
    setMesFilter(mesAtual);
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

  const showErrorMessage = error ?? authError ?? accessError;
  const hasSelection = selectedIds.length > 0;
  const assinaturasSelecionadasCount = selectedIds.filter((id) =>
    assinaturasPendentes.includes(id),
  ).length;
  const totalResultados = registrosFiltrados.length;

  if (authLoading || accessLoading || (loading && registros.length === 0)) {
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
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/20" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc">
            <p id="confirm-title" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Confirmar exclusão
            </p>
            <p id="confirm-desc" className="mt-2 text-sm text-slate-700">
              {confirmDialog.type === "batch"
                ? "Tem certeza que deseja remover os documentos selecionados? Esta ação não pode ser desfeita."
                : "Tem certeza que deseja remover este documento? Esta ação não pode ser desfeita."}
            </p>
            {confirmDialog.type === "single" && confirmDialog.registro && (
              <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
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
          <p>Filtros ativos atualizam automaticamente.</p>
        </div>
      </div>

      {showErrorMessage && (
        <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700 shadow-sm shadow-red-100">
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

      {registrosRecentes.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Últimos documentos enviados
              </p>
              <p className="text-[11px] text-slate-500">
                Lista rápida das últimas submissões, independente dos filtros.
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-400">
              Atualizados em tempo real
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {registrosRecentes.map((registro) => {
              const identificacaoConfig = getIdentificacaoConfig(registro.tipo);
              const identificacaoValor =
                getIdentificacaoValor(registro) ??
                `${identificacaoConfig.label} não informado`;
              return (
                <div
                  key={registro.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600 shadow-sm shadow-slate-200"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {getTipoDescricao(registro.tipo)}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-400">
                    {registro.id}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {identificacaoValor}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {formatDateTime(registro.created_at)}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-[11px]">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 font-semibold ${
                        registro.status === "assinado"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {formatStatusLabel(registro.status)}
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void abrirDocumento(registro)}
                        className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-white"
                      >
                        Abrir
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(`/documentos/${registro.id}`)}
                        className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-white"
                      >
                        Detalhes
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Filtros rápidos por formulário
            </p>
            <p className="text-[11px] text-slate-500">
              Clique em um card para aplicar o filtro desejado.
            </p>
          </div>
          {tipoFilter !== "todos" && (
            <button
              type="button"
              onClick={() => setTipoFilter("todos")}
              className="text-[11px] font-semibold text-sky-600 underline underline-offset-2"
            >
              Limpar filtro
            </button>
          )}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {FORM_FILTER_CARDS.map((card) => {
            const Icon = card.icon;
            const isActive = tipoFilter === card.value;
            const totalTipo = contagemPorTipo[card.value] ?? 0;
            return (
              <button
                key={card.value}
                type="button"
                onClick={() =>
                  setTipoFilter((prev) =>
                    prev === card.value ? "todos" : card.value,
                  )
                }
                aria-pressed={isActive}
                className={`group relative overflow-hidden rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                  isActive
                    ? "border-sky-400 bg-sky-50/70"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div
                  className={`pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${card.accent} opacity-80 blur-2xl`}
                />
                <div className="relative flex h-full flex-col gap-2">
                  <div className="flex items-center gap-2 text-slate-800">
                    <Icon className="h-5 w-5 text-slate-700" />
                    <p className="text-sm font-semibold">{card.label}</p>
                  </div>
                  <p className="flex-1 text-xs text-slate-500">
                    {card.description}
                  </p>
                  <span className="text-[11px] font-semibold text-slate-500">
                    {totalTipo} documento(s)
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200">
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

        <div className="mt-4 grid gap-3 md:grid-cols-3">
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
            Tipo de formulario
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

        <div className="mt-4 grid gap-3 md:grid-cols-3">
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
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500">
            Os filtros acima são aplicados automaticamente. Por padrão
            consideramos o mês corrente ({MESES.find((mes) => mes.value === mesFilter)?.label ?? "Atual"}).
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
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
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            Combine os filtros para chegar ao subconjunto desejado.
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200">
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

      {totalResultados === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm shadow-slate-200">
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
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
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
                  const identificacaoValor =
                    getIdentificacaoValor(registro) ??
                    `${identificacaoConfig.label} não informado`;
                  const identificacaoComplemento =
                    getIdentificacaoComplemento(registro);
                  const tipoLaudo = getTipoLaudo(registro);
                  const observacoes = getObservacoes(registro);
                  const isSelecionavel =
                    registro.tipo === TIPO_ASSINAVEL &&
                    registro.status !== "assinado";
                  const isMarcado = selectedIds.includes(registro.id);

                  return (
                    <tr key={registro.id} className="align-top">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isMarcado}
                          onChange={() => toggleSelecionar(registro.id)}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:cursor-not-allowed"
                          aria-label="Selecionar documento para assinatura"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p
                          className="text-sm font-semibold text-slate-900"
                          title={nomeDocumento}
                        >
                          {nomeDocumento}
                        </p>
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
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {getTipoDescricao(registro.tipo)}
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-slate-500 lg:table-cell">
                        {registro.tipo === TIPO_ASSINAVEL && tipoLaudo
                          ? tipoLaudo
                          : "-"}
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-slate-500 xl:table-cell">
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
                        <div className="flex flex-wrap justify-end gap-2 text-[11px]">
                          <button
                            type="button"
                            onClick={() => void abrirDocumento(registro)}
                            className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            Abrir
                          </button>
                          <button
                            type="button"
                            onClick={() => void baixarDocumento(registro)}
                            className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            Baixar
                          </button>
                          <button
                            type="button"
                            onClick={() => void removerDocumento(registro)}
                            disabled={deletingId === registro.id}
                            className="rounded-full border border-red-200 px-3 py-1 text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deletingId === registro.id ? "Removendo..." : "Remover"}
                          </button>
                          {isSelecionavel && (
                            <button
                              type="button"
                              onClick={() => router.push(`/documentos/${registro.id}`)}
                              className="rounded-full bg-sky-500 px-3 py-1 text-white transition hover:bg-sky-400"
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
            const identificacaoValor =
              getIdentificacaoValor(registro) ??
              `${identificacaoConfig.label} não informado`;
            const identificacaoComplemento =
              getIdentificacaoComplemento(registro);
            const tipoLaudo = getTipoLaudo(registro);
            const observacoes = getObservacoes(registro);
            const isSelecionavel =
              registro.tipo === TIPO_ASSINAVEL &&
              registro.status !== "assinado";
            const isMarcado = selectedIds.includes(registro.id);

            return (
              <div
                key={registro.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200"
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
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={isMarcado}
                      onChange={() => toggleSelecionar(registro.id)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:cursor-not-allowed"
                    />
                    Selecionar
                  </label>
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
                    className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    Abrir
                  </button>
                  <button
                    type="button"
                    onClick={() => void baixarDocumento(registro)}
                    className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    Baixar
                  </button>
                  <button
                    type="button"
                    onClick={() => void removerDocumento(registro)}
                    disabled={deletingId === registro.id}
                    className="rounded-full border border-red-200 px-3 py-1 text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingId === registro.id ? "Removendo..." : "Remover"}
                  </button>
                  {isSelecionavel && (
                    <button
                      type="button"
                      onClick={() => router.push(`/documentos/${registro.id}`)}
                      className="rounded-full bg-sky-500 px-3 py-1 text-white transition hover:bg-sky-400"
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




























