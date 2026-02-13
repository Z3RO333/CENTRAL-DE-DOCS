"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Folder } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { usePrestadores } from "@/hooks/usePrestadores";
import { supabase } from "@/lib/supabaseClient";

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

const PAGE_SIZE = 20;
const STORAGE_BUCKET = "formularios";
const SIGNED_URL_EXPIRES_IN = 60 * 30;

const tipoLabel: Record<string, string> = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
};

const statusLabel: Record<string, string> = {
  pendente: "Pendente",
  em_analise: "Em analise",
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

export default function DocumentosPorLojaPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
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
    enabled: Boolean(user),
    assignedOnly: !isAdmin,
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

  const getAccessToken = useCallback(async () => {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }
    const token = sessionData.session?.access_token;
    if (!token) {
      throw new Error("Sessao expirada. Faca login novamente.");
    }
    return token;
  }, []);

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
    }
  }, [authLoading, accessLoading, user, canAccessDocumentos, router]);

  useEffect(() => {
    if (!user || authLoading || accessLoading || !canAccessDocumentos) {
      return;
    }

    let active = true;
    const loadLojas = async () => {
      setLojasLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const params = new URLSearchParams();
        const userFilter = !isAdmin && role === "colaborador" ? user.id : "";
        if (userFilter) {
          params.set("userId", userFilter);
        }
        if (isAdmin && selectedPrestadorId) {
          params.set("prestadorId", selectedPrestadorId);
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
        setSelectedLojaId((prev) => prev ?? next[0]?.lojaId ?? null);
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
    user,
    authLoading,
    accessLoading,
    canAccessDocumentos,
    role,
    isAdmin,
    selectedPrestadorId,
    getAccessToken,
  ]);

  useEffect(() => {
    setPage(1);
  }, [selectedLojaId]);

  useEffect(() => {
    if (!user || !selectedLojaId || authLoading || accessLoading) {
      setDocs([]);
      setTotal(0);
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
        const userFilter = !isAdmin && role === "colaborador" ? user.id : "";
        if (userFilter) {
          params.set("userId", userFilter);
        }
        if (isAdmin && selectedPrestadorId) {
          params.set("prestadorId", selectedPrestadorId);
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
    user,
    selectedLojaId,
    page,
    authLoading,
    accessLoading,
    isAdmin,
    role,
    selectedPrestadorId,
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
        throw signedError ?? new Error("Nao foi possivel gerar o link do arquivo.");
      }
      return data.signedUrl;
    },
    [],
  );

  const openDocumentFile = useCallback(
    async (doc: DocumentoItem) => {
      setError(null);
      const path =
        resolveSignedPdfPath(doc.arquivo_assinado_path) ??
        doc.arquivo_assinado_path ??
        doc.arquivo_path;

      if (!path) {
        setError("Arquivo indisponivel no momento.");
        return;
      }

      try {
        const signedUrl = await getSignedFileUrl(path);
        const opened = window.open(signedUrl, "_blank", "noopener,noreferrer");
        if (!opened) {
          setError("Nao foi possivel abrir o documento. Verifique o bloqueador de pop-up.");
        }
      } catch (err) {
        console.error("Erro ao abrir arquivo assinado:", err);
        setError("Nao foi possivel abrir o documento. Tente novamente.");
      }
    },
    [getSignedFileUrl],
  );

  if (authLoading || accessLoading) {
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
            Documentos Por Loja
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Cada pasta representa uma loja com documentos vinculados.
          </p>
        </div>
        <Link
          href="/documentos"
          className="rounded-full border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          Voltar para documentos
        </Link>
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
          {lojasLoading ? (
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
          ) : docsLoading ? (
            <p className="text-sm text-slate-500">Carregando documentos...</p>
          ) : docs.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhum documento encontrado nessa loja.
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
                      {tipoLabel[doc.tipo] ?? doc.tipo}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Status: {statusLabel[doc.status] ?? doc.status} - Enviado em{" "}
                      {formatDateTime(doc.created_at)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Prestador:{" "}
                      {doc.prestador_id
                        ? prestadorLabelById.get(doc.prestador_id) ?? doc.prestador_id
                        : typeof doc.dados?.prestador === "string"
                          ? doc.dados.prestador
                          : "Prestador nao informado"}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      ID: {doc.id}
                    </p>
                  </div>
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
              ))}
            </div>
          )}

          {selectedLojaId && total > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>
                {total} resultado(s) - Pagina {page} de {totalPages}
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
                  Proxima
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
