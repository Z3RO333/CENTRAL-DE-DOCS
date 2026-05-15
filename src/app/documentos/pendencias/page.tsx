"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveX,
  Building2,
  CircleAlert,
  ExternalLink,
  FileWarning,
  Layers,
  LoaderCircle,
  Signature,
  Store,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { supabase } from "@/lib/supabaseClient";

type PendenciaItem = {
  id: string;
  tipo: string;
  status: string;
  created_at: string;
  nome: string;
  lojaNome: string | null;
  prestadorNome: string | null;
  numeroNf: string | null;
  numeroPedido: string | null;
  diasEmAnalise: number | null;
};

type PendenciaGroup = {
  total: number;
  items: PendenciaItem[];
  ids: string[];
};

type PendenciasPayload = {
  grupos?: Record<string, PendenciaGroup>;
  error?: string;
};

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

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString("pt-BR");
};

export default function DocumentosPendenciasPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { modules, isAdmin, loading: accessLoading } = useDocumentsAccess();
  const canAccessDocuments = modules.documentos;
  const [groups, setGroups] = useState<Record<string, PendenciaGroup>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getAccessToken = useCallback(async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }
    const token = data.session?.access_token;
    if (!token) {
      throw new Error("Sessão expirada. Faça login novamente.");
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
    if (!canAccessDocuments) {
      router.replace("/dashboard");
    }
  }, [accessLoading, authLoading, canAccessDocuments, router, user]);

  const loadPendencias = useCallback(async () => {
    if (!user || !canAccessDocuments) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/documentos/pendencias", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as PendenciasPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "Falha ao carregar pendências.");
      }
      setGroups(payload.grupos ?? {});
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao carregar pendências.",
      );
      setGroups({});
    } finally {
      setLoading(false);
    }
  }, [canAccessDocuments, getAccessToken, user]);

  useEffect(() => {
    if (!authLoading && !accessLoading && user && canAccessDocuments) {
      void loadPendencias();
    }
  }, [
    accessLoading,
    authLoading,
    canAccessDocuments,
    loadPendencias,
    user,
  ]);

  const sections = useMemo(
    () => [
      {
        key: "pendentesAssinatura",
        title: "Pendentes de assinatura",
        description: "Documentos assináveis ainda sem conclusão.",
        icon: Signature,
        href: "/documentos?tipo=registro_laudos&somenteDisponiveisLote=true",
      },
      {
        key: "emAnaliseMuitosDias",
        title: "Em análise há muitos dias",
        description: "Itens em análise por sete dias ou mais.",
        icon: CircleAlert,
        href: "/documentos?status=em_analise",
      },
      {
        key: "semLoja",
        title: "Sem loja vinculada",
        description: "Documentos sem loja estruturada nos dados.",
        icon: Store,
        href: "/documentos",
      },
      {
        key: "semPrestador",
        title: "Sem prestador vinculado",
        description: "Documentos sem prestador estruturado no cadastro.",
        icon: Building2,
        href: "/documentos",
      },
      {
        key: "arquivoIndisponivel",
        title: "Arquivo indisponível",
        description: "Registros sem caminho de arquivo associado.",
        icon: ArchiveX,
        href: "/documentos",
      },
      {
        key: "disponiveisAssinaturaLote",
        title: "Disponíveis para assinatura em lote",
        description: "Fila pronta para o fluxo operacional de assinatura.",
        icon: Layers,
        href: "/documentos?tipo=registro_laudos&somenteDisponiveisLote=true",
      },
    ],
    [],
  );

  const iniciarLote = (ids: string[]) => {
    const queue = ids.filter(Boolean);
    if (queue.length === 0) {
      return;
    }
    router.push(`/documentos/${queue[0]}?lote=${encodeURIComponent(queue.join(","))}`);
  };

  if (authLoading || accessLoading || !user || !canAccessDocuments) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando pendências...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileWarning className="h-5 w-5 text-slate-700" />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Pendências
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Visão operacional dos documentos que precisam de correção, revisão
            ou assinatura.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPendencias()}
          disabled={loading}
          className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm text-slate-500 shadow-sm shadow-slate-200">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Carregando agrupamentos...
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {sections.map((section) => {
            const Icon = section.icon;
            const group = groups[section.key] ?? {
              total: 0,
              items: [],
              ids: [],
            };
            const isBatch = section.key === "disponiveisAssinaturaLote";

            return (
              <section
                key={section.key}
                className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-slate-900">
                        {section.title}
                      </h2>
                      <p className="mt-1 text-xs text-slate-500">
                        {section.description}
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {group.total}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <Link
                    href={section.href}
                    className="rounded-full border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    Abrir filtro
                  </Link>
                  {isBatch && isAdmin && group.ids.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => iniciarLote(group.ids)}
                      className="rounded-full bg-sky-600 px-3 py-1.5 font-semibold text-white transition hover:bg-sky-500"
                    >
                      Assinar lote
                    </button>
                  ) : null}
                </div>

                <div className="mt-4 space-y-2">
                  {group.items.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
                      Nenhum documento neste agrupamento.
                    </p>
                  ) : (
                    group.items.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-slate-100 px-3 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {item.nome}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              {tipoLabel[item.tipo] ?? item.tipo} ·{" "}
                              {statusLabel[item.status] ?? item.status} ·{" "}
                              {formatDateTime(item.created_at)}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                              {item.lojaNome ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5">
                                  Loja: {item.lojaNome}
                                </span>
                              ) : null}
                              {item.prestadorNome ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5">
                                  Prestador: {item.prestadorNome}
                                </span>
                              ) : null}
                              {item.numeroNf ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5">
                                  NF: {item.numeroNf}
                                </span>
                              ) : null}
                              {item.numeroPedido ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5">
                                  Pedido: {item.numeroPedido}
                                </span>
                              ) : null}
                              {item.diasEmAnalise !== null &&
                              section.key === "emAnaliseMuitosDias" ? (
                                <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">
                                  {item.diasEmAnalise} dias
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <Link
                            href={`/documentos?documento=${encodeURIComponent(item.id)}`}
                            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Detalhes
                          </Link>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {group.total > group.items.length ? (
                  <p className="mt-3 text-[11px] text-slate-400">
                    Exibindo {group.items.length} de {group.total} item(ns).
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
