"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Folder } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { useLojas } from "@/hooks/useLojas";
import { usePrestadores } from "@/hooks/usePrestadores";
import { supabase } from "@/lib/supabaseClient";
import { fixMojibakeText } from "@/lib/textEncoding";

type LojaPasta = {
  lojaId: string;
  lojaNome: string;
  lojaCodigo: string | null;
  totalDocumentos: number;
  ultimoEnvioAt: string | null;
};

type DocumentoItem = {
  id: string;
  tipo: string;
  status: string;
  arquivo_path: string;
  arquivo_assinado_path?: string | null;
  created_at: string;
  dados: Record<string, unknown> | null;
  user_id: string;
  prestador_id?: string | null;
};

type SubpastaNode = {
  key: string;
  nome: string;
  tipo: string;
  tipoLaudo: string | null;
  tipoLaudoValores: string[];
  ano: string | null;
  mes: string | null;
  totalDocumentos: number;
  ultimoEnvioAt: string | null;
  children: SubpastaNode[];
};

const PAGE_SIZE = 20;
const STORAGE_BUCKET = "formularios";
const SIGNED_URL_EXPIRES_IN = 60 * 30;
const CURRENT_YEAR = new Date().getFullYear().toString();
const PAGE_STATE_STORAGE_KEY = "documentos-por-loja:state";
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
] as const;

const tipoLabel: Record<string, string> = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
  contratos: "Contratos",
  orcamentos: "Orçamentos",
};

const statusLabel: Record<string, string> = {
  pendente: "Pendente",
  em_analise: "Em análise",
  revisado: "Revisado",
  assinado: "Assinado",
};

const formatDateTime = (value: string | null) => {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString("pt-BR");
};

const formatLastSend = (value: string | null) => {
  if (!value) {
    return { label: "Sem data", tone: "text-slate-400" };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { label: "Sem data", tone: "text-slate-400" };
  }

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return { label: "Ultimo envio hoje", tone: "text-emerald-600" };
  }
  if (diffDays === 1) {
    return { label: "Ultimo envio ontem", tone: "text-emerald-600" };
  }
  if (diffDays <= 7) {
    return { label: `Ultimo envio ha ${diffDays} dias`, tone: "text-sky-600" };
  }
  return { label: `Ultimo envio em ${date.toLocaleDateString("pt-BR")}`, tone: "text-slate-500" };
};

const resolveSignedPdfPath = (path?: string | null) => {
  if (!path) {
    return null;
  }
  return path.endsWith(".pdf.p7s") ? path.slice(0, -4) : path;
};

const getDocumentoNome = (doc: DocumentoItem) => {
  const anexos = doc.dados?.anexos;
  if (Array.isArray(anexos) && anexos.length > 0) {
    const primeiro = anexos[0] as { nome?: unknown } | null;
    if (primeiro?.nome && typeof primeiro.nome === "string") {
      return fixMojibakeText(primeiro.nome);
    }
  }
  const path = doc.arquivo_assinado_path ?? doc.arquivo_path;
  return path ? fixMojibakeText(path.split("/").pop() ?? path) : doc.id;
};

export default function DocumentosPorLojaPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const {
    modules,
    role,
    isAdmin,
    loading: accessLoading,
  } = useDocumentsAccess();
  const canAccessDocumentos = modules.documentos;
  const {
    prestadores,
    loading: prestadoresLoading,
  } = usePrestadores({
    enabled: Boolean(userId),
    assignedOnly: !isAdmin,
  });
  const { lojas: lojasCadastradas, loading: lojasCadastradasLoading } = useLojas({
    enabled: Boolean(userId) && isAdmin,
  });

  const [lojas, setLojas] = useState<LojaPasta[]>([]);
  const [lojasLoading, setLojasLoading] = useState(true);
  const [selectedLojaId, setSelectedLojaId] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocumentoItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [lojaSearch, setLojaSearch] = useState("");
  const [selectedPrestadorId, setSelectedPrestadorId] = useState("");
  const [selectedMes, setSelectedMes] = useState("");
  const [subpastas, setSubpastas] = useState<SubpastaNode[]>([]);
  const [subpastasLoading, setSubpastasLoading] = useState(false);
  const [selectedSubpastaKey, setSelectedSubpastaKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingLojaId, setEditingLojaId] = useState("");
  const [editingPrestadorId, setEditingPrestadorId] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hasRestoredState, setHasRestoredState] = useState(false);

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
    if (typeof window === "undefined" || hasRestoredState) {
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(PAGE_STATE_STORAGE_KEY);
      if (!raw) {
        setHasRestoredState(true);
        return;
      }
      const parsed = JSON.parse(raw) as {
        selectedLojaId?: string;
        lojaSearch?: string;
        selectedPrestadorId?: string;
        selectedMes?: string;
        selectedSubpastaKey?: string;
        page?: number;
      };
      if (typeof parsed.selectedLojaId === "string") {
        setSelectedLojaId(parsed.selectedLojaId);
      }
      if (typeof parsed.lojaSearch === "string") {
        setLojaSearch(parsed.lojaSearch);
      }
      if (typeof parsed.selectedPrestadorId === "string") {
        setSelectedPrestadorId(parsed.selectedPrestadorId);
      }
      if (typeof parsed.selectedMes === "string") {
        setSelectedMes(parsed.selectedMes);
      }
      if (typeof parsed.selectedSubpastaKey === "string") {
        setSelectedSubpastaKey(parsed.selectedSubpastaKey);
      }
      if (typeof parsed.page === "number" && Number.isFinite(parsed.page)) {
        setPage(Math.max(1, parsed.page));
      }
    } catch (err) {
      console.error("Erro ao restaurar estado de documentos por loja:", err);
    } finally {
      setHasRestoredState(true);
    }
  }, [hasRestoredState]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasRestoredState) {
      return;
    }
    const snapshot = {
      selectedLojaId,
      lojaSearch,
      selectedPrestadorId,
      selectedMes,
      selectedSubpastaKey,
      page,
    };
    window.sessionStorage.setItem(PAGE_STATE_STORAGE_KEY, JSON.stringify(snapshot));
  }, [
    hasRestoredState,
    selectedLojaId,
    lojaSearch,
    selectedPrestadorId,
    selectedMes,
    selectedSubpastaKey,
    page,
  ]);

  useEffect(() => {
    if (authLoading || accessLoading) {
      return;
    }

    if (!userId) {
      router.replace("/login");
      return;
    }

    if (!canAccessDocumentos) {
      router.replace("/dashboard");
    }
  }, [authLoading, accessLoading, userId, canAccessDocumentos, router]);

  useEffect(() => {
    if (!userId || authLoading || accessLoading || !canAccessDocumentos) {
      setLojasLoading(false);
      return;
    }

    let active = true;
    const loadLojas = async () => {
      setLojasLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const params = new URLSearchParams();
        const userFilter = !isAdmin && role === "colaborador" ? userId : "";
        if (userFilter) {
          params.set("userId", userFilter);
        }
        if (isAdmin && selectedPrestadorId) {
          params.set("prestadorId", selectedPrestadorId);
        }
        if (selectedMes) {
          params.set("ano", CURRENT_YEAR);
          params.set("mes", selectedMes);
        }
        const url =
          params.size > 0
            ? `/api/documentos/lojas?${params.toString()}`
            : "/api/documentos/lojas";
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const payload = (await response.json()) as {
          lojas?: LojaPasta[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Falha ao carregar pastas.");
        }
        if (!active) {
          return;
        }
        const next = payload.lojas ?? [];
        setLojas(next);
        setSelectedLojaId((prev) => {
          if (prev && next.some((item) => item.lojaId === prev)) {
            return prev;
          }
          return next[0]?.lojaId ?? null;
        });
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Falha ao carregar pastas.");
          setLojas([]);
          setSelectedLojaId(null);
        }
      } finally {
        if (active) {
          setLojasLoading(false);
        }
      }
    };

    void loadLojas();
    return () => {
      active = false;
    };
  }, [
    userId,
    authLoading,
    accessLoading,
    canAccessDocumentos,
    role,
    isAdmin,
    selectedPrestadorId,
    selectedMes,
    refreshKey,
    getAccessToken,
  ]);

  useEffect(() => {
    setPage(1);
  }, [selectedLojaId, selectedPrestadorId, selectedMes, selectedSubpastaKey]);

  useEffect(() => {
    if (!userId || !selectedLojaId) {
      setSubpastas([]);
      setSelectedSubpastaKey(null);
      setSubpastasLoading(false);
      return;
    }
    if (authLoading || accessLoading || !canAccessDocumentos) {
      setSubpastasLoading(false);
      return;
    }

    let active = true;
    const loadSubpastas = async () => {
      setSubpastasLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const params = new URLSearchParams();
        params.set("lojaId", selectedLojaId);
        const userFilter = !isAdmin && role === "colaborador" ? userId : "";
        if (userFilter) {
          params.set("userId", userFilter);
        }
        if (isAdmin && selectedPrestadorId) {
          params.set("prestadorId", selectedPrestadorId);
        }
        if (selectedMes) {
          params.set("ano", CURRENT_YEAR);
          params.set("mes", selectedMes);
        }

        const response = await fetch(`/api/documentos/subpastas?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const payload = (await response.json()) as {
          subpastas?: SubpastaNode[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Falha ao carregar subpastas.");
        }
        if (!active) {
          return;
        }
        const next = payload.subpastas ?? [];
        setSubpastas(next);
        setSelectedSubpastaKey((prev) => {
          if (
            prev &&
            next.some(
              (item) =>
                item.key === prev || item.children.some((child) => child.key === prev),
            )
          ) {
            return prev;
          }
          const first = next[0];
          if (!first) {
            return null;
          }
          if (first.children.length > 0) {
            return first.children[0].key;
          }
          return first.key;
        });
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Falha ao carregar subpastas.");
          setSubpastas([]);
          setSelectedSubpastaKey(null);
        }
      } finally {
        if (active) {
          setSubpastasLoading(false);
        }
      }
    };

    void loadSubpastas();
    return () => {
      active = false;
    };
  }, [
    userId,
    selectedLojaId,
    authLoading,
    accessLoading,
    canAccessDocumentos,
    isAdmin,
    role,
    selectedPrestadorId,
    selectedMes,
    refreshKey,
    getAccessToken,
  ]);

  const subpastaMap = useMemo(() => {
    const map = new Map<string, SubpastaNode>();
    subpastas.forEach((item) => {
      map.set(item.key, item);
      item.children.forEach((child) => map.set(child.key, child));
    });
    return map;
  }, [subpastas]);

  const selectedSubpasta = useMemo(
    () => (selectedSubpastaKey ? subpastaMap.get(selectedSubpastaKey) ?? null : null),
    [selectedSubpastaKey, subpastaMap],
  );

  const selectedLoja = useMemo(
    () => lojas.find((loja) => loja.lojaId === selectedLojaId) ?? null,
    [lojas, selectedLojaId],
  );

  useEffect(() => {
    if (!userId || !selectedLojaId || !selectedSubpasta) {
      setDocs([]);
      setTotal(0);
      setDocsLoading(false);
      return;
    }
    if (authLoading || accessLoading || !canAccessDocumentos) {
      setDocsLoading(false);
      return;
    }

    let active = true;
    const loadDocs = async () => {
      setDocsLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const params = new URLSearchParams();
        params.set("lojaId", selectedLojaId);
        params.set("limit", PAGE_SIZE.toString());
        params.set("offset", ((page - 1) * PAGE_SIZE).toString());
        const userFilter = !isAdmin && role === "colaborador" ? userId : "";
        if (userFilter) {
          params.set("userId", userFilter);
        }
        if (isAdmin && selectedPrestadorId) {
          params.set("prestadorId", selectedPrestadorId);
        }
        if (selectedMes) {
          params.set("ano", CURRENT_YEAR);
          params.set("mes", selectedMes);
        }
        params.set("tipo", selectedSubpasta.tipo);
        if (selectedSubpasta.ano) {
          params.set("ano", selectedSubpasta.ano);
        }
        if (selectedSubpasta.mes) {
          params.set("mes", selectedSubpasta.mes);
        }

        const response = await fetch(`/api/documentos?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const payload = (await response.json()) as {
          registros?: DocumentoItem[];
          total?: number;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Falha ao carregar documentos.");
        }
        if (!active) {
          return;
        }
        setDocs(payload.registros ?? []);
        setTotal(payload.total ?? 0);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Falha ao carregar documentos.",
          );
          setDocs([]);
          setTotal(0);
        }
      } finally {
        if (active) {
          setDocsLoading(false);
        }
      }
    };

    void loadDocs();
    return () => {
      active = false;
    };
  }, [
    userId,
    selectedLojaId,
    page,
    authLoading,
    accessLoading,
    canAccessDocumentos,
    isAdmin,
    role,
    selectedPrestadorId,
    selectedMes,
    selectedSubpasta,
    refreshKey,
    getAccessToken,
  ]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total],
  );

  const filteredLojas = useMemo(() => {
    const term = lojaSearch.trim().toLowerCase();
    if (!term) {
      return lojas;
    }
    return lojas.filter((loja) => {
      const nome = loja.lojaNome.toLowerCase();
      const codigo = loja.lojaCodigo?.toLowerCase() ?? "";
      return nome.includes(term) || codigo.includes(term);
    });
  }, [lojas, lojaSearch]);

  const prestadorLabelById = useMemo(() => {
    const map = new Map<string, string>();
    prestadores.forEach((item) => {
      map.set(item.id, item.nome);
    });
    return map;
  }, [prestadores]);

  useEffect(() => {
    if (!selectedLojaId) {
      return;
    }
    const exists = filteredLojas.some((loja) => loja.lojaId === selectedLojaId);
    if (!exists) {
      setSelectedLojaId(filteredLojas[0]?.lojaId ?? null);
    }
  }, [filteredLojas, selectedLojaId]);

  const getSignedFileUrl = useCallback(
    async (path: string, expiresIn = SIGNED_URL_EXPIRES_IN) => {
      const { data, error: signedError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(path, expiresIn);

      if (signedError || !data?.signedUrl) {
        throw signedError ?? new Error("Não foi possível gerar o link do arquivo.");
      }
      return data.signedUrl;
    },
    [],
  );

  const openDocumentFile = useCallback(
    async (doc: DocumentoItem) => {
      setError(null);
      const tab = window.open("about:blank", "_blank");
      if (!tab) {
        setError("Nao foi possivel abrir nova aba. Verifique o bloqueador de pop-up.");
        return;
      }

      const path =
        resolveSignedPdfPath(doc.arquivo_assinado_path) ??
        doc.arquivo_assinado_path ??
        doc.arquivo_path;

      if (!path) {
        tab.close();
        setError("Arquivo indisponivel no momento.");
        return;
      }

      try {
        const signedUrl = await getSignedFileUrl(path);
        tab.opener = null;
        tab.location.href = signedUrl;
      } catch (err) {
        tab.close();
        console.error("Erro ao abrir arquivo assinado:", err);
        setError("Nao foi possivel abrir o documento. Tente novamente.");
      }
    },
    [getSignedFileUrl],
  );

  const startEditingDoc = useCallback((doc: DocumentoItem) => {
    const lojaFromDados =
      typeof doc.dados?.loja_id === "string" ? doc.dados.loja_id : "";
    setEditingDocId(doc.id);
    setEditingLojaId(lojaFromDados);
    setEditingPrestadorId(doc.prestador_id ?? "");
    setError(null);
    setFeedback(null);
  }, []);

  const cancelEditingDoc = useCallback(() => {
    setEditingDocId(null);
    setEditingLojaId("");
    setEditingPrestadorId("");
    setSavingEdit(false);
  }, []);

  const saveEditingDoc = useCallback(async () => {
    if (!editingDocId) {
      return;
    }
    if (!editingLojaId) {
      setError("Selecione a loja para salvar a correcao.");
      return;
    }

    setSavingEdit(true);
    setError(null);
    setFeedback(null);
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/documentos", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: editingDocId,
          lojaId: editingLojaId,
          prestadorId: editingPrestadorId || null,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao atualizar documento.");
      }

      setFeedback("Documento corrigido com sucesso.");
      setEditingDocId(null);
      setEditingLojaId("");
      setEditingPrestadorId("");
      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      console.error("Erro ao corrigir documento:", err);
      setError(err instanceof Error ? err.message : "Falha ao corrigir documento.");
    } finally {
      setSavingEdit(false);
    }
  }, [editingDocId, editingLojaId, editingPrestadorId, getAccessToken]);

  const renderSubpastasPanel = () => (
    <div className="rounded-xl border border-slate-100 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Explorador
      </p>
      <div className="mt-2 space-y-3">
        {subpastas.map((item) => {
          const lastSend = formatLastSend(item.ultimoEnvioAt);
          return (
            <div key={item.key} className="rounded-xl bg-slate-50/70 p-2">
              <button
                type="button"
                onClick={() => setSelectedSubpastaKey(item.key)}
                className={`w-full rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${
                  selectedSubpastaKey === item.key
                    ? "bg-sky-50 text-sky-700"
                    : "text-slate-700 hover:bg-white"
                }`}
              >
                <span className="block">{item.nome}</span>
                <span className="mt-1 block text-[11px] font-normal text-slate-500">
                  {item.totalDocumentos} documento(s)
                </span>
                <span className={`block text-[11px] font-normal ${lastSend.tone}`}>
                  {lastSend.label}
                </span>
              </button>
              {item.children.length > 0 && (
                <div className="mt-2 space-y-1 pl-3">
                  {item.children.map((child) => {
                    const childLastSend = formatLastSend(child.ultimoEnvioAt);
                    return (
                      <button
                        key={child.key}
                        type="button"
                        onClick={() => setSelectedSubpastaKey(child.key)}
                        className={`w-full rounded-lg px-3 py-2 text-left text-xs transition ${
                          selectedSubpastaKey === child.key
                            ? "bg-emerald-50 text-emerald-700"
                            : "text-slate-600 hover:bg-white"
                        }`}
                      >
                        <span className="font-semibold">{child.nome}</span>
                        <span className="ml-1 text-[11px] text-slate-500">
                          {child.totalDocumentos}
                        </span>
                        <span
                          className={`mt-1 block text-[11px] ${childLastSend.tone}`}
                        >
                          {childLastSend.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const hasDataRendered = lojas.length > 0 || subpastas.length > 0 || docs.length > 0;
  const showInitialLoader = (authLoading || accessLoading) && !hasDataRendered;

  if (showInitialLoader) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando pastas...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Documentos por loja
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Navegue por loja, tipo de documento e ano/mês de envio.
          </p>
        </div>
        <Link
          href="/documentos"
          className="rounded-full border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          Voltar para documentos
        </Link>
      </div>

      <div className="rounded-2xl bg-white p-3 shadow-sm shadow-slate-200">
        <label
          htmlFor="mes-filter"
          className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
        >
          Mes ({CURRENT_YEAR})
        </label>
        <div className="mt-2">
          <select
            id="mes-filter"
            value={selectedMes}
            onChange={(event) => setSelectedMes(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          >
            <option value="">Todos os meses</option>
            {MESES.map((mes) => (
              <option key={mes.value} value={mes.value}>
                {mes.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isAdmin && (
        <div className="rounded-2xl bg-white p-3 shadow-sm shadow-slate-200">
          <div>
            <label
              htmlFor="admin-prestador-filter"
              className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              Prestador
            </label>
            <div className="mt-2">
              <select
                id="admin-prestador-filter"
                value={selectedPrestadorId}
                onChange={(event) => setSelectedPrestadorId(event.target.value)}
                disabled={prestadoresLoading}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              >
                <option value="">
                  {prestadoresLoading ? "Carregando prestadores..." : "Todos os prestadores"}
                </option>
                {prestadores.map((prestador) => (
                  <option key={prestador.id} value={prestador.id}>
                    {prestador.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      )}
      {feedback && (
        <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
          {feedback}
        </div>
      )}

      <div className="grid flex-1 gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="rounded-2xl bg-white p-3 shadow-sm shadow-slate-200">
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Lojas (Pastas)
          </p>
          <div className="px-2 pb-2">
            <input
              type="search"
              value={lojaSearch}
              onChange={(event) => setLojaSearch(event.target.value)}
              placeholder="Buscar por nome ou codigo"
              className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
          </div>
          {lojasLoading && lojas.length === 0 ? (
            <p className="px-2 text-sm text-slate-500">Carregando lojas...</p>
          ) : filteredLojas.length === 0 ? (
            <p className="px-2 text-sm text-slate-500">
              Nenhuma loja encontrada.
            </p>
          ) : (
            <div className="space-y-1">
              {filteredLojas.map((loja) => {
                const selected = selectedLojaId === loja.lojaId;
                const lastSend = formatLastSend(loja.ultimoEnvioAt);
                return (
                  <button
                    key={loja.lojaId}
                    type="button"
                    onClick={() => setSelectedLojaId(loja.lojaId)}
                    className={`flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition ${
                      selected
                        ? "bg-sky-50 text-sky-700"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <Folder className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {loja.lojaCodigo
                          ? `${loja.lojaNome} - ${loja.lojaCodigo}`
                          : loja.lojaNome}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {loja.totalDocumentos} documento(s)
                      </span>
                      <span className={`block text-[11px] ${lastSend.tone}`}>
                        {lastSend.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
          {!selectedLojaId ? (
            <p className="text-sm text-slate-500">
              Selecione uma loja para listar os documentos.
            </p>
          ) : subpastasLoading && subpastas.length === 0 ? (
            <p className="text-sm text-slate-500">Carregando explorador...</p>
          ) : subpastas.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhum agrupamento encontrado nessa loja.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-700">
                  {selectedLoja
                    ? selectedLoja.lojaCodigo
                      ? `${selectedLoja.lojaNome} - ${selectedLoja.lojaCodigo}`
                      : selectedLoja.lojaNome
                    : "Loja"}
                </span>
                <span>&gt;</span>
                <span className="font-semibold text-slate-700">
                  {selectedSubpasta
                    ? tipoLabel[selectedSubpasta.tipo] ?? selectedSubpasta.tipo
                    : "Tipo"}
                </span>
                <span>&gt;</span>
                <span className="font-semibold text-slate-700">
                  {selectedSubpasta?.ano && selectedSubpasta?.mes
                    ? selectedSubpasta.nome
                    : "Todos os meses"}
                </span>
              </div>
              {renderSubpastasPanel()}
              {docsLoading && docs.length === 0 ? (
                <p className="text-sm text-slate-500">Carregando documentos...</p>
              ) : docs.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Nenhum documento encontrado nessa subpasta.
                </p>
              ) : (
                <div className="space-y-2">
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {getDocumentoNome(doc)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {tipoLabel[doc.tipo] ?? doc.tipo} · Status:{" "}
                      {statusLabel[doc.status] ?? doc.status} · Enviado em{" "}
                      {formatDateTime(doc.created_at)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Prestador:{" "}
                      {doc.prestador_id
                          ? prestadorLabelById.get(doc.prestador_id) ?? doc.prestador_id
                          : typeof doc.dados?.prestador === "string"
                            ? doc.dados.prestador
                          : "Prestador não informado"}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      ID: {doc.id}
                    </p>
                    {isAdmin && editingDocId === doc.id && (
                      <div className="mt-2 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 md:grid-cols-2">
                        <select
                          value={editingLojaId}
                          onChange={(event) => setEditingLojaId(event.target.value)}
                          disabled={savingEdit || lojasCadastradasLoading}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                        >
                          <option value="">
                            {lojasCadastradasLoading
                              ? "Carregando lojas..."
                              : "Selecione a loja"}
                          </option>
                          {lojasCadastradas.map((loja) => (
                            <option key={loja.id} value={loja.id}>
                              {loja.codigo ? `${loja.codigo} - ${loja.nome}` : loja.nome}
                            </option>
                          ))}
                        </select>
                        <select
                          value={editingPrestadorId}
                          onChange={(event) =>
                            setEditingPrestadorId(event.target.value)
                          }
                          disabled={savingEdit || prestadoresLoading}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                        >
                          <option value="">
                            {prestadoresLoading
                              ? "Carregando prestadores..."
                              : "Sem prestador"}
                          </option>
                          {prestadores.map((prestador) => (
                            <option key={prestador.id} value={prestador.id}>
                              {prestador.nome}
                            </option>
                          ))}
                        </select>
                        <div className="md:col-span-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              void saveEditingDoc();
                            }}
                            disabled={savingEdit}
                            className="rounded-full border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {savingEdit ? "Salvando..." : "Salvar correcao"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditingDoc}
                            disabled={savingEdit}
                            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {isAdmin && editingDocId !== doc.id && (
                      <button
                        type="button"
                        onClick={() => startEditingDoc(doc)}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 transition hover:border-amber-300 hover:bg-amber-50"
                      >
                        Corrigir
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        void openDocumentFile(doc);
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir arquivo
                    </button>
                  </div>
                </div>
              ))}
                </div>
              )}
            </div>
          )}

          {selectedLojaId && total > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>
                {total} resultado(s) - Página {page} de {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                  disabled={page <= 1}
                  className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setPage((prev) => Math.min(prev + 1, totalPages))
                  }
                  disabled={page >= totalPages}
                  className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
