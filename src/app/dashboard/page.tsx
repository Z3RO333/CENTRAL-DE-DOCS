"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  BriefcaseBusiness,
  FileBadge,
  ReceiptText,
} from "lucide-react";

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const verifyUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
      } else {
        setLoading(false);
      }
    };

    void verifyUser();
  }, [router]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        Carregando formulários...
      </div>
    );
  }

  const cards = [
    {
      title: "Retenção Trabalhista",
      description: "Envio de documentos relacionados à retenção de tributos trabalhistas.",
      href: "/formulario/retencao-trabalhista",
      icon: BriefcaseBusiness,
      accent: "from-sky-100 via-sky-50 to-transparent",
      border: "border-sky-200",
    },
    {
      title: "Registro e Laudos",
      description: "Formulários para registros técnicos e laudos emitidos.",
      href: "/formulario/registro-laudos",
      icon: FileBadge,
      accent: "from-sky-100 via-sky-50 to-transparent",
      border: "border-sky-200",
    },
    {
      title: "Notas Fiscais",
      description: "Upload e controle de notas fiscais emitidas.",
      href: "/formulario/notas-fiscais",
      icon: ReceiptText,
      accent: "from-sky-100 via-sky-50 to-transparent",
      border: "border-sky-200",
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
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

      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group relative overflow-hidden rounded-2xl bg-white p-5 shadow-sm shadow-slate-200 transition hover:-translate-y-1 hover:shadow-md"
          >
            <div
              className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${card.accent} opacity-80 blur-2xl`}
            />
            <div className="relative flex h-full flex-col gap-3">
              <div className="flex items-center gap-2">
                <card.icon className="h-5 w-5 text-slate-700" />
                <h2 className="text-sm font-semibold text-slate-900">
                  {card.title}
                </h2>
              </div>
              <p className="flex-1 text-xs text-slate-500">
                {card.description}
              </p>
              <span className="mt-1 inline-flex items-center text-xs font-medium text-emerald-700">
                Abrir formulário
                <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-[10px] text-emerald-700">
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
