"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { BriefcaseBusiness, Eye, FileBadge, ReceiptText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePrestadores } from "@/hooks/usePrestadores";
import { supabase } from "@/lib/supabaseClient";
import { isInPeriodo, type PrestadorRegra } from "@/lib/prestadorRegras";

type DashboardCard = {
  slug: string;
  tipo: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accent: string;
  border: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const { user, isLoading, error: authError } = useAuth();
  const {
    prestadores: prestadoresDoUsuario,
    loading: prestadoresLoading,
  } = usePrestadores({
    assignedOnly: true,
    enabled: Boolean(user),
  });
  const [historico, setHistorico] = useState<
    {
      id: string;
      tipo: string;
      status: string;
      arquivo_path?: string | null;
      arquivo_assinado_path?: string | null;
      created_at: string;
      dados: Record<string, unknown> | null;
      prestador_id?: string | null;
    }[]
  >([]);
  const [historicoLoading, setHistoricoLoading] = useState(true);
  const [historicoErro, setHistoricoErro] = useState<string | null>(null);
  const [historicoTipoFilter, setHistoricoTipoFilter] = useState("todos");
  const [historicoStatusFilter, setHistoricoStatusFilter] = useState("todos");
  const [regras, setRegras] = useState<PrestadorRegra[]>([]);
  const [regrasLoading, setRegrasLoading] = useState(true);
  const [regrasErro, setRegrasErro] = useState<string | null>(null);
  const [dashboardTab, setDashboardTab] = useState<"formularios" | "monitoramento">(
    "formularios",
  );

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        {authError ?? "Carregando formulários..."}
      </div>
    );
  }

  const baseCards: DashboardCard[] = useMemo(
    () => [
      {
        slug: "retencao-trabalhista",
        tipo: "retencao_trabalhista",
        title: "Retenção Trabalhista",
        description:
          "Envio de documentos relacionados à retenção de tributos trabalhistas.",
        href: "/formulario/retencao-trabalhista",
        icon: BriefcaseBusiness,
        accent: "from-sky-100 via-sky-50 to-transparent",
        border: "border-sky-200",
      },
      {
        slug: "registro-laudos",
        tipo: "registro_laudos",
        title: "Registro e Laudos",
        description: "Formulários para registros técnicos e laudos emitidos.",
        href: "/formulario/registro-laudos",
        icon: FileBadge,
        accent: "from-sky-100 via-sky-50 to-transparent",
        border: "border-sky-200",
      },
      {
        slug: "notas-fiscais",
        tipo: "notas_fiscais",
        title: "Notas Fiscais",
        description: "Upload e controle de notas fiscais emitidas.",
        href: "/formulario/notas-fiscais",
        icon: ReceiptText,
        accent: "from-sky-100 via-sky-50 to-transparent",
        border: "border-sky-200",
      },
    ],
    [],
  );
  const formatData = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "--";
    }
    return date.toLocaleString("pt-BR");
  };

  const statusLabelMap: Record<string, string> = {
    pendente: "Pendente",
    em_analise: "Em análise",
    assinado: "Assinado",
  };

  const formatStatus = (status: string) =>
    statusLabelMap[status] ?? status.replace(/_/g, " ");

  const tipoLabel: Record<string, string> = {
    retencao_trabalhista: "Retenção Trabalhista",
    registro_laudos: "Registro e Laudos",
    notas_fiscais: "Notas Fiscais",
  };

  const formatTipo = (tipo: string) => tipoLabel[tipo] ?? tipo;

  const STORAGE_BUCKET = "formularios";
  const SIGNED_URL_EXPIRES_IN = 60 * 30;

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

  const getSignedFileUrl = async (path: string) => {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_EXPIRES_IN);

    if (error || !data?.signedUrl) {
      throw error ?? new Error("Não foi possível gerar o link do arquivo.");
    }
    return data.signedUrl;
  };

  const abrirDocumento = async (registro: {
    arquivo_path?: string | null;
    arquivo_assinado_path?: string | null;
  }) => {
    const path =
      resolveSignedPdfPath(registro.arquivo_assinado_path) ??
      registro.arquivo_assinado_path ??
      registro.arquivo_path;

    if (!path) {
      setHistoricoErro("Arquivo indisponível no momento.");
      return;
    }

    try {
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
      setHistoricoErro("Não foi possível abrir o documento. Tente novamente.");
    }
  };

  const carregarHistorico = useCallback(async () => {
    if (!user) {
      return;
    }
    setHistoricoLoading(true);
    setHistoricoErro(null);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("Sessão expirada. Faça login novamente.");
      }
      const params = new URLSearchParams();
      if (prestadoresDoUsuario.length > 0) {
        prestadoresDoUsuario.forEach((prestador) =>
          params.append("prestadorId", prestador.id),
        );
      } else {
        params.set("userId", user.id);
      }
      const url =
        params.size > 0 ? `/api/documentos?${params.toString()}` : "/api/documentos";
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as {
        registros?: {
          id: string;
          tipo: string;
          status: string;
          arquivo_path?: string | null;
          arquivo_assinado_path?: string | null;
          created_at: string;
          dados: Record<string, unknown> | null;
          prestador_id?: string | null;
        }[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.error ?? "Não foi possível carregar o histórico.",
        );
      }
      setHistorico(payload.registros ?? []);
    } catch (err) {
      console.error("Erro ao carregar histórico:", err);
      setHistoricoErro(
        err instanceof Error ? err.message : "Não foi possível carregar o histórico.",
      );
    } finally {
      setHistoricoLoading(false);
    }
  }, [user, prestadoresDoUsuario]);

  const carregarRegras = useCallback(async () => {
    if (!user) {
      return;
    }
    if (prestadoresDoUsuario.length === 0) {
      setRegras([]);
      setRegrasLoading(false);
      setRegrasErro(null);
      return;
    }
    setRegrasLoading(true);
    setRegrasErro(null);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("Sessao expirada. Faca login novamente.");
      }
      const params = new URLSearchParams();
      prestadoresDoUsuario.forEach((prestador) =>
        params.append("prestadorId", prestador.id),
      );
      const url =
        params.size > 0
          ? `/api/prestador-regras?${params.toString()}`
          : "/api/prestador-regras";
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json()) as {
        regras?: PrestadorRegra[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Nao foi possivel carregar as regras.");
      }
      setRegras(payload.regras ?? []);
    } catch (err) {
      console.error("Erro ao carregar regras:", err);
      setRegrasErro(
        err instanceof Error ? err.message : "Nao foi possivel carregar as regras.",
      );
    } finally {
      setRegrasLoading(false);
    }
  }, [prestadoresDoUsuario, user]);

  useEffect(() => {
    if (user && !prestadoresLoading) {
      void carregarHistorico();
    }
  }, [user, prestadoresLoading, carregarHistorico]);

  useEffect(() => {
    if (user && !prestadoresLoading) {
      void carregarRegras();
    }
  }, [user, prestadoresLoading, carregarRegras]);

  const historicoRecentes = useMemo(
    () =>
      historico.filter((item) => {
        if (historicoTipoFilter !== "todos" && item.tipo !== historicoTipoFilter) {
          return false;
        }
        if (
          historicoStatusFilter !== "todos" &&
          item.status !== historicoStatusFilter
        ) {
          return false;
        }
        return true;
      }),
    [historico, historicoTipoFilter, historicoStatusFilter],
  );

  const historicoTipoOptions = useMemo(() => {
    const extras = Array.from(new Set(historico.map((item) => item.tipo)))
      .filter((tipo) => !(tipo in tipoLabel))
      .sort();
    return [
      { value: "todos", label: "Todos os tipos" },
      ...Object.entries(tipoLabel).map(([value, label]) => ({
        value,
        label,
      })),
      ...extras.map((tipo) => ({
        value: tipo,
        label: tipo.replace(/_/g, " "),
      })),
    ];
  }, [historico]);

  const historicoStatusOptions = useMemo(() => {
    const base = ["pendente", "assinado", "em_analise"];
    const unique = Array.from(new Set(historico.map((item) => item.status)));
    const extras = unique.filter((status) => !base.includes(status)).sort();
    const ordered = [
      "todos",
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
  }, [historico]);

  const resumoPorTipo = useMemo(() => {
    return historico.reduce<
      Record<
        string,
        {
          total: number;
          ultimo: {
            status: string;
            created_at: string;
            dados: Record<string, unknown> | null;
          } | null;
        }
      >
    >((acc, item) => {
      if (!acc[item.tipo]) {
        acc[item.tipo] = { total: 0, ultimo: null };
      }
      acc[item.tipo].total += 1;
      if (
        !acc[item.tipo].ultimo ||
        new Date(item.created_at) >
          new Date(acc[item.tipo].ultimo?.created_at ?? 0)
      ) {
        acc[item.tipo].ultimo = {
          status: item.status,
          created_at: item.created_at,
          dados: item.dados,
        };
      }
      return acc;
    }, {});
  }, [historico]);

  const regrasPorPrestador = useMemo(() => {
    return regras.reduce<Record<string, PrestadorRegra[]>>((acc, regra) => {
      if (!acc[regra.prestador_id]) {
        acc[regra.prestador_id] = [];
      }
      acc[regra.prestador_id].push(regra);
      return acc;
    }, {});
  }, [regras]);

  const getTipoLaudo = (dados: Record<string, unknown> | null) => {
    if (!dados) {
      return "";
    }
    const value = dados["tipo_laudo"];
    return typeof value === "string" ? value : "";
  };

  const prestadoresProgresso = useMemo(() => {
    const now = new Date();
    return prestadoresDoUsuario.map((prestador) => {
      const regrasDoPrestador = regrasPorPrestador[prestador.id] ?? [];
      const progresso = regrasDoPrestador.map((regra) => {
        const enviados = historico.filter((item) => {
          if (item.prestador_id !== prestador.id) {
            return false;
          }
          if (!isInPeriodo(item.created_at, regra.periodo, now)) {
            return false;
          }
          if (item.tipo === "registro_laudos") {
            const tipoLaudo = getTipoLaudo(item.dados);
            return tipoLaudo.toLowerCase() === regra.alvo.toLowerCase();
          }
          return item.tipo === regra.alvo;
        }).length;
        const percentual =
          regra.quantidade > 0
            ? Math.min((enviados / regra.quantidade) * 100, 100)
            : 0;
        return {
          regra,
          enviados,
          percentual,
        };
      });
      return {
        prestador,
        progresso,
      };
    });
  }, [historico, prestadoresDoUsuario, regrasPorPrestador]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Formulários
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Escolha um tipo de formulário para iniciar o envio de documentos.
          </p>
        </div>
        <Link
          href="/documentos"
          className="inline-flex items-center rounded-full border border-sky-500/70 bg-sky-50 px-4 py-1.5 text-xs font-medium text-sky-700 shadow-sm shadow-sky-200/80 transition hover:bg-sky-100"
        >
          Ver documentos enviados
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 p-1 text-xs font-semibold text-slate-500">
          <button
            type="button"
            onClick={() => setDashboardTab("formularios")}
            className={`rounded-full px-3 py-1.5 transition ${
              dashboardTab === "formularios"
                ? "bg-white text-slate-700 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Formularios
          </button>
          <button
            type="button"
            onClick={() => setDashboardTab("monitoramento")}
            className={`rounded-full px-3 py-1.5 transition ${
              dashboardTab === "monitoramento"
                ? "bg-white text-slate-700 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Monitoramento
          </button>
        </div>
      </div>
      {dashboardTab === "formularios" ? (
        <>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {baseCards.map((card) => {
          const resumo = resumoPorTipo[card.tipo];
          const ultimoStatus = resumo?.ultimo?.status ?? null;
          const ultimoNumeroPedido =
            resumo?.ultimo?.dados &&
            typeof resumo.ultimo.dados.numero_pedido === "string"
              ? resumo.ultimo.dados.numero_pedido
              : null;

          return (
            <Link
              key={card.href}
              href={card.href}
              className="group relative overflow-hidden rounded-3xl bg-white p-6 shadow-md shadow-slate-200 transition hover:-translate-y-1 hover:shadow-lg"
            >
              <div
                className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${card.accent} opacity-80 blur-2xl`}
              />
              <div className="relative flex h-full flex-col gap-3">
                <div className="flex items-center gap-2">
                  <card.icon className="h-6 w-6 text-slate-700" />
                  <h2 className="text-base font-semibold text-slate-900">
                    {card.title}
                  </h2>
                </div>
                <p className="text-sm text-slate-500">{card.description}</p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <span className="rounded-full bg-slate-100 px-2 py-1">
                    {resumo?.total ? `${resumo.total} envio(s)` : "Nenhum envio"}
                  </span>
                  {resumo?.ultimo && (
                    <span className="rounded-full bg-slate-100 px-2 py-1">
                      Último envio: {formatData(resumo.ultimo.created_at)}
                    </span>
                  )}
                </div>
                {ultimoStatus && (
                  <div className="text-[11px] text-slate-500">
                    Status recente:{" "}
                    <span className="font-semibold text-slate-700">
                      {formatStatus(ultimoStatus)}
                    </span>
                  </div>
                )}
                {ultimoNumeroPedido && (
                  <div className="text-[11px] text-slate-500">
                    Pedido recente:{" "}
                    <span className="font-semibold text-slate-700">
                      {ultimoNumeroPedido}
                    </span>
                  </div>
                )}
                <span className="mt-1 inline-flex items-center text-sm font-semibold text-emerald-700">
                  Abrir formulário
                  <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[11px] text-emerald-700">
                    &gt;
                  </span>
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm shadow-slate-100/80">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Histórico de envios
            </p>
            <span className="text-[11px] text-slate-500">
              Consulte rapidamente os formulários enviados pelo seu grupo.
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            Mostrando {historicoRecentes.length} de {historico.length} registros
          </span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">
            Tipo
            <select
              value={historicoTipoFilter}
              onChange={(event) => setHistoricoTipoFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            >
              {historicoTipoOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Status
            <select
              value={historicoStatusFilter}
              onChange={(event) => setHistoricoStatusFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            >
              {historicoStatusOptions.map((statusOption) => (
                <option key={statusOption} value={statusOption}>
                  {statusOption === "todos"
                    ? "Todos os status"
                    : formatStatus(statusOption)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {historicoLoading ? (
          <p className="mt-4 text-xs text-slate-500">
            Carregando histórico de envios...
          </p>
        ) : historicoErro ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {historicoErro}
          </p>
        ) : historicoRecentes.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">
            Ainda não há envios registrados para o seu acesso.
          </p>
        ) : (
          <ul className="mt-4 space-y-3 text-xs text-slate-600">
            {historicoRecentes.map((registro) => {
              const pathParaVisualizar =
                resolveSignedPdfPath(registro.arquivo_assinado_path) ??
                registro.arquivo_assinado_path ??
                registro.arquivo_path;
              const podeVisualizar = Boolean(pathParaVisualizar);

              return (
                <li
                  key={registro.id}
                  className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {formatTipo(registro.tipo)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Enviado em {formatData(registro.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void abrirDocumento(registro)}
                        disabled={!podeVisualizar}
                        className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-1.5 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Visualizar documento"
                        aria-label="Visualizar documento"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                          registro.status === "assinado"
                            ? "bg-emerald-50 text-emerald-700"
                            : registro.status === "em_analise"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {formatStatus(registro.status)}
                      </span>
                    </div>
                  </div>
                  {registro.dados &&
                    typeof registro.dados.numero_pedido === "string" && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Pedido: {registro.dados.numero_pedido}
                      </p>
                    )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
        </>
      ) : (
      <section className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm shadow-slate-100/80">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Progresso por prestador
            </p>
            <span className="text-[11px] text-slate-500">
              Monitoramento de envios no periodo atual.
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            {prestadoresProgresso.length} prestador(es) monitorados
          </span>
        </div>

        {regrasLoading ? (
          <p className="mt-4 text-xs text-slate-500">
            Carregando regras de progresso...
          </p>
        ) : regrasErro ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {regrasErro}
          </p>
        ) : prestadoresProgresso.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">
            Nenhum prestador vinculado ao seu usuario.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {prestadoresProgresso.map((item) => (
              <div
                key={item.prestador.id}
                className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-xs text-slate-600"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {item.prestador.nome}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {item.prestador.tipo_servico}
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {item.progresso.length} regra(s)
                  </span>
                </div>

                {item.progresso.length === 0 ? (
                  <p className="mt-3 text-[11px] text-slate-500">
                    Nenhuma regra cadastrada.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {item.progresso.map(({ regra, enviados, percentual }) => {
                      const label =
                        regra.label?.trim() ||
                        (regra.tipo_regra === "formulario"
                          ? tipoLabel[regra.alvo] ?? regra.alvo
                          : regra.alvo);

                      return (
                        <div key={regra.id} className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] text-slate-500">
                            <span className="font-semibold text-slate-700">
                              {label}
                            </span>
                            <span>
                              {enviados}/{regra.quantidade}
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-white">
                            <div
                              className="h-2 rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-sky-300 transition-all"
                              style={{ width: `${percentual}%` }}
                            />
                          </div>
                          <p className="text-[11px] text-slate-500">
                            {Math.round(percentual)}% no {regra.periodo === "mensal" ? "mes" : "ano"} atual
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      )}
    </div>
  );
}
