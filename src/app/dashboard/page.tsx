"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { BriefcaseBusiness, FileBadge, ReceiptText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { usePrestadores } from "@/hooks/usePrestadores";
import { supabase } from "@/lib/supabaseClient";

type DashboardCard = {
  slug: string;
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
  const { modules: modulesAccess } = useDocumentsAccess();
  const canManagePrestadores = modulesAccess.documentos;
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
      created_at: string;
      dados: Record<string, unknown> | null;
    }[]
  >([]);
  const [historicoLoading, setHistoricoLoading] = useState(true);
  const [historicoErro, setHistoricoErro] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        {authError ?? "Carregando formularios..."}
      </div>
    );
  }

  const baseCards: DashboardCard[] = useMemo(
    () => [
      {
        slug: "retencao-trabalhista",
        title: "Retencao Trabalhista",
        description:
          "Envio de documentos relacionados a retencao de tributos trabalhistas.",
        href: "/formulario/retencao-trabalhista",
        icon: BriefcaseBusiness,
        accent: "from-sky-100 via-sky-50 to-transparent",
        border: "border-sky-200",
      },
      {
        slug: "registro-laudos",
        title: "Registro e Laudos",
        description: "Formularios para registros tecnicos e laudos emitidos.",
        href: "/formulario/registro-laudos",
        icon: FileBadge,
        accent: "from-sky-100 via-sky-50 to-transparent",
        border: "border-sky-200",
      },
      {
        slug: "notas-fiscais",
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
    em_analise: "Em analise",
    assinado: "Assinado",
  };

  const formatStatus = (status: string) =>
    statusLabelMap[status] ?? status.replace(/_/g, " ");

  const tipoLabel: Record<string, string> = {
    retencao_trabalhista: "Retencao Trabalhista",
    registro_laudos: "Registro e Laudos",
    notas_fiscais: "Notas Fiscais",
  };

  const formatTipo = (tipo: string) => tipoLabel[tipo] ?? tipo;

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
        throw new Error("Sessao expirada. Faca login novamente.");
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
          created_at: string;
          dados: Record<string, unknown> | null;
        }[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.error ?? "Nao foi possivel carregar o historico.",
        );
      }
      setHistorico(payload.registros ?? []);
    } catch (err) {
      console.error("Erro ao carregar historico:", err);
      setHistoricoErro(
        err instanceof Error ? err.message : "Nao foi possivel carregar o historico.",
      );
    } finally {
      setHistoricoLoading(false);
    }
  }, [user, prestadoresDoUsuario]);

  useEffect(() => {
    if (user && !prestadoresLoading) {
      void carregarHistorico();
    }
  }, [user, prestadoresLoading, carregarHistorico]);

  const historicoRecentes = useMemo(
    () => historico.slice(0, 6),
    [historico],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Formularios
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Escolha um tipo de formulario para iniciar o envio de documentos.
          </p>
        </div>
        <Link
          href="/documentos"
          className="inline-flex items-center rounded-full border border-sky-500/70 bg-sky-50 px-4 py-1.5 text-xs font-medium text-sky-700 shadow-sm shadow-sky-200/80 transition hover:bg-sky-100"
        >
          Ver documentos enviados
        </Link>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {baseCards.map((card) => (
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
              <p className="flex-1 text-sm text-slate-500">
                {card.description}
              </p>
              <span className="mt-1 inline-flex items-center text-sm font-semibold text-emerald-700">
                Abrir formulario
                <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[11px] text-emerald-700">
                  &gt;
                </span>
              </span>
            </div>
          </Link>
        ))}
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm shadow-slate-100/80">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Historico de envios
            </p>
            <span className="text-[11px] text-slate-500">
              Consulte rapidamente os formularios enviados pelo seu grupo.
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            Mostrando {historicoRecentes.length} de {historico.length} registros
          </span>
        </div>

        {historicoLoading ? (
          <p className="mt-4 text-xs text-slate-500">
            Carregando historico de envios...
          </p>
        ) : historicoErro ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {historicoErro}
          </p>
        ) : historicoRecentes.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">
            Ainda nao ha envios registrados para o seu acesso.
          </p>
        ) : (
          <ul className="mt-4 space-y-3 text-xs text-slate-600">
            {historicoRecentes.map((registro) => (
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
                {registro.dados &&
                  typeof registro.dados.numero_pedido === "string" && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Pedido: {registro.dados.numero_pedido}
                    </p>
                  )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
