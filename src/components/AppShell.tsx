"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { LayoutDashboard, FileText, Lock, LogOut } from "lucide-react";

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [canAccessDocuments, setCanAccessDocuments] = useState(false);

  useEffect(() => {
    const isMounted = { current: true };

    const checkSession = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted.current) return;

      setIsAuthenticated(!!user);

       const email = user?.email?.toLowerCase() ?? "";
       const isBemolEmail = email.endsWith("@bemol.com.br");
       setCanAccessDocuments(isBemolEmail);
      setIsLoadingUser(false);
    };

    void checkSession();

    return () => {
      isMounted.current = false;
    };
  }, []);

  const showNav = pathname !== "/login";

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 text-slate-900">
      {showNav && (
        <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-slate-900 shadow-sm shadow-sky-400/40 ring-2 ring-sky-100">
                <Image
                  src="/formulario-central-icon.png"
                  alt="Formulário Central"
                  fill
                  sizes="40px"
                  className="object-contain p-1.5"
                />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-semibold tracking-tight text-slate-900">
                  Formulário Central
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
                    ? "bg-slate-900 text-slate-50 shadow-sm shadow-slate-400/40"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <LayoutDashboard className="h-4 w-4" />
                Formulários
              </Link>
              {canAccessDocuments ? (
                <Link
                  href="/documentos"
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    pathname?.startsWith("/documentos")
                      ? "bg-slate-900 text-slate-50 shadow-sm shadow-slate-400/40"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <FileText className="h-4 w-4" />
                  Documentos
                </Link>
              ) : (
                <button
                  type="button"
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-slate-400"
                  title="Área restrita. Procure por richardoliveira@bemol.com para solicitar acesso."
                >
                  <Lock className="h-4 w-4" />
                  Documentos
                </button>
              )}
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
      )}

      <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-5xl flex-col px-4 py-8">
        {isLoadingUser && showNav ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            Carregando sessão...
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
