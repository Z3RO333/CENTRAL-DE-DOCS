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
  Menu,
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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

  const navItems = [
    {
      href: "/dashboard",
      label: "Formularios",
      icon: LayoutDashboard,
      isActive: pathname === "/dashboard",
      isVisible: true,
    },
    {
      href: "/documentos",
      label: "Documentos",
      icon: FileText,
      isActive: pathname?.startsWith("/documentos"),
      isVisible: canAccessDocuments,
    },
    {
      href: "/prestadores",
      label: "Prestadores",
      icon: Building2,
      isActive: pathname?.startsWith("/prestadores"),
      isVisible: canAccessDocuments,
    },
    {
      href: "/dashboard/analises",
      label: "Dashboards",
      icon: BarChart3,
      isActive: pathname?.startsWith("/dashboard/analises"),
      isVisible: canAccessDashboards,
    },
    {
      href: "/dashboard/permissoes",
      label: "Permissoes",
      icon: ShieldCheck,
      isActive: pathname?.startsWith("/dashboard/permissoes"),
      isVisible: canAccessDocuments,
    },
    {
      href: "/perfil",
      label: "Perfil",
      icon: UserRound,
      isActive: pathname?.startsWith("/perfil"),
      isVisible: canAccessPerfil,
    },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--app-bg)] text-slate-900">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.08),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom,_rgba(15,23,42,0.05),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.06)_1px,transparent_1px)] bg-[size:160px_160px]" />
      </div>

      <div className="relative z-10 flex min-h-screen">
        <div
          className={`fixed inset-0 z-30 bg-slate-100/70 transition md:hidden ${
            isSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />

        <aside
          className={`fixed left-0 top-0 z-40 flex h-screen w-72 flex-col overflow-y-auto bg-[var(--app-sidebar)] text-slate-700 shadow-2xl shadow-slate-200/70 backdrop-blur transition-transform md:sticky md:translate-x-0 ${
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-6 pb-4 pt-6">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 text-left"
              onClick={() => setIsSidebarOpen(false)}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 via-white to-slate-200 text-slate-700 shadow-lg shadow-slate-200/60">
                <LayoutDashboard className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-700">
                  Central
                </p>
                <p className="text-[11px] text-slate-500">
                  Fluxo de documentos
                </p>
              </div>
            </Link>
            <button
              type="button"
              className="rounded-full bg-slate-100/80 p-2 text-slate-600 hover:bg-slate-200 md:hidden"
              onClick={() => setIsSidebarOpen(false)}
              aria-label="Fechar menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-1 px-4">
            {navItems
              .filter((item) => item.isVisible)
              .map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsSidebarOpen(false)}
                    className={`group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                      item.isActive
                        ? "bg-[var(--app-surface)] text-slate-900 shadow-lg shadow-slate-200/70"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                        item.isActive
                          ? "bg-sky-100 text-sky-700"
                          : "bg-slate-100 text-slate-600 group-hover:text-sky-700"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    {item.label}
                  </Link>
                );
              })}
          </nav>

          <div className="px-4 pb-6 pt-4">
            <div className="rounded-2xl bg-slate-100/80 px-4 py-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-700">Sessao ativa</p>
              <p className="mt-1 truncate text-[11px] text-slate-500">
                {user?.email ?? "Visitante"}
              </p>
            </div>
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                onClick={() => setIsHelpOpen(true)}
                className="inline-flex items-center justify-between rounded-2xl bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Ajuda rapida
                <HelpCircle className="h-4 w-4 text-sky-600" />
              </button>
              {isAuthenticated && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center justify-between rounded-2xl bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Sair
                  <LogOut className="h-4 w-4 text-sky-600" />
                </button>
              )}
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="sticky top-0 z-20 flex items-center justify-between bg-[#f6f2ec]/80 px-4 py-3 backdrop-blur md:hidden">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-sky-200/60"
            >
              <Menu className="h-4 w-4" />
              Menu
            </button>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Formulario Central
            </span>
          </header>

          <main className="relative flex-1 px-4 pb-10 pt-6 md:px-8">
            <div className="mx-auto flex w-full max-w-6xl flex-1">
              <div className="relative w-full rounded-[28px] bg-white/95 p-6 shadow-[0_28px_70px_rgba(148,163,184,0.25)]">
                {authError && (
                  <div className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
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
                    Carregando sessao...
                  </div>
                ) : resolvedWithoutUser ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-slate-500">
                    <p>Sessao expirada. Faca login novamente para continuar.</p>
                    <button
                      type="button"
                      onClick={() => router.push("/login")}
                      className="rounded-full bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-sky-200/60 transition hover:bg-sky-500"
                    >
                      Ir para login
                    </button>
                  </div>
                ) : (
                  children
                )}
              </div>
            </div>
          </main>
        </div>
      </div>

      {isHelpOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-100/80 px-4 py-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl rounded-3xl bg-white p-6 text-slate-900 shadow-xl">
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
                className="rounded-full bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200"
                aria-label="Fechar ajuda"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 grid gap-4 text-sm text-slate-600 lg:grid-cols-2">
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {"Formulario"}
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Escolha o tipo de formulario e envie os documentos.</li>
                  <li>Use o prestador correto ao preencher as informacoes.</li>
                  <li>Consulte o historico de envios do seu grupo.</li>
                </ul>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Documentos
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Veja documentos enviados e seus status.</li>
                  <li>Filtre por tipo, periodo e prestador.</li>
                  <li>Abra, baixe ou assine quando aplicavel.</li>
                </ul>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Prestadores
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Cadastre prestadores com nome, tipo e CNPJ.</li>
                  <li>Adicione e-mails autorizados por prestador.</li>
                  <li>Crie regras de monitoramento por periodo.</li>
                </ul>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Dashboards
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Acompanhe volume de envios e metas.</li>
                  <li>Analise por mes, ano e tipo de servico.</li>
                  <li>Use os graficos para identificar tendencias.</li>
                </ul>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {"Permissoes"}
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Conceda acesso por modulo e e-mail.</li>
                  <li>Revise permissoes periodicamente.</li>
                  <li>Remova acessos quando necessario.</li>
                </ul>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Perfil
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Gerencie assinatura e dados pessoais.</li>
                  <li>Atualize suas preferencias quando precisar.</li>
                </ul>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setIsHelpOpen(false)}
                className="rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-500"
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
