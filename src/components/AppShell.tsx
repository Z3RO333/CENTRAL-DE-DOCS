"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  FileText,
  LogOut,
  UserRound,
  BarChart3,
  ShieldCheck,
  Building2,
  HelpCircle,
  X,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, error: authError, refresh } = useAuth();
  const {
    modules: modulesAccess,
    loading: documentsAccessLoading,
  } = useDocumentsAccess();
  const showNav = pathname !== "/login";

  const isAuthenticated = !!user;
  const canAccessDocuments =
    modulesAccess.documentos && !documentsAccessLoading;
  const canAccessDashboards =
    modulesAccess.dashboards && !documentsAccessLoading;
  const canAccessPerfil = modulesAccess.perfil && !documentsAccessLoading;
  const resolvedWithoutUser = !isLoading && !isAuthenticated;
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Erro ao sair:", err);
    } finally {
      router.push("/login");
    }
  };

  if (!showNav) {
    return <>{children}</>;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 text-slate-900">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(30,64,175,0.12),transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom,_rgba(14,116,144,0.12),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.06)_1px,transparent_1px)] bg-[size:160px_160px]" />
        <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(15,23,42,0.06)_1px,transparent_1px)] bg-[size:160px_160px]" />
      </div>
      <div className="pointer-events-none absolute -left-24 top-12 h-56 w-56 rounded-full bg-sky-200/70 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-10 h-64 w-64 rounded-full bg-cyan-200/70 blur-3xl" />
      <header className="relative z-10 border-b border-slate-200/80 bg-white/80 text-slate-900 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight text-slate-900">
                {"Formul\u00e1rio Central"}
              </span>
              <span className="text-xs text-slate-500">
                Plataforma de documentos
              </span>
            </div>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/dashboard"
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                pathname === "/dashboard"
                  ? "bg-sky-500 text-white shadow-md shadow-sky-300/60"
                  : "text-slate-600 hover:bg-sky-50 hover:text-sky-700"
              }`}
            >
              <LayoutDashboard className="h-4 w-4" />
              {"Formul\u00e1rio"}
            </Link>
            {canAccessDocuments && (
              <Link
                href="/documentos"
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  pathname?.startsWith("/documentos")
                    ? "bg-sky-500 text-white shadow-md shadow-sky-300/60"
                    : "text-slate-600 hover:bg-sky-50 hover:text-sky-700"
                }`}
              >
                <FileText className="h-4 w-4" />
                Documentos
              </Link>
            )}
            {canAccessDocuments && (
              <Link
                href="/prestadores"
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  pathname?.startsWith("/prestadores")
                    ? "bg-sky-500 text-white shadow-md shadow-sky-300/60"
                    : "text-slate-600 hover:bg-sky-50 hover:text-sky-700"
                }`}
              >
                <Building2 className="h-4 w-4" />
                Prestadores
              </Link>
            )}
            {canAccessDashboards && (
              <Link
                href="/dashboard/analises"
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  pathname?.startsWith("/dashboard/analises")
                    ? "bg-sky-500 text-white shadow-md shadow-sky-300/60"
                    : "text-slate-600 hover:bg-sky-50 hover:text-sky-700"
                }`}
              >
                <BarChart3 className="h-4 w-4" />
                Dashboards
              </Link>
            )}
            {canAccessPerfil && (
              <Link
                href="/perfil"
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  pathname?.startsWith("/perfil")
                    ? "bg-sky-500 text-white shadow-md shadow-sky-300/60"
                    : "text-slate-600 hover:bg-sky-50 hover:text-sky-700"
                }`}
              >
                <UserRound className="h-4 w-4" />
                Perfil
              </Link>
            )}
            {canAccessDocuments && (
              <Link
                href="/dashboard/permissoes"
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  pathname?.startsWith("/dashboard/permissoes")
                    ? "bg-sky-500 text-white shadow-md shadow-sky-300/60"
                    : "text-slate-600 hover:bg-sky-50 hover:text-sky-700"
                }`}
              >
                <ShieldCheck className="h-4 w-4" />
                {"Permiss\u00f5es"}
              </Link>
            )}
            <button
              type="button"
              onClick={() => setIsHelpOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-sky-500 hover:bg-sky-50 hover:text-sky-700"
              aria-label="Ajuda"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              Ajuda
            </button>
            {isAuthenticated && (
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-sky-500 hover:bg-sky-50 hover:text-sky-700"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sair
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-5xl px-4 py-10">
        <div className="pointer-events-none absolute inset-4 rounded-[32px] border border-slate-200/70" />
        <div className="pointer-events-none absolute inset-0 opacity-50">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),transparent_55%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,_rgba(45,212,191,0.1),transparent_50%)]" />
        </div>
        <div className="relative flex w-full flex-col rounded-[32px] border border-slate-200 bg-white/95 p-8 text-slate-900 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur">
          {authError && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <p className="font-medium">{authError}</p>
              <button
                type="button"
                onClick={() => refresh()}
                className="mt-2 text-amber-700 underline underline-offset-2"
              >
                Tentar novamente
              </button>
            </div>
          )}
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
              Carregando sessão...
            </div>
          ) : resolvedWithoutUser ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-slate-500">
              <p>Sessão expirada. Faça login novamente para continuar.</p>
              <button
                type="button"
                onClick={() => router.push("/login")}
                className="rounded-full bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-sky-300/80 transition hover:bg-sky-400"
              >
                Ir para login
              </button>
            </div>
          ) : (
            children
          )}
        </div>
      </main>

      {isHelpOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Ajuda
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  Como usar o sistema
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsHelpOpen(false)}
                className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                aria-label="Fechar ajuda"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 grid gap-4 text-sm text-slate-600 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{"Formul\u00e1rio"}</p>
                <ul className="mt-2 space-y-1">
                  <li>Escolha o tipo de formulário e envie os documentos.</li>
                  <li>Use o prestador correto ao preencher as informações.</li>
                  <li>Consulte o histórico de envios do seu grupo.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Documentos
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Veja documentos enviados e seus status.</li>
                  <li>Filtre por tipo, período e prestador.</li>
                  <li>Abra, baixe ou assine quando aplicável.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Prestadores
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Cadastre prestadores com nome, tipo e CNPJ.</li>
                  <li>Adicione e-mails autorizados por prestador.</li>
                  <li>Crie regras de monitoramento por período.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Dashboards
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Acompanhe volume de envios e metas.</li>
                  <li>Analise por mês, ano e tipo de serviço.</li>
                  <li>Use os gráficos para identificar tendências.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {"Permiss\u00f5es"}</p>
                <ul className="mt-2 space-y-1">
                  <li>Conceda acesso por módulo e e-mail.</li>
                  <li>Revise permissões periodicamente.</li>
                  <li>Remova acessos quando necessário.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Perfil
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Gerencie assinatura e dados pessoais.</li>
                  <li>Atualize suas preferências quando precisar.</li>
                </ul>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setIsHelpOpen(false)}
                className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

