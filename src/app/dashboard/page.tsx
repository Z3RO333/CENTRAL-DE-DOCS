"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BriefcaseBusiness,
  Bot,
  CheckCircle2,
  ClipboardList,
  Clock,
  ClipboardSignature,
  Eye,
  FileBadge,
  FilePlus2,
  FileSearch,
  FileText,
  Layers,
  ReceiptText,
  Send,
  Signature,
  Sparkles,
  Store,
  TriangleAlert,
  CalendarClock,
  MailWarning,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { supabase } from "@/lib/supabaseClient";
import { fixMojibakeText } from "@/lib/textEncoding";
import { formatPersonName } from "@/lib/displayName";
import { StatusBadge } from "@/components/StatusBadge";

type DocumentosKpis = {
  pendentes: number;
  aguardandoAssinatura: number;
  enviadosHoje: number;
  enviadosNoMes: number;
  documentosVencendo: number;
  pendenciasCriticas: number;
  notasAguardandoAnalise: number;
};

type ActionCounts = {
  cobrancasFalhas: number;
  orcamentosAguardando: number;
};

type AtividadeRecente = {
  id: string;
  tipo: string;
  status: string;
  created_at: string;
  dados: Record<string, unknown> | null;
  arquivo_path?: string | null;
  arquivo_assinado_path?: string | null;
};

const TIPO_LABEL: Record<string, string> = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
  contratos: "Contratos",
  orcamentos: "Orçamentos",
};

type ModuleCard = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accent: string;
  cta: string;
};

const MODULES: ModuleCard[] = [
  {
    title: "Notas Fiscais",
    description: "Cadastre e armazene notas fiscais com pedido, valor e descrição.",
    href: "/formulario/notas-fiscais",
    icon: ReceiptText,
    accent: "bg-sky-50 text-sky-700 border-sky-200",
    cta: "Enviar nota",
  },
  {
    title: "Registro e Laudos",
    description: "Envie laudos técnicos (PMOC, PPRA, LTCAT) e registros para revisão.",
    href: "/formulario/registro-laudos",
    icon: FileBadge,
    accent: "bg-violet-50 text-violet-700 border-violet-200",
    cta: "Enviar laudo",
  },
  {
    title: "Retenção Trabalhista",
    description: "Controle de retenções trabalhistas por competência e prestador.",
    href: "/formulario/retencao-trabalhista",
    icon: BriefcaseBusiness,
    accent: "bg-emerald-50 text-emerald-700 border-emerald-200",
    cta: "Enviar retenção",
  },
  {
    title: "Orçamentos Internos",
    description: "Envie orçamentos para análise e assinatura dos gestores.",
    href: "/documentos/orcamentos-internos",
    icon: ClipboardSignature,
    accent: "bg-cyan-50 text-cyan-700 border-cyan-200",
    cta: "Abrir orçamentos",
  },
  {
    title: "Documentos por Loja",
    description: "Navegue pelas pastas digitais de cada unidade.",
    href: "/documentos/por-loja",
    icon: Store,
    accent: "bg-amber-50 text-amber-700 border-amber-200",
    cta: "Abrir pastas",
  },
  {
    title: "Pendências",
    description: "Documentos que precisam de revisão, assinatura ou complementação.",
    href: "/documentos/pendencias",
    icon: TriangleAlert,
    accent: "bg-rose-50 text-rose-700 border-rose-200",
    cta: "Ver pendências",
  },
  {
    title: "Copiloto",
    description: "Tire dúvidas sobre regras, prazos e prestadores com a IA.",
    href: "/copilot",
    icon: Bot,
    accent: "bg-indigo-50 text-indigo-700 border-indigo-200",
    cta: "Abrir copiloto",
  },
];

const FLUXO_STEPS: { title: string; description: string; icon: LucideIcon }[] = [
  {
    title: "Envio",
    description: "Prestador ou colaborador envia o arquivo pelo formulário.",
    icon: Send,
  },
  {
    title: "Classificação",
    description: "Tipo de documento, loja e prestador são vinculados ao envio.",
    icon: Layers,
  },
  {
    title: "Análise",
    description: "Equipe revisa as informações e o conteúdo do arquivo.",
    icon: FileSearch,
  },
  {
    title: "Assinatura/Revisão",
    description: "Documentos elegíveis são assinados ou marcados como revisados.",
    icon: Signature,
  },
  {
    title: "Consulta",
    description: "Tudo fica disponível em Documentos, organizado por loja e tipo.",
    icon: FileText,
  },
];

const formatDataCurta = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
};

const getDocumentoNome = (registro: AtividadeRecente) => {
  const anexos = registro.dados?.anexos;
  if (Array.isArray(anexos) && anexos.length > 0) {
    const primeiro = anexos[0] as { nome?: unknown } | null;
    if (primeiro && typeof primeiro.nome === "string" && primeiro.nome.trim()) {
      return fixMojibakeText(primeiro.nome.trim());
    }
  }
  const path = registro.arquivo_assinado_path ?? registro.arquivo_path;
  if (path) {
    const nomeArquivo = path.split("/").pop();
    if (nomeArquivo) {
      return fixMojibakeText(nomeArquivo);
    }
  }
  return registro.id.slice(0, 8);
};

export default function DashboardPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const { modules, loading: accessLoading } = useDocumentsAccess();
  const canAccessFormularios = modules.documentos;

  const [kpis, setKpis] = useState<DocumentosKpis | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [atividades, setAtividades] = useState<AtividadeRecente[]>([]);
  const [atividadesLoading, setAtividadesLoading] = useState(true);
  const [actionCounts, setActionCounts] = useState<ActionCounts>({
    cobrancasFalhas: 0,
    orcamentosAguardando: 0,
  });

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
      return;
    }
    if (!authLoading && user && !accessLoading && !canAccessFormularios) {
      router.replace("/documentos");
    }
  }, [authLoading, user, accessLoading, canAccessFormularios, router]);

  const carregarDados = useCallback(async (signal: AbortSignal) => {
    setKpisLoading(true);
    setAtividadesLoading(true);
    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sessão expirada.");

      const headers = { Authorization: `Bearer ${token}` };

      const [kpisRes, atividadesRes, cobrancasRes, orcamentosRes] = await Promise.all([
        fetch("/api/documentos/kpis", { headers, signal }),
        fetch("/api/documentos?limit=5&offset=0", { headers, signal }),
        fetch("/api/cobrancas/pendencias", { headers, signal }),
        fetch("/api/orcamentos-internos?tab=aprovacao&limit=1&offset=0", {
          headers,
          signal,
        }),
      ]);

      if (signal.aborted) return;

      if (kpisRes.ok) {
        const payload = (await kpisRes.json()) as { kpis?: DocumentosKpis };
        if (payload.kpis) {
          setKpis({
            pendentes: payload.kpis.pendentes ?? 0,
            aguardandoAssinatura: payload.kpis.aguardandoAssinatura ?? 0,
            enviadosHoje: payload.kpis.enviadosHoje ?? 0,
            enviadosNoMes: payload.kpis.enviadosNoMes ?? 0,
            documentosVencendo: payload.kpis.documentosVencendo ?? 0,
            pendenciasCriticas: payload.kpis.pendenciasCriticas ?? 0,
            notasAguardandoAnalise: payload.kpis.notasAguardandoAnalise ?? 0,
          });
        }
      }

      const nextActionCounts: ActionCounts = {
        cobrancasFalhas: 0,
        orcamentosAguardando: 0,
      };
      if (cobrancasRes.ok) {
        const payload = (await cobrancasRes.json()) as {
          total_falhas_cobranca?: number;
        };
        nextActionCounts.cobrancasFalhas = payload.total_falhas_cobranca ?? 0;
      }
      if (orcamentosRes.ok) {
        const payload = (await orcamentosRes.json()) as { total?: number };
        nextActionCounts.orcamentosAguardando = payload.total ?? 0;
      }
      setActionCounts(nextActionCounts);

      if (atividadesRes.ok) {
        const payload = (await atividadesRes.json()) as {
          registros?: AtividadeRecente[];
        };
        setAtividades(payload.registros ?? []);
      }
    } catch (err) {
      if (!signal.aborted) {
        console.error("Erro ao carregar dashboard:", err);
      }
    } finally {
      if (!signal.aborted) {
        setKpisLoading(false);
        setAtividadesLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void carregarDados(controller.signal);
    return () => controller.abort();
  }, [user, carregarDados]);

  if (authLoading || (user && accessLoading)) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando...
      </div>
    );
  }

  if (authError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        {authError}
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const kpiCards = [
    {
      label: "Pendências abertas",
      value: kpis?.pendentes ?? 0,
      icon: Clock,
      accent: "bg-amber-50 text-amber-700",
      href: "/documentos/pendencias",
    },
    {
      label: "Aguardando assinatura",
      value: kpis?.aguardandoAssinatura ?? 0,
      icon: Signature,
      accent: "bg-sky-50 text-sky-700",
      href: "/documentos?tipo=registro_laudos&somenteDisponiveisLote=true",
    },
    {
      label: "Enviados hoje",
      value: kpis?.enviadosHoje ?? 0,
      icon: FilePlus2,
      accent: "bg-emerald-50 text-emerald-700",
      href: "/documentos",
    },
    {
      label: "Enviados no mês",
      value: kpis?.enviadosNoMes ?? 0,
      icon: ClipboardList,
      accent: "bg-violet-50 text-violet-700",
      href: "/dashboard/analises",
    },
  ];

  const actionCards = [
    {
      label: "Documentos vencendo",
      description: "Vencimento nos próximos 30 dias",
      value: kpis?.documentosVencendo ?? 0,
      icon: CalendarClock,
      href: "/documentos/contratos",
      accent: "bg-rose-50 text-rose-700",
    },
    {
      label: "Pendências críticas",
      description: "Abertas há mais de 7 dias",
      value: kpis?.pendenciasCriticas ?? 0,
      icon: TriangleAlert,
      href: "/documentos/pendencias",
      accent: "bg-amber-50 text-amber-800",
    },
    {
      label: "Falhas de cobrança",
      description: "Envios que precisam ser reprocessados",
      value: actionCounts.cobrancasFalhas,
      icon: MailWarning,
      href: "/documentos/cobrancas",
      accent: "bg-orange-50 text-orange-700",
    },
    {
      label: "Notas aguardando análise",
      description: "Conservação pendente de verificação",
      value: kpis?.notasAguardandoAnalise ?? 0,
      icon: ReceiptText,
      href: "/documentos/conservacao/notas-fiscais",
      accent: "bg-sky-50 text-sky-700",
    },
    {
      label: "Orçamentos para aprovar",
      description: "Aguardando sua decisão",
      value: actionCounts.orcamentosAguardando,
      icon: ClipboardSignature,
      href: "/documentos/orcamentos-internos",
      accent: "bg-violet-50 text-violet-700",
    },
  ];

  const nomeCompleto = formatPersonName({
    name: (user.user_metadata?.name as string | undefined) ?? null,
    fullName: (user.user_metadata?.full_name as string | undefined) ?? null,
    email: user.email ?? null,
  });

  return (
    <div className="flex flex-1 flex-col gap-10 py-4">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-600 via-sky-500 to-emerald-500 p-6 text-white shadow-lg shadow-sky-200/60 sm:p-10">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-20 -left-10 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex flex-col gap-6">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-white/80">
            <Sparkles className="h-3.5 w-3.5" />
            Central de Documentos
          </div>
          <div className="max-w-2xl space-y-3">
            <p className="text-sm font-medium uppercase tracking-widest text-white/85">
              {nomeCompleto ? `Olá, ${nomeCompleto}` : "Bem-vindo"}
            </p>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Tudo o que você precisa em um só lugar.
            </h1>
            <p className="text-sm text-white/85 sm:text-base">
              Plataforma para envio, acompanhamento, revisão, assinatura e consulta
              de documentos operacionais. Use os atalhos abaixo para ir direto ao
              que importa.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="#modulos"
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-sky-700 shadow-md shadow-sky-900/20 transition hover:bg-slate-50"
            >
              <FilePlus2 className="h-4 w-4" />
              Enviar documento
            </a>
            <Link
              href="/documentos"
              className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20"
            >
              <FileSearch className="h-4 w-4" />
              Consultar documentos
            </Link>
            <Link
              href="/documentos/pendencias"
              className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20"
            >
              <TriangleAlert className="h-4 w-4" />
              Ver pendências
            </Link>
          </div>
        </div>
      </section>

      {/* KPIs leves */}
      <section aria-labelledby="acoes-hoje-title" className="space-y-4">
        <header>
          <p className="text-xs font-semibold uppercase tracking-widest text-rose-600">
            Prioridades
          </p>
          <h2 id="acoes-hoje-title" className="text-xl font-semibold text-slate-900">
            O que exige ação hoje
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Itens abertos que merecem atenção antes das atividades de rotina.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {actionCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.label}
                href={card.href}
                className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${card.accent}`}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="text-2xl font-semibold text-slate-900">
                    {kpisLoading ? "—" : card.value}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-slate-900">{card.label}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{card.description}</p>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href={card.href}
              className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {card.label}
                </p>
                <span
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${card.accent}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-3 text-2xl font-semibold text-slate-900">
                {kpisLoading ? "—" : card.value}
              </p>
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 group-hover:text-sky-600">
                Abrir <ArrowRight className="h-3 w-3" />
              </p>
            </Link>
          );
        })}
      </section>

      {/* Módulos */}
      <section id="modulos" className="space-y-4">
        <header className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              Módulos
            </p>
            <h2 className="text-lg font-semibold text-slate-900">
              O que você quer fazer agora?
            </h2>
          </div>
          <Link
            href="/dashboard/analises"
            className="hidden text-xs font-semibold text-sky-600 hover:text-sky-700 sm:inline-flex sm:items-center sm:gap-1"
          >
            Painel analítico <ArrowRight className="h-3 w-3" />
          </Link>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((module) => {
            const Icon = module.icon;
            return (
              <Link
                key={module.title}
                href={module.href}
                className="group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-100 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
              >
                <span
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${module.accent}`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {module.title}
                  </h3>
                  <p className="text-xs leading-relaxed text-slate-500">
                    {module.description}
                  </p>
                </div>
                <span className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-sky-600 group-hover:text-sky-700">
                  {module.cta} <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Como funciona */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-100 sm:p-8">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Como funciona
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            Do envio à consulta em 5 etapas
          </h2>
        </header>
        <ol className="grid gap-3 lg:grid-cols-5">
          {FLUXO_STEPS.map((step, index) => {
            const Icon = step.icon;
            const isLast = index === FLUXO_STEPS.length - 1;
            return (
              <li key={step.title} className="relative">
                <div className="flex h-full flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-sky-600 shadow-sm">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Etapa {index + 1}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {step.title}
                  </h3>
                  <p className="text-xs leading-relaxed text-slate-500">
                    {step.description}
                  </p>
                </div>
                {!isLast && (
                  <ArrowRight className="absolute right-[-14px] top-1/2 hidden h-4 w-4 -translate-y-1/2 text-slate-300 lg:block" />
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* Atividade recente */}
      <section className="space-y-4">
        <header className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              Atividade recente
            </p>
            <h2 className="text-lg font-semibold text-slate-900">
              Últimos envios da plataforma
            </h2>
          </div>
          <Link
            href="/documentos"
            className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600 hover:text-sky-700"
          >
            Ver todos em Documentos <ArrowRight className="h-3 w-3" />
          </Link>
        </header>
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-100">
          {atividadesLoading ? (
            <p className="px-4 py-6 text-center text-xs text-slate-500">
              Carregando atividade recente...
            </p>
          ) : atividades.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-500">
              Nenhum envio registrado ainda. Comece pelos módulos acima.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {atividades.slice(0, 5).map((registro) => {
                const status = registro.status;
                const dadosLojaNome =
                  typeof registro.dados?.loja_nome === "string"
                    ? fixMojibakeText(registro.dados.loja_nome)
                    : null;
                const prestadorNome =
                  typeof registro.dados?.prestador === "string"
                    ? fixMojibakeText(registro.dados.prestador)
                    : null;
                return (
                  <li
                    key={registro.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {getDocumentoNome(registro)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {TIPO_LABEL[registro.tipo] ?? registro.tipo}
                        {dadosLojaNome ? ` • ${dadosLojaNome}` : ""}
                        {prestadorNome ? ` • ${prestadorNome}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={status} />
                      <span className="text-[11px] text-slate-400">
                        {formatDataCurta(registro.created_at)}
                      </span>
                      <Link
                        href={`/documentos/${registro.id}`}
                        className="inline-flex items-center justify-center rounded-full border border-slate-200 p-1.5 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
                        aria-label="Abrir documento"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Rodapé sutil */}
      <section className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-5 text-xs text-slate-500">
        <p className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          Está procurando KPIs detalhados, gráficos de volume e distribuição? Vá
          para{" "}
          <Link
            href="/dashboard/analises"
            className="font-semibold text-sky-600 hover:text-sky-700"
          >
            Painel analítico
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
