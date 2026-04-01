"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import {
  DocumentosCopilot,
} from "../documentos/_components/DocumentosCopilot";
import type { DocumentoCopilotFilters } from "@/lib/documentosCopilot";

const EMPTY_FILTERS: DocumentoCopilotFilters = {};

export default function CopilotPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { modules, loading: accessLoading } = useDocumentsAccess();
  const canAccessDocuments = modules.documentos;
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
    <div className="space-y-6 text-white">
      <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,31,0.98),rgba(11,18,34,0.94))] shadow-[0_28px_80px_rgba(2,6,23,0.55)]">
        <div className="border-b border-white/10 px-6 py-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
            <Bot className="h-3.5 w-3.5" />
            Copiloto de documentos
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <DocumentosCopilot
            currentFilters={EMPTY_FILTERS}
          />
        </div>
      </section>
    </div>
  );
}
