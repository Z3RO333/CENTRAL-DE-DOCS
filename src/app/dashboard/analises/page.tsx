"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  PieChart,
  TrendingUp,
  Users2,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";

type Registro = {
  id: string;
  tipo: string;
  status: string;
  created_at: string;
  dados: Record<string, unknown> | null;
};

type DocumentoApiRecord = {
  id: string;
  tipo: string;
  status: string;
  created_at: string;
  dados?: Record<string, unknown> | null;
};

const tipoLabel: Record<string, string> = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
};

const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  em_analise: "Em análise",
  assinado: "Assinado",
};

const formatMesCurto = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    month: "short",
  })
    .format(date)
    .replace(".", "")
    .toUpperCase();

const MESES = [
  { value: "todos", label: "Todos os meses" },
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

const getMesesDoAno = (ano: number, mesFinal?: number) => {
  const limite =
    typeof mesFinal === "number"
      ? Math.min(Math.max(mesFinal, 0), 11)
      : 11;
  return Array.from({ length: limite + 1 }).map((_, index) => {
    const date = new Date(ano, index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return { key, label: formatMesCurto(date) };
  });
};

export default function DashboardAnalisesPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();
  const canAccessDashboards = isAdmin;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [tipoFilter, setTipoFilter] = useState<string>("todos");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [servicoFilter, setServicoFilter] = useState<string>("todos");
  const anoAtual = new Date().getFullYear().toString();
  const mesAtual = String(new Date().getMonth() + 1).padStart(2, "0");
  const [anoFilter, setAnoFilter] = useState<string>(anoAtual);
  const [mesFilter, setMesFilter] = useState<string>(mesAtual);
  const showServicoFilter = tipoFilter === "registro_laudos";
  const mesSelecionadoLabel =
    MESES.find((mes) => mes.value === mesFilter)?.label ?? "Todos os meses";
  const anoSelecionadoLabel =
    anoFilter === "todos" ? "todos os anos" : anoFilter;

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
    if (authLoading || accessLoading) {
      return;
    }

    if (!user) {
      router.replace("/login");
      return;
    }

    if (!canAccessDashboards) {
      setError(
        "Você não possui permissão para acessar os dashboards analíticos.",
      );
      setLoading(false);
      router.replace("/dashboard");
      return;
    }

    const email = user.email?.toLowerCase() ?? "";
    if (!email.endsWith("@bemol.com.br")) {
      setError(
        "Você não tem acesso a esta área. Procure por richardoliveira@bemol.com para solicitar acesso.",
      );
      setLoading(false);
      return;
    }

    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const response = await fetch("/api/documentos", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const payload = (await response.json()) as {
          registros?: DocumentoApiRecord[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            payload.error ?? "Não foi possível carregar os dados analíticos.",
          );
        }

        if (!active) {
          return;
        }

        const parsed =
          payload.registros?.map((item) => ({
            id: item.id as string,
            tipo: item.tipo as string,
            status: item.status as string,
            created_at: item.created_at as string,
            dados: (item.dados as Record<string, unknown> | null) ?? null,
          })) ?? [];

        setRegistros(parsed);
      } catch (err) {
        console.error("Erro ao carregar dados analíticos:", err);
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível carregar os dados analíticos.",
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
    canAccessDashboards,
    getAccessToken,
    user,
    router,
  ]);

  useEffect(() => {
    if (tipoFilter !== "registro_laudos" && servicoFilter !== "todos") {
      setServicoFilter("todos");
    }
  }, [tipoFilter, servicoFilter]);

  const anosDisponiveis = useMemo(() => {
    return Array.from(
      new Set(
        registros
          .map((registro) => {
            const data = new Date(registro.created_at);
            if (Number.isNaN(data.getTime())) {
              return null;
            }
            return data.getFullYear().toString();
          })
          .filter((value): value is string => value !== null),
      ),
    ).sort((a, b) => Number(b) - Number(a));
  }, [registros]);

  const registrosFiltrados = useMemo(
    () =>
      registros.filter((registro) => {
        if (tipoFilter !== "todos" && registro.tipo !== tipoFilter) {
          return false;
        }
        if (statusFilter !== "todos" && registro.status !== statusFilter) {
          return false;
        }
        if (showServicoFilter && servicoFilter !== "todos") {
          const valorServico =
            typeof registro.dados?.tipo_laudo === "string"
              ? registro.dados.tipo_laudo.trim()
              : "";
          if (valorServico !== servicoFilter) {
            return false;
          }
        }

        if (anoFilter !== "todos" || mesFilter !== "todos") {
          const data = new Date(registro.created_at);
          if (Number.isNaN(data.getTime())) {
            return false;
          }
          if (anoFilter !== "todos") {
            if (data.getFullYear().toString() !== anoFilter) {
              return false;
            }
          }
          if (mesFilter !== "todos") {
            const mesRegistro = String(data.getMonth() + 1).padStart(2, "0");
            if (mesRegistro !== mesFilter) {
              return false;
            }
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
      showServicoFilter,
      servicoFilter,
    ],
  );

  const totalPorStatus = useMemo(() => {
    return registrosFiltrados.reduce<Record<string, number>>(
      (acc, registro) => {
        acc[registro.status] = (acc[registro.status] ?? 0) + 1;
        return acc;
      },
      {},
    );
  }, [registrosFiltrados]);

  const totalPorTipo = useMemo(() => {
    return registrosFiltrados.reduce<Record<string, number>>(
      (acc, registro) => {
        acc[registro.tipo] = (acc[registro.tipo] ?? 0) + 1;
        return acc;
      },
      {},
    );
  }, [registrosFiltrados]);

  const servicosDisponiveis = useMemo(() => {
    if (!showServicoFilter) {
      return [];
    }
    const values = registros
      .filter((registro) => registro.tipo === "registro_laudos")
      .map((registro) =>
        typeof registro.dados?.tipo_laudo === "string"
          ? registro.dados.tipo_laudo.trim()
          : "",
      )
      .filter((valor) => Boolean(valor));
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }, [registros, showServicoFilter]);

  const totalPorServico = useMemo(() => {
    return registrosFiltrados.reduce<Record<string, number>>((acc, registro) => {
      if (registro.tipo !== "registro_laudos") {
        return acc;
      }
      const servico =
        typeof registro.dados?.tipo_laudo === "string"
          ? registro.dados.tipo_laudo.trim()
          : "";
      if (!servico) {
        return acc;
      }
      acc[servico] = (acc[servico] ?? 0) + 1;
      return acc;
    }, {});
  }, [registrosFiltrados]);

  const serieMensal = useMemo(() => {
    const agrupado = registrosFiltrados.reduce<Record<string, number>>(
      (acc, registro) => {
        const date = new Date(registro.created_at);
        if (Number.isNaN(date.getTime())) {
          return acc;
        }
        const chave = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        acc[chave] = (acc[chave] ?? 0) + 1;
        return acc;
      },
      {},
    );

    const now = new Date();
    const anoBase =
      anoFilter === "todos" ? now.getFullYear() : Number(anoFilter);
    const mesFinal =
      mesFilter !== "todos"
        ? Number(mesFilter) - 1
        : anoBase === now.getFullYear()
          ? now.getMonth()
          : 11;

    const base = getMesesDoAno(anoBase, mesFinal);
    return base.map((item) => ({
      ...item,
      total: agrupado[item.key] ?? 0,
    }));
  }, [registrosFiltrados, anoFilter, mesFilter]);

  const maxMes = Math.max(...serieMensal.map((item) => item.total), 1);

  const handleResetFilters = () => {
    setTipoFilter("todos");
    setStatusFilter("todos");
    setServicoFilter("todos");
    setAnoFilter(anoAtual);
    setMesFilter(mesAtual);
  };

  if (authLoading || accessLoading || loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando análises...
      </div>
    );
  }

  if (error || authError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-slate-500">
        <p>{error ?? authError}</p>
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="rounded-full bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm shadow-sky-300/80 transition hover:bg-sky-400"
        >
          Voltar
        </button>
      </div>
    );
  }

  const totalDocumentos = registrosFiltrados.length;
  const assinados = totalPorStatus.assinado ?? 0;
  const pendentes = totalPorStatus.pendente ?? 0;
  const emAnalise = totalPorStatus.em_analise ?? 0;

  const cards = [
    {
      label: "Total de documentos",
      value: totalDocumentos,
      icon: Activity,
      accent: "bg-slate-100 text-slate-700",
    },
    {
      label: "Assinados",
      value: assinados,
      icon: TrendingUp,
      accent: "bg-emerald-100 text-emerald-700",
    },
    {
      label: "Pendentes",
      value: pendentes,
      icon: Users2,
      accent: "bg-amber-100 text-amber-700",
    },
    {
      label: "Em análise",
      value: emAnalise,
      icon: BarChart3,
      accent: "bg-sky-100 text-sky-700",
    },
  ];

  const tiposOrdenados = Object.entries(totalPorTipo).sort(
    (a, b) => b[1] - a[1],
  );
  const servicosOrdenados = Object.entries(totalPorServico).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Painel analítico
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Resumo visual dos documentos enviados para apoiar decisões rápidas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/documentos")}
          className="inline-flex items-center rounded-full border border-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
        >
          Ver lista completa
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {card.label}
                </p>
                <span
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${card.accent}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-3 text-3xl font-semibold text-slate-900">
                {card.value}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Volume mensal (ano atual)
              </p>
              <p className="text-[11px] text-slate-500">
                Considera os envios a partir de janeiro do ano atual.
              </p>
            </div>
            <BarChart3 className="h-5 w-5 text-slate-400" />
          </div>
          <div className="mt-6 flex items-end gap-3">
            {serieMensal.map((item) => (
              <div key={item.key} className="flex flex-1 flex-col items-center">
                <div className="flex h-36 w-full items-end rounded-xl bg-slate-100 p-1">
                  <div
                    className="w-full rounded-t-xl bg-gradient-to-t from-sky-500 via-sky-400 to-emerald-400"
                    style={{
                      height:
                        maxMes === 0
                          ? "0%"
                          : `${Math.round((item.total / maxMes) * 100)}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs font-semibold uppercase text-slate-500">
                  {item.label}
                </p>
                <p className="text-[11px] text-slate-400">{item.total} envios</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Distribuição por status
              </p>
              <p className="text-[11px] text-slate-500">
                Percentual em relação ao total listado.
              </p>
            </div>
            <PieChart className="h-5 w-5 text-slate-400" />
          </div>
          <div className="mt-4 space-y-3">
            {Object.entries(totalPorStatus).map(([status, total]) => {
              const percentual =
                totalDocumentos > 0
                  ? ((total / totalDocumentos) * 100).toFixed(1)
                  : "0";
              return (
                <div key={status}>
                  <div className="flex items-center justify-between text-sm text-slate-600">
                    <span>{STATUS_LABELS[status] ?? status}</span>
                    <span className="font-semibold text-slate-900">
                      {total} ({percentual}%)
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-sky-400"
                      style={{
                        width:
                          totalDocumentos === 0
                            ? "0%"
                            : `${(total / totalDocumentos) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white/80 p-4 shadow-sm shadow-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Filtros
            </p>
            <p className="text-[11px] text-slate-500">
              Os cartões e gráficos consideram o período e as seleções abaixo.
            </p>
          </div>
          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Limpar filtros
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="text-xs font-semibold text-slate-600">
            Tipo de documento
            <select
              value={tipoFilter}
              onChange={(event) => setTipoFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            >
              <option value="todos">Todos os tipos</option>
              {Object.entries(tipoLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {showServicoFilter && (
            <label className="text-xs font-semibold text-slate-600">
              Tipo de laudo
              <select
                value={servicoFilter}
                onChange={(event) => setServicoFilter(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
              >
                <option value="todos">Todos os serviços</option>
                {servicosDisponiveis.map((servico) => (
                  <option key={servico} value={servico}>
                    {servico}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs font-semibold text-slate-600">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            >
              <option value="todos">Todos os status</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Ano
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
            Mês
            <select
              value={mesFilter}
              onChange={(event) => setMesFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            >
              {MESES.map((mes) => (
                <option key={mes.value} value={mes.value}>
                  {mes.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Exibindo dados de {mesSelecionadoLabel.toLowerCase()} em{" "}
          {anoSelecionadoLabel}. Ajuste o intervalo para comparar outros
          períodos.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Tipos mais enviados
              </p>
              <p className="text-[11px] text-slate-500">
                Ordenado do maior para o menor volume.
              </p>
            </div>
            <TrendingUp className="h-5 w-5 text-slate-400" />
          </div>
          <div className="mt-4 divide-y divide-slate-100 text-sm text-slate-600">
            {tiposOrdenados.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">
                Nenhum documento disponível para análise.
              </p>
            ) : (
              tiposOrdenados.map(([tipo, total]) => (
                <div
                  key={tipo}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="font-semibold text-slate-900">
                      {tipoLabel[tipo] ?? tipo}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {((total / Math.max(totalDocumentos, 1)) * 100).toFixed(1)}%
                      do total
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-slate-700">
                    {total}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Serviços mais feitos
              </p>
              <p className="text-[11px] text-slate-500">
                Baseado no tipo de laudo informado.
              </p>
            </div>
            <TrendingUp className="h-5 w-5 text-slate-400" />
          </div>
          <div className="mt-4 divide-y divide-slate-100 text-sm text-slate-600">
            {servicosOrdenados.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">
                Nenhum serviço encontrado nos envios filtrados.
              </p>
            ) : (
              servicosOrdenados.map(([servico, total]) => (
                <div
                  key={servico}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="font-semibold text-slate-900">{servico}</p>
                    <p className="text-[11px] text-slate-500">
                      {((total / Math.max(totalDocumentos, 1)) * 100).toFixed(1)}%
                      do total
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-slate-700">
                    {total}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

