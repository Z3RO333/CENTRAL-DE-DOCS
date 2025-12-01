"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { BriefcaseBusiness, FileBadge, ReceiptText } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type DashboardCard = {
  slug: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accent: string;
  border: string;
  serviceFilter?: string | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const { user, isLoading, error: authError } = useAuth();
  const [tipoServicoLaudos, setTipoServicoLaudos] = useState("todos");

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
        title: "Registro e Laudos",
        description: "Formulários para registros técnicos e laudos emitidos.",
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

  const cards = useMemo(() => {
    return baseCards.flatMap((card) => {
      if (card.slug !== "registro-laudos" || tipoServicoLaudos === "todos") {
        return [card];
      }

      return [
        {
          ...card,
          serviceFilter: tipoServicoLaudos,
          href: `${card.href}?tipoServico=${encodeURIComponent(
            tipoServicoLaudos,
          )}`,
          description: `Formulários para registros técnicos e laudos (${tipoServicoLaudos}).`,
        },
      ];
    });
  }, [baseCards, tipoServicoLaudos]);

  const resetTipoServico = () => setTipoServicoLaudos("todos");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
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

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Filtro de tipo de serviço
            </p>
            <p className="text-[11px] text-slate-500">
              Selecione um tipo para abrir o formulário de Registro e Laudos já
              filtrado.
            </p>
          </div>
          {tipoServicoLaudos !== "todos" && (
            <button
              type="button"
              onClick={resetTipoServico}
              className="text-[11px] font-semibold text-sky-600 underline underline-offset-2"
            >
              Limpar filtro
            </button>
          )}
        </div>
        <label className="mt-4 block text-xs font-semibold text-slate-600">
          Tipo de serviço (Registro e Laudos)
          <select
            value={tipoServicoLaudos}
            onChange={(event) => setTipoServicoLaudos(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
          >
            <option value="todos">Todos os serviços</option>
            <option value="Corretiva">Corretiva</option>
            <option value="Preventiva">Preventiva</option>
          </select>
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
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
              {card.slug === "registro-laudos" && card.serviceFilter && (
                <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                  Tipo selecionado: {card.serviceFilter}
                </span>
              )}
              <span className="mt-1 inline-flex items-center text-sm font-semibold text-emerald-700">
                Abrir formulário
                <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[11px] text-emerald-700">
                  &gt;
                </span>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
