"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { BriefcaseBusiness, Eye, FileBadge, ReceiptText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePrestadores } from "@/hooks/usePrestadores";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
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

const STATUS_LABEL_MAP: Record<string, string> = {
  pendente: "Pendente",
  em_analise: "Em análise",
  assinado: "Assinado",
};

const TIPO_LABEL: Record<string, string> = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
};

const STORAGE_BUCKET = "formularios";
const SIGNED_URL_EXPIRES_IN = 60 * 30;

const BASE_CARDS: DashboardCard[] = [
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
];

const formatData = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString("pt-BR");
};

const formatStatus = (status: string) =>
  STATUS_LABEL_MAP[status] ?? status.replace(/_/g, " ");

const formatTipo = (tipo: string) => TIPO_LABEL[tipo] ?? tipo;

const getLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getLocalDateLabel = (date: Date) => {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
};

export default function DashboardPage() {
  const router = useRouter();
  const { user, isLoading, error: authError } = useAuth();
  const { isAdmin, loading: accessLoading } = useDocumentsAccess();
  const canViewAllDocuments = isAdmin;
  const {
    prestadores: prestadoresDoUsuario,
    loading: prestadoresLoading,
  } = usePrestadores({
    assignedOnly: true,
    enabled: Boolean(user) && !canViewAllDocuments,
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
  const [historicoPeriodoFilter, setHistoricoPeriodoFilter] =
    useState("ultimos_30_dias");
  const [historicoVisibleCount, setHistoricoVisibleCount] = useState(20);
  const [regras, setRegras] = useState<PrestadorRegra[]>([]);
  const [regrasLoading, setRegrasLoading] = useState(true);
  const [regrasErro, setRegrasErro] = useState<string | null>(null);
  const [dashboardTab, setDashboardTab] = useState<"formularios" | "monitoramento">(
    "formularios",
  );

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
      return;
    }
    if (!isLoading && user && !accessLoading && !isAdmin) {
      router.replace("/documentos");
    }
  }, [isLoading, user, router, accessLoading, isAdmin]);
  const isBlocked = isLoading || !user;
  const baseCards = BASE_CARDS;

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

  const carregarHistorico = useCallback(async (signal?: AbortSignal) => {
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
      if (!canViewAllDocuments) {
        if (prestadoresDoUsuario.length > 0) {
          prestadoresDoUsuario.forEach((prestador) =>
            params.append("prestadorId", prestador.id),
          );
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
        signal,
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
      if (signal?.aborted) {
        return;
      }
      setHistorico(payload.registros ?? []);
    } catch (err) {
      if (signal?.aborted) {
        return;
      }
      console.error("Erro ao carregar histórico:", err);
      setHistoricoErro(
        err instanceof Error ? err.message : "Não foi possível carregar o histórico.",
      );
    } finally {
      if (!signal?.aborted) {
        setHistoricoLoading(false);
      }
    }
  }, [user, prestadoresDoUsuario, canViewAllDocuments]);

  const carregarRegras = useCallback(async (signal?: AbortSignal) => {
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
        throw new Error("Sessão expirada. Faça login novamente.");
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
        signal,
      });
      const payload = (await response.json()) as {
        regras?: PrestadorRegra[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Não foi possível carregar as regras.");
      }
      if (signal?.aborted) {
        return;
      }
      setRegras(payload.regras ?? []);
    } catch (err) {
      if (signal?.aborted) {
        return;
      }
      console.error("Erro ao carregar regras:", err);
      setRegrasErro(
        err instanceof Error ? err.message : "Não foi possível carregar as regras.",
      );
    } finally {
      if (!signal?.aborted) {
        setRegrasLoading(false);
      }
    }
  }, [prestadoresDoUsuario, user]);

  useEffect(() => {
    if (user && !accessLoading && (canViewAllDocuments || !prestadoresLoading)) {
      const controller = new AbortController();
      void carregarHistorico(controller.signal);
      return () => controller.abort();
    }
    return undefined;
  }, [
    user,
    accessLoading,
    canViewAllDocuments,
    prestadoresLoading,
    carregarHistorico,
  ]);

  useEffect(() => {
    if (user && !accessLoading && !canViewAllDocuments && !prestadoresLoading) {
      const controller = new AbortController();
      void carregarRegras(controller.signal);
      return () => controller.abort();
    }
    return undefined;
  }, [
    user,
    accessLoading,
    canViewAllDocuments,
    prestadoresLoading,
    carregarRegras,
  ]);

  const historicoTipoOptions = useMemo(() => {
    const extras = Array.from(new Set(historico.map((item) => item.tipo)))
      .filter((tipo) => !(tipo in TIPO_LABEL))
      .sort();
    return [
      { value: "todos", label: "Todos os tipos" },
      ...Object.entries(TIPO_LABEL).map(([value, label]) => ({
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

  const isDentroPeriodoGlobal = useCallback(
    (dateValue: string) => {
      if (historicoPeriodoFilter === "todos") {
        return true;
      }
      const date = new Date(dateValue);
      if (Number.isNaN(date.getTime())) {
        return false;
      }
      const now = new Date();
      if (historicoPeriodoFilter === "mes_atual") {
        return (
          date.getFullYear() === now.getFullYear() &&
          date.getMonth() === now.getMonth()
        );
      }
      if (historicoPeriodoFilter === "ano_atual") {
        return date.getFullYear() === now.getFullYear();
      }
      const dias =
        historicoPeriodoFilter === "ultimos_90_dias" ? 90 : 30;
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - dias);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return date >= start && date <= end;
    },
    [historicoPeriodoFilter],
  );

  const historicoFiltrado = useMemo(() => {
    return historico.filter((item) => {
      if (historicoTipoFilter !== "todos" && item.tipo !== historicoTipoFilter) {
        return false;
      }
      if (
        historicoStatusFilter !== "todos" &&
        item.status !== historicoStatusFilter
      ) {
        return false;
      }
      return isDentroPeriodoGlobal(item.created_at);
    });
  }, [
    historico,
    historicoTipoFilter,
    historicoStatusFilter,
    isDentroPeriodoGlobal,
  ]);

  useEffect(() => {
    setHistoricoVisibleCount(20);
  }, [
    historicoTipoFilter,
    historicoStatusFilter,
    historicoPeriodoFilter,
    historico.length,
  ]);

  const historicoVisiveis = useMemo(
    () => historicoFiltrado.slice(0, historicoVisibleCount),
    [historicoFiltrado, historicoVisibleCount],
  );

  const resumoPorTipo = useMemo(() => {
    return historicoFiltrado.reduce<
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
  }, [historicoFiltrado]);

  const statusResumo = useMemo(() => {
    return historicoFiltrado.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [historicoFiltrado]);

  const tipoResumo = useMemo(() => {
    return historicoFiltrado.reduce<Record<string, number>>((acc, item) => {
      acc[item.tipo] = (acc[item.tipo] ?? 0) + 1;
      return acc;
    }, {});
  }, [historicoFiltrado]);

  const prestadorResumo = useMemo(() => {
    const base = prestadoresDoUsuario.reduce<Record<string, number>>(
      (acc, prestador) => {
        acc[prestador.id] = 0;
        return acc;
      },
      {},
    );
    return historicoFiltrado.reduce<Record<string, number>>((acc, item) => {
      if (!item.prestador_id) {
        return acc;
      }
      acc[item.prestador_id] = (acc[item.prestador_id] ?? 0) + 1;
      return acc;
    }, base);
  }, [historicoFiltrado, prestadoresDoUsuario]);

  const enviosUltimos30Dias = useMemo(() => {
    const today = new Date();
    const days: { key: string; label: string; count: number }[] = [];
    for (let offset = 29; offset >= 0; offset -= 1) {
      const day = new Date(today);
      day.setDate(today.getDate() - offset);
      days.push({
        key: getLocalDateKey(day),
        label: getLocalDateLabel(day),
        count: 0,
      });
    }

    const indexByKey = days.reduce<Record<string, number>>((acc, item, index) => {
      acc[item.key] = index;
      return acc;
    }, {});

    historicoFiltrado.forEach((item) => {
      const date = new Date(item.created_at);
      if (Number.isNaN(date.getTime())) {
        return;
      }
      const key = getLocalDateKey(date);
      const index = indexByKey[key];
      if (index === undefined) {
        return;
      }
      days[index].count += 1;
    });

    return days;
  }, [historicoFiltrado]);

  const maxEnviosDia = Math.max(
    1,
    ...enviosUltimos30Dias.map((item) => item.count),
  );
  const maxPrestadorEnvios = Math.max(
    1,
    ...Object.values(prestadorResumo),
  );
  const maxTipoEnvios = Math.max(1, ...Object.values(tipoResumo));
  const maxStatusEnvios = Math.max(1, ...Object.values(statusResumo));

  const statusOrdenado = useMemo(
    () =>
      Object.entries(statusResumo).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)),
    [statusResumo],
  );

  const tipoOrdenado = useMemo(
    () =>
      Object.entries(tipoResumo).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)),
    [tipoResumo],
  );

  const prestadorOrdenado = useMemo(() => {
    return prestadoresDoUsuario
      .map((prestador) => ({
        id: prestador.id,
        nome: prestador.nome,
        tipo: prestador.tipo_servico,
        total: prestadorResumo[prestador.id] ?? 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [prestadoresDoUsuario, prestadorResumo]);

  const regrasPorPrestador = useMemo(() => {
    return regras.reduce<Record<string, PrestadorRegra[]>>((acc, regra) => {
      if (!acc[regra.prestador_id]) {
        acc[regra.prestador_id] = [];
      }
      acc[regra.prestador_id].push(regra);
      return acc;
    }, {});
  }, [regras]);

  const prestadoresProgresso = useMemo(() => {
    const now = new Date();
    return prestadoresDoUsuario.map((prestador) => {
      const regrasDoPrestador = regrasPorPrestador[prestador.id] ?? [];
      const progresso = regrasDoPrestador.map((regra) => {
        const enviados = historicoFiltrado.filter((item) => {
          if (item.prestador_id !== prestador.id) {
            return false;
          }
          if (!isInPeriodo(item.created_at, regra.periodo, now)) {
            return false;
          }
          return true;
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
  }, [historicoFiltrado, prestadoresDoUsuario, regrasPorPrestador]);
  return isBlocked ? (
    <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
      {authError ?? "Carregando formularios..."}
    </div>
  ) : (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {"Formul\u00e1rios"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {"Escolha um tipo de formul\u00e1rio para iniciar o envio de documentos."}
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
            Formulários
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
      <div className="rounded-2xl bg-white/80 p-4 text-xs text-slate-600 shadow-sm shadow-slate-100/80">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Filtros globais
            </p>
            <span className="text-[11px] text-slate-500">
              Ajuste os filtros para todas as visualizações do documentos.
            </span>
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-semibold text-slate-600">
            {"Per\u00edodo"}
            <select
              value={historicoPeriodoFilter}
              onChange={(event) => setHistoricoPeriodoFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            >
              <option value="ultimos_30_dias">Últimos 30 dias</option>
              <option value="ultimos_90_dias">Últimos 90 dias</option>
              <option value="mes_atual">Mês atual</option>
              <option value="ano_atual">Ano atual</option>
              <option value="todos">Todos os períodos</option>
            </select>
          </label>
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

      <section className="rounded-3xl bg-white/80 p-6 shadow-sm shadow-slate-100/80">
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
            Mostrando {historicoFiltrado.length} registro(s) após filtros
          </span>
        </div>

        {historicoLoading ? (
          <p className="mt-4 text-xs text-slate-500">
            Carregando histórico de envios...
          </p>
        ) : historicoErro ? (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            {historicoErro}
          </p>
        ) : historicoFiltrado.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">
            Ainda não há envios registrados para o seu acesso.
          </p>
        ) : (
          <>
            <ul className="mt-4 space-y-3 text-xs text-slate-600">
              {historicoVisiveis.map((registro) => {
                const pathParaVisualizar =
                  resolveSignedPdfPath(registro.arquivo_assinado_path) ??
                  registro.arquivo_assinado_path ??
                  registro.arquivo_path;
                const podeVisualizar = Boolean(pathParaVisualizar);

                return (
                  <li
                    key={registro.id}
                    className="rounded-2xl bg-slate-50/80 px-4 py-3"
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
            {historicoFiltrado.length > historicoVisiveis.length && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() =>
                    setHistoricoVisibleCount((count) => count + 20)
                  }
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Carregar mais
                </button>
              </div>
            )}
          </>
        )}
      </section>
        </>
      ) : (
      <section className="rounded-3xl bg-white/80 p-6 shadow-sm shadow-slate-100/80">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Progresso por prestador
            </p>
            <span className="text-[11px] text-slate-500">
              {
                "Monitoramento de envios no per\u00edodo da regra (mensal/anual)."
              }
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
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            {regrasErro}
          </p>
        ) : prestadoresProgresso.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">
            Nenhum prestador vinculado ao seu usuário.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {prestadoresProgresso.map((item) => (
              <div
                key={item.prestador.id}
                className="rounded-2xl bg-slate-50/70 px-4 py-3 text-xs text-slate-600"
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
                          ? TIPO_LABEL[regra.alvo] ?? regra.alvo
                          : regra.alvo);
                      const faltam = Math.max(regra.quantidade - enviados, 0);

                      return (
                        <div key={regra.id} className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] text-slate-500">
                            <span className="font-semibold text-slate-700">
                              {label}
                            </span>
                            <span>
                              Enviados: {enviados} / Meta: {regra.quantidade}
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-white">
                            <div
                              className="h-2 rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-sky-300 transition-all"
                              style={{ width: `${percentual}%` }}
                            />
                          </div>
                          <p className="text-[11px] text-slate-500">
                            Faltam {faltam} envio(s)
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {Math.round(percentual)}% no {regra.periodo === "mensal" ? "mês" : "ano"} atual
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













