"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";

export default function LoginPage() {
  const router = useRouter();
  const { user, isLoading: loadingSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!loadingSession && user) {
      router.replace("/dashboard");
    }
  }, [loadingSession, user, router]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setFeedback(null);

    try {
      if (isLoginMode) {
        const { error: signInError } =
          await supabase.auth.signInWithPassword({
            email,
            password,
          });

        if (signInError) {
          setError(signInError.message);
          return;
        }
      } else {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        setFeedback(
          "Cadastro realizado! Confirme o seu e-mail para liberar o acesso e, em seguida, faça o login.",
        );
        setIsLoginMode(true);
        return;
      }

      router.push("/dashboard");
    } catch (err) {
      console.error("Erro no login:", err);
      setError("Falha inesperada ao acessar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const isProcessing = loading || loadingSession;

  if (loadingSession && user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-100">
        Redirecionando...
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-slate-950 px-4 py-10 lg:h-screen lg:py-0">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.35),transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom,_rgba(45,212,191,0.25),transparent_40%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:140px_140px]" />
        <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:140px_140px]" />
      </div>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-0 top-1/3 h-40 w-40 -translate-x-1/2 rounded-full bg-sky-500/40 blur-3xl" />
        <div className="absolute right-0 bottom-1/3 h-52 w-52 translate-x-1/2 rounded-full bg-emerald-400/40 blur-3xl" />
        <div className="absolute left-10 top-10 h-16 w-16 animate-ping rounded-full border border-white/30" />
        <div className="absolute right-16 bottom-16 h-12 w-12 animate-pulse rounded-2xl border border-white/30" />
      </div>

      <div className="relative mx-auto flex w-full max-w-lg flex-col items-center gap-8">
        <div className="relative flex w-full justify-center">
          <Image
            src="/bemol-logo.png"
            alt="Logo da Bemol"
            width={280}
            height={140}
            priority
            className="h-auto w-56 object-contain drop-shadow-[0_10px_50px_rgba(15,23,42,0.25)]"
          />
        </div>
        <div className="relative w-full">
          <div className="absolute inset-0 -z-10 rounded-[32px] bg-gradient-to-br from-sky-400/40 via-cyan-400/20 to-emerald-400/40 blur-2xl" />
          <div className="relative rounded-[28px] border border-white/30 bg-white/95 p-8 text-slate-900 shadow-2xl shadow-slate-900/40 backdrop-blur">
            <div className="pointer-events-none absolute -left-24 -top-24 h-40 w-40 rounded-full bg-sky-100/70 blur-2xl" />
            <div className="pointer-events-none absolute -right-16 -bottom-16 h-40 w-40 rounded-full bg-sky-100/70 blur-2xl" />

              <div className="relative mb-6">
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                  Formulário Central
                </h2>
                <p className="text-xs text-slate-500">
                  Acesse para gerenciar documentos
                </p>
              </div>

              <h3 className="mb-4 text-base font-medium text-slate-900">
                {isLoginMode ? "Entrar na sua conta" : "Criar uma nova conta"}
              </h3>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2 text-sm">
                  <label htmlFor="email" className="block text-slate-700">
                    E-mail
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500/40 placeholder:text-slate-400 focus:border-sky-500 focus:ring"
                    placeholder="seuemail@empresa.com"
                    disabled={isProcessing}
                  />
                </div>
                <div className="space-y-2 text-sm">
                  <label htmlFor="password" className="block text-slate-700">
                    Senha
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500/40 placeholder:text-slate-400 focus:border-sky-500 focus:ring"
                    placeholder="Mínimo 6 caracteres"
                    disabled={isProcessing}
                  />
                </div>

                {error && (
                  <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {error}
                  </p>
                )}
                {feedback && !error && (
                  <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    {feedback}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isProcessing}
                  className="flex w-full items-center justify-center rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-sky-400/40 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isProcessing
                    ? "Enviando..."
                    : isLoginMode
                      ? "Entrar"
                      : "Criar conta"}
                </button>
              </form>

              <button
                type="button"
                onClick={() => setIsLoginMode((prev) => !prev)}
                disabled={isProcessing}
                className="mt-4 w-full text-center text-xs text-slate-400 hover:text-sky-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isLoginMode
                  ? "Ainda não tem conta? Criar conta"
                  : "Já tem conta? Fazer login"}
              </button>

              <p className="mt-6 text-center text-[11px] text-slate-500">
                Autenticacao gerenciada via Supabase Auth. Utilize um e-mail valido e confirme o cadastro pelo link enviado.
                Somente apos a confirmacao o acesso sera liberado.
              </p>
            </div>
        </div>
      </div>
    </div>
  );
}
