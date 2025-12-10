"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { BriefcaseBusiness, FileBadge, ReceiptText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";

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
    </div>
  );
}
