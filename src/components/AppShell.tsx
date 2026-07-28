"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  FileText,
  Bot,
  LogOut,
  UserRound,
  BarChart3,
  ShieldCheck,
  Building2,
  Store,
  FolderOpen,
  HelpCircle,
  Menu,
  CircleAlert,
  MailWarning,
  FileCheck2,
  ClipboardSignature,
  FileSignature,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabaseClient";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { useIsAprovadorInterno } from "@/hooks/useIsAprovadorInterno";
import { SimulacaoControl, SimulacaoBanner } from "@/components/SimulacaoControl";
import { GlobalSearch } from "@/components/GlobalSearch";
import { useAccessibleDialog } from "@/hooks/useAccessibleDialog";

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, error: authError, refresh } = useAuth();
  const {
    isAdmin,
    role,
    modules: modulesAccess,
    loading: documentsAccessLoading,
  } = useDocumentsAccess();
  const { isAprovadorInterno, loading: aprovadorLoading } =
    useIsAprovadorInterno();
  const publicRoutes = new Set(["/login", "/redefinir-senha"]);
  const showNav = !publicRoutes.has(pathname ?? "");
  const isDocumentsRoute = pathname?.startsWith("/documentos");
  const isCopilotRoute = pathname?.startsWith("/copilot");

  const isAuthenticated = !!user;
  const canAccessDocuments =
    modulesAccess.documentos && !documentsAccessLoading;
  const canAccessCobrancas =
    (isAdmin || role === "gerente_loja") && !documentsAccessLoading;
  const canAccessConservacao =
    (isAdmin || isAprovadorInterno) &&
    !documentsAccessLoading &&
    !aprovadorLoading;
  const canAccessDashboards = isAdmin && !documentsAccessLoading;
  const canAccessPerfil = isAdmin && !documentsAccessLoading;
  const resolvedWithoutUser = !isLoading && !isAuthenticated;
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDocumentsMenuOpen, setIsDocumentsMenuOpen] = useState(
    Boolean(isDocumentsRoute),
  );
  const helpDialogRef = useAccessibleDialog<HTMLDivElement>(
    isHelpOpen,
    () => setIsHelpOpen(false),
  );

  useEffect(() => {
    if (isDocumentsRoute) setIsDocumentsMenuOpen(true);
  }, [isDocumentsRoute]);

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

  const navGroups = [
    {
      title: "Operação",
      items: [
        {
          href: "/dashboard",
          label: "Início",
          icon: LayoutDashboard,
          isActive: pathname === "/dashboard",
          isVisible: canAccessDocuments,
        },
        {
          href: "/documentos",
          label: "Documentos",
          icon: FileText,
          isActive:
            pathname?.startsWith("/documentos") &&
            !pathname?.startsWith("/documentos/por-loja") &&
            !pathname?.startsWith("/documentos/pendencias") &&
            !pathname?.startsWith("/documentos/cobrancas") &&
            !pathname?.startsWith("/documentos/btracker") &&
            !pathname?.startsWith("/documentos/orcamentos-internos") &&
            !pathname?.startsWith("/documentos/contratos") &&
            !pathname?.startsWith("/documentos/conservacao"),
          isVisible: canAccessDocuments,
        },
        {
          href: "/documentos/contratos",
          label: "Contratos",
          icon: FileSignature,
          isActive: pathname?.startsWith("/documentos/contratos"),
          isVisible: isAdmin && !documentsAccessLoading,
        },
        {
          href: "/documentos/conservacao",
          label: "Conservação",
          icon: Sparkles,
          isActive: pathname?.startsWith("/documentos/conservacao"),
          isVisible: canAccessConservacao,
        },
        {
          href: "/documentos/orcamentos-internos",
          label: "Orçamentos internos",
          icon: ClipboardSignature,
          isActive: pathname?.startsWith("/documentos/orcamentos-internos"),
          isVisible: canAccessDocuments,
        },
        {
          href: "/documentos/por-loja",
          label: "Por loja",
          icon: FolderOpen,
          isActive: pathname?.startsWith("/documentos/por-loja"),
          isVisible: canAccessDocuments,
        },
        {
          href: "/documentos/pendencias",
          label: "Pendências",
          icon: CircleAlert,
          isActive: pathname?.startsWith("/documentos/pendencias"),
          isVisible: canAccessDocuments,
        },
        {
          href: "/documentos/cobrancas",
          label: "Cobranças",
          icon: MailWarning,
          isActive: pathname?.startsWith("/documentos/cobrancas"),
          isVisible: canAccessCobrancas,
        },
        {
          href: "/documentos/btracker",
          label: "NFS-e BTracker",
          icon: FileCheck2,
          isActive: pathname?.startsWith("/documentos/btracker"),
          isVisible: isAdmin,
        },
        {
          href: "/copilot",
          label: "Copiloto",
          icon: Bot,
          isActive: pathname?.startsWith("/copilot"),
          isVisible: canAccessDocuments,
        },
      ],
    },
    {
      title: "Administração",
      items: [
        {
          href: "/usuarios",
          label: "Usuários",
          icon: ShieldCheck,
          isActive: pathname?.startsWith("/usuarios"),
          isVisible: isAdmin,
        },
        {
          href: "/lojas",
          label: "Lojas",
          icon: Store,
          isActive: pathname?.startsWith("/lojas"),
          isVisible: isAdmin,
        },
        {
          href: "/prestadores",
          label: "Prestadores",
          icon: Building2,
          isActive: pathname?.startsWith("/prestadores"),
          isVisible: isAdmin,
        },
      ],
    },
    {
      title: "Análises",
      items: [
        {
          href: "/dashboard/analises",
          label: "Gráficos",
          icon: BarChart3,
          isActive: pathname?.startsWith("/dashboard/analises"),
          isVisible: canAccessDashboards,
        },
      ],
    },
    {
      title: "Conta",
      items: [
        {
          href: "/perfil",
          label: "Perfil",
          icon: UserRound,
          isActive: pathname?.startsWith("/perfil"),
          isVisible: canAccessPerfil,
        },
      ],
    },
  ];
  const documentSubItems = navGroups[0].items.filter(
    (item) => item.href.startsWith("/documentos/") && item.href !== "/documentos",
  );

  return (
    <div
      className={`relative min-h-screen overflow-hidden ${
        isCopilotRoute
          ? "bg-[#050816] text-white"
          : "bg-[var(--app-bg)] text-slate-900"
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-0 ${
          isCopilotRoute
            ? "bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.14),transparent_42%)]"
            : "bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.08),transparent_50%)]"
        }`}
      />
      <div
        className={`pointer-events-none absolute inset-0 ${
          isCopilotRoute
            ? "bg-[radial-gradient(circle_at_bottom,_rgba(15,23,42,0.2),transparent_55%)]"
            : "bg-[radial-gradient(circle_at_bottom,_rgba(15,23,42,0.05),transparent_55%)]"
        }`}
      />
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div
          className={`absolute inset-0 ${
            isCopilotRoute
              ? "bg-[linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)]"
              : "bg-[linear-gradient(90deg,rgba(15,23,42,0.06)_1px,transparent_1px)]"
          } bg-[size:160px_160px]`}
        />
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
          className={`fixed left-0 top-0 z-40 flex h-screen w-72 flex-col overflow-x-hidden overflow-y-auto bg-[var(--app-sidebar)] text-slate-700 shadow-2xl shadow-slate-200/70 backdrop-blur transition-all ${
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          } ${isSidebarCollapsed ? "md:w-20" : "md:w-72"} md:translate-x-0`}
        >
          <div
            className={`flex items-center justify-between px-6 pb-4 pt-6 ${
              isSidebarCollapsed ? "md:px-3" : ""
            }`}
          >
            <Link
              href="/dashboard"
              className="flex items-center gap-3 text-left"
              onClick={() => setIsSidebarOpen(false)}
            >
              <div className="flex h-10 w-10 items-center justify-center">
                <Image
                  src="/Letra _b_ em azul vibrante.png"
                  alt="Logo da Bemol"
                  width={40}
                  height={40}
                  className="h-9 w-9 object-contain"
                  priority
                />
              </div>
              <div className={isSidebarCollapsed ? "md:hidden" : ""}>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-700">
                  Central de Documentos
                </p>
                <p className="text-[11px] text-slate-500">
                  Fluxo de documentos
                </p>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-full bg-slate-100/80 p-2 text-slate-600 hover:bg-slate-200 md:hidden"
                onClick={() => setIsSidebarOpen(false)}
                aria-label="Fechar menu"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="hidden rounded-full bg-slate-100/80 p-2 text-slate-600 transition hover:bg-slate-200 md:inline-flex"
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                aria-label={
                  isSidebarCollapsed ? "Expandir menu" : "Recolher menu"
                }
              >
                {isSidebarCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <nav
            className={`flex flex-1 flex-col gap-4 px-4 ${
              isSidebarCollapsed ? "md:px-2" : ""
            }`}
          >
            <div className="mb-1">
              <GlobalSearch collapsed={isSidebarCollapsed} />
            </div>
            {navGroups.map((group) => {
              const visibleItems = group.items.filter(
                (item) =>
                  item.isVisible &&
                  !(
                    group.title === "Operação" &&
                    item.href.startsWith("/documentos/") &&
                    item.href !== "/documentos"
                  ),
              );
              if (visibleItems.length === 0) {
                return null;
              }
              return (
                <div key={group.title} className="space-y-1">
                  <p
                    className={`px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 ${
                      isSidebarCollapsed ? "md:hidden" : ""
                    }`}
                  >
                    {group.title}
                  </p>
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    const isDocumentsParent = item.href === "/documentos";
                    const isActive = isDocumentsParent
                      ? Boolean(isDocumentsRoute)
                      : item.isActive;
                    return (
                      <div key={item.href}>
                        <div className="flex items-center gap-1">
                          <Link
                            href={item.href}
                            onClick={() => setIsSidebarOpen(false)}
                            className={`group flex min-w-0 flex-1 items-center rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                              isActive
                                ? "bg-[var(--app-surface)] text-slate-900 shadow-lg shadow-slate-200/70"
                                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            } ${isSidebarCollapsed ? "gap-3 md:justify-center md:gap-0" : "gap-3"}`}
                            title={isSidebarCollapsed ? item.label : undefined}
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center text-slate-600 group-hover:text-sky-700">
                              <Icon className="h-5 w-5" aria-hidden="true" />
                            </span>
                            <span className={isSidebarCollapsed ? "md:hidden" : ""}>
                              {item.label}
                            </span>
                          </Link>
                          {isDocumentsParent && !isSidebarCollapsed ? (
                            <button
                              type="button"
                              onClick={() => setIsDocumentsMenuOpen((current) => !current)}
                              className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                              aria-label={isDocumentsMenuOpen ? "Recolher submenu de documentos" : "Expandir submenu de documentos"}
                              aria-expanded={isDocumentsMenuOpen}
                              aria-controls="documents-submenu"
                            >
                              <ChevronDown
                                className={`h-4 w-4 transition ${isDocumentsMenuOpen ? "rotate-180" : ""}`}
                              />
                            </button>
                          ) : null}
                        </div>
                        {isDocumentsParent && isDocumentsMenuOpen && !isSidebarCollapsed ? (
                          <div id="documents-submenu" className="ml-7 mt-1 space-y-1 border-l border-slate-200 pl-3">
                            {documentSubItems
                              .filter((subItem) => subItem.isVisible)
                              .map((subItem) => {
                                const SubIcon = subItem.icon;
                                return (
                                  <Link
                                    key={subItem.href}
                                    href={subItem.href}
                                    onClick={() => setIsSidebarOpen(false)}
                                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                                      subItem.isActive
                                        ? "bg-sky-50 text-sky-800"
                                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                                    }`}
                                  >
                                    <SubIcon className="h-4 w-4" aria-hidden="true" />
                                    {subItem.label}
                                  </Link>
                                );
                              })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          <div className={`px-4 pb-6 pt-4 ${isSidebarCollapsed ? "md:px-2" : ""}`}>
            <div className={isSidebarCollapsed ? "hidden md:grid gap-2" : "hidden"}>
              <button
                type="button"
                onClick={() => setIsHelpOpen(true)}
                className="inline-flex items-center justify-center rounded-2xl bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                aria-label="Ajuda rápida"
              >
                <HelpCircle className="h-4 w-4 text-sky-600" />
              </button>
              {isAuthenticated && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                  aria-label="Sair"
                >
                  <LogOut className="h-4 w-4 text-sky-600" />
                </button>
              )}
            </div>
            <div className={isSidebarCollapsed ? "md:hidden" : ""}>
              <div className="rounded-2xl bg-slate-100/80 px-4 py-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-700">Sessão ativa</p>
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
                  Ajuda rápida
                  <HelpCircle className="h-4 w-4 text-sky-600" />
                </button>
                <SimulacaoControl canStart={isAdmin} />
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
          </div>
        </aside>

        <div
          className={`flex min-h-screen min-w-0 flex-1 flex-col ${
            isSidebarCollapsed ? "md:pl-20" : "md:pl-72"
          } ${isCopilotRoute ? "bg-transparent" : ""}`}
        >
          <header className="sticky top-0 z-20 flex items-center justify-between bg-[#f6f2ec]/80 px-4 py-3 backdrop-blur md:hidden">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-sky-200/60"
            >
              <Menu className="h-4 w-4" />
              Menu
            </button>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              <Image
                src="/Letra _b_ em azul vibrante.png"
                alt="Logo da Bemol"
                width={24}
                height={24}
                className="h-6 w-6 object-contain"
              />
              <span>Central de Documentos</span>
            </div>
          </header>

          <SimulacaoBanner />

          <main
            className={`relative min-w-0 flex-1 px-4 pb-10 pt-6 md:px-8 ${
              isCopilotRoute ? "bg-transparent" : ""
            }`}
          >
            <div
              className={`mx-auto flex min-w-0 w-full flex-1 ${
                isDocumentsRoute
                  ? "max-w-[1700px]"
                  : isCopilotRoute
                    ? "max-w-[1500px]"
                    : "max-w-6xl"
              }`}
            >
              <div
                className={`relative min-w-0 w-full p-6 ${
                  isCopilotRoute
                    ? "overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,31,0.96),rgba(11,18,34,0.92))] text-white shadow-[0_28px_80px_rgba(2,6,23,0.55)]"
                    : "rounded-[28px] bg-white/95 shadow-[0_28px_70px_rgba(148,163,184,0.25)]"
                }`}
              >
                {authError && (
                  <div
                    className={`mb-4 rounded-2xl px-4 py-3 text-xs ${
                      isCopilotRoute
                        ? "border border-cyan-400/20 bg-cyan-400/10 text-cyan-50"
                        : "bg-amber-50 text-amber-900"
                    }`}
                  >
                    <p className="font-medium">{authError}</p>
                    <button
                      type="button"
                      onClick={() => refresh()}
                      className={`mt-2 underline underline-offset-2 ${
                        isCopilotRoute ? "text-cyan-200" : "text-amber-700"
                      }`}
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}
                {isLoading ? (
                  <div
                    className={`flex flex-1 items-center justify-center text-sm ${
                      isCopilotRoute ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    Carregando sessão...
                  </div>
                ) : resolvedWithoutUser ? (
                  <div
                    className={`flex flex-1 flex-col items-center justify-center gap-3 text-sm ${
                      isCopilotRoute ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    <p>Sessão expirada. Faça login novamente para continuar.</p>
                    <button
                      type="button"
                      onClick={() => router.push("/login")}
                      className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                        isCopilotRoute
                          ? "bg-cyan-400 text-slate-950 shadow-md shadow-cyan-950/30 hover:bg-cyan-300"
                          : "bg-sky-600 text-white shadow-md shadow-sky-200/60 hover:bg-sky-500"
                      }`}
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
          <div
            ref={helpDialogRef}
            tabIndex={-1}
            className="w-full max-w-3xl rounded-3xl bg-white p-6 text-slate-900 shadow-xl outline-none"
          >
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
                  {"Formulário"}
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Escolha o tipo de formulário e envie os documentos.</li>
                  <li>Use o prestador correto ao preencher as informações.</li>
                  <li>Consulte o histórico de envios do seu grupo.</li>
                </ul>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Documentos
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Veja documentos enviados e seus status.</li>
                  <li>Filtre por tipo, período e prestador.</li>
                  <li>Abra, baixe ou assine quando aplicável.</li>
                </ul>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Prestadores
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Cadastre prestadores com nome, tipo e CNPJ.</li>
                  <li>Adicione e-mails autorizados por prestador.</li>
                  <li>Crie regras de monitoramento por período.</li>
                </ul>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Dashboards
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Acompanhe volume de envios e metas.</li>
                  <li>Analise por mês, ano e tipo de serviço.</li>
                  <li>Use os gráficos para identificar tendências.</li>
                </ul>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Usuários
                </p>
                <ul className="mt-2 space-y-1">
                  <li>Defina quem é administrador ou colaborador.</li>
                  <li>Edite funções para liberar acessos.</li>
                  <li>Revise usuários periodicamente.</li>
                </ul>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
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


