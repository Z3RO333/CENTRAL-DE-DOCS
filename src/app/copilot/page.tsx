"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bot,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import {
  DocumentosCopilot,
} from "../documentos/_components/DocumentosCopilot";
import type { DocumentoCopilotFilters } from "@/lib/documentosCopilot";

const LIST_STATE_STORAGE_KEY = "documentos:list-state";

type DocumentosListState = {
  tipoFilter: string;
  tipoLaudoFilter: string;
  userFilter: string;
  lojaFilter: string;
  prestadorFilter: string;
  statusFilter: string;
  identificacaoFilter: string;
  anoFilter: string;
  mesFilter: string;
  somenteAssinados: boolean;
  somenteDisponiveisLote: boolean;
  viewMode: "tabela" | "cards";
  scrollY: number;
  page: number;
  pageSize: number;
};

const EMPTY_FILTERS: DocumentoCopilotFilters = {};

export default function CopilotPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { modules, loading: accessLoading } = useDocumentsAccess();
  const canAccessDocuments = modules.documentos;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (authLoading || accessLoading) {
      return;
    }

    if (!user) {
      router.replace("/login");
      return;
    }

    if (!canAccessDocuments) {
      router.replace("/documentos");
    }
  }, [authLoading, accessLoading, user, canAccessDocuments, router]);

  const applyFilters = (filters: DocumentoCopilotFilters) => {
    if (typeof window !== "undefined") {
      const next: DocumentosListState = {
        tipoFilter: filters.tipo ?? "todos",
        tipoLaudoFilter: filters.tipoLaudo ?? "todos",
        userFilter: "todos",
        lojaFilter: filters.lojaId ?? "todos",
        prestadorFilter: filters.prestadorId ?? "todos",
        statusFilter: filters.status ?? "todos",
        identificacaoFilter: filters.termo ?? "",
        anoFilter: filters.ano ?? "2026",
        mesFilter: filters.mes ?? "todos",
        somenteAssinados: filters.somenteAssinados ?? false,
        somenteDisponiveisLote: filters.somenteDisponiveisLote ?? false,
        viewMode: "tabela",
        scrollY: 0,
        page: 1,
        pageSize: 25,
      };
      window.sessionStorage.setItem(
        LIST_STATE_STORAGE_KEY,
        JSON.stringify(next),
      );
    }

    router.push("/documentos");
  };

  if (authLoading || accessLoading || !user || !canAccessDocuments) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,31,0.96),rgba(11,18,34,0.92))] text-slate-100 shadow-[0_28px_80px_rgba(2,6,23,0.55)]">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10">
            <Bot className="h-6 w-6 text-cyan-200" />
          </div>
          <p className="text-sm font-semibold text-white">Carregando Copiloto</p>
          <p className="text-sm text-slate-300">
            Preparando a área de busca inteligente...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 text-white">
      <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,31,0.96),rgba(11,18,34,0.92))] shadow-[0_28px_80px_rgba(2,6,23,0.55)]">
        <div className="relative px-6 py-8 sm:px-8 sm:py-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(34,211,238,0.14),transparent_35%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.16),transparent_32%)]" />

          <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] xl:items-center">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
                <Sparkles className="h-3.5 w-3.5" />
                Nova aba
              </div>
              <div className="space-y-4">
                <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Copiloto de documentos
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                  Faça buscas em linguagem natural, veja os resultados de forma
                  guiada e leve os filtros prontos para a aba Documentos com um
                  clique.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                  <ShieldCheck className="h-4 w-4 text-cyan-200" />
                  Permissões respeitadas
                </div>
                <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                  <Wand2 className="h-4 w-4 text-cyan-200" />
                  Filtros prontos para uso
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const target = document.getElementById("copilot-busca");
                  target?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
              >
                Começar busca
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4">
              {[
                {
                  title: "Busca guiada",
                  body: "Descreva o documento que procura em português e deixe o copiloto montar os filtros.",
                },
                {
                  title: "Resultado prático",
                  body: "Abra o documento ou leve os filtros prontos para a tela principal.",
                },
                {
                  title: "Paleta dedicada",
                  body: "Esta aba usa o mesmo universo visual escuro e ciano do copiloto.",
                },
              ].map((card) => (
                <div
                  key={card.title}
                  className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-slate-950/10"
                >
                  <p className="text-sm font-semibold text-white">{card.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {card.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="copilot-busca"
        className="overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,31,0.96),rgba(11,18,34,0.92))] shadow-[0_28px_80px_rgba(2,6,23,0.45)]"
      >
        <div className="border-b border-white/10 px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
            Assistente
          </p>
          <p className="mt-1 text-sm text-slate-300">
            Escreva a intenção, aplique os filtros e siga para a lista de
            documentos.
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <DocumentosCopilot
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed((value) => !value)}
            currentFilters={EMPTY_FILTERS}
            onApplyFilters={applyFilters}
          />
        </div>
      </section>
    </div>
  );
}
