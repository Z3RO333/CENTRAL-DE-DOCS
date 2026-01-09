"use client";

import Image from "next/image";
import { Poppins } from "next/font/google";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-poppins",
});

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
          "Cadastro realizado! Confirme o seu e-mail para liberar o acesso e, em seguida, fa\u00e7a o login.",
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
    <div
      className={`${poppins.variable} relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-slate-50 px-4 py-12 text-slate-900 lg:py-16`}
      style={{ fontFamily: "var(--font-poppins)" }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(30,64,175,0.12),transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom,_rgba(14,116,144,0.12),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.06)_1px,transparent_1px)] bg-[size:160px_160px]" />
        <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(15,23,42,0.06)_1px,transparent_1px)] bg-[size:160px_160px]" />
      </div>
      <div className="pointer-events-none absolute -left-24 top-12 h-56 w-56 rounded-full bg-sky-200/70 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-10 h-64 w-64 rounded-full bg-cyan-200/70 blur-3xl" />

      <div className="relative mx-auto flex w-full max-w-md flex-col items-center gap-6 sm:gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image
            src="/Letra _b_ em azul vibrante.png"
            alt="Logo da Bemol"
            width={220}
            height={220}
            priority
            sizes="(max-width: 640px) 80px, (max-width: 1024px) 96px, 112px"
            className="h-20 w-auto object-contain drop-shadow-[0_12px_32px_rgba(14,116,144,0.25)] sm:h-24 md:h-28"
          />
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
            {"Formul\u00e1rio Bemol"}
          </h1>
          <p className="text-xs text-slate-500 sm:text-sm">
            Acesse para gerenciar documentos e assinaturas.
          </p>
        </div>

        <div className="relative w-full">
          <div className="absolute inset-0 -z-10 rounded-[26px] bg-gradient-to-br from-sky-200/50 via-white/30 to-cyan-200/40 blur-2xl" />
          <div className="relative rounded-[22px] border border-slate-200 bg-white/95 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
            <div className="mb-5 flex items-center justify-between text-xs text-slate-500">
              <span className="uppercase tracking-[0.2em]">
                {isLoginMode ? "Acesso" : "Cadastro"}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold text-slate-600">
                Portal interno
              </span>
            </div>

            <h2 className="mb-4 text-base font-semibold text-slate-900">
              {isLoginMode ? "Entrar na sua conta" : "Criar uma nova conta"}
            </h2>

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
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none ring-sky-400/40 placeholder:text-slate-400 focus:border-sky-400 focus:ring"
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
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none ring-sky-400/40 placeholder:text-slate-400 focus:border-sky-400 focus:ring"
                  placeholder="M\u00ednimo 6 caracteres"
                  disabled={isProcessing}
                />
              </div>

              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              )}
              {feedback && !error && (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  {feedback}
                </p>
              )}

              <button
                type="submit"
                disabled={isProcessing}
                className="flex w-full items-center justify-center rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-sky-400/40 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-70"
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
              className="mt-4 w-full text-center text-xs text-slate-500 hover:text-sky-500 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isLoginMode
                ? "Ainda n\u00e3o tem conta? Criar conta"
                : "J\u00e1 tem conta? Fazer login"}
            </button>

            <p className="mt-5 text-center text-[11px] text-slate-500">
              {
                "Autentica\u00e7\u00e3o gerenciada via Supabase Auth. Utilize um e-mail v\u00e1lido e confirme o cadastro pelo link enviado."
              }
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}




