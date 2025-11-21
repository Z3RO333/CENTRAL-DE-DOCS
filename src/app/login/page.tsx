"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

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
      }

      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-50 px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white/90 p-8 shadow-xl shadow-slate-200">
        <div className="pointer-events-none absolute -left-24 -top-24 h-40 w-40 rounded-full bg-sky-100/70 blur-2xl" />
        <div className="pointer-events-none absolute -right-16 -bottom-16 h-40 w-40 rounded-full bg-sky-100/70 blur-2xl" />

        <div className="relative mb-6 flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-slate-900 shadow-sm shadow-sky-400/40 ring-2 ring-sky-100">
            <img
              src="/formulario-central-icon.png"
              alt="Formulário Central"
              className="h-full w-full object-contain p-1.5"
            />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">
              Formulário Central
            </h1>
            <p className="text-xs text-slate-500">
              Acesse para gerenciar documentos
            </p>
          </div>
        </div>

        <h2 className="mb-4 text-base font-medium text-slate-900">
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
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-emerald-500/40 placeholder:text-slate-400 focus:border-emerald-400 focus:ring"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500/40 placeholder:text-slate-400 focus:border-sky-500 focus:ring"
              placeholder="seuemail@empresa.com"
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
            />
          </div>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-sky-400/40 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading
              ? "Enviando..."
              : isLoginMode
                ? "Entrar"
                : "Criar conta"}
          </button>
        </form>

        <button
          type="button"
          className="mt-4 w-full text-center text-xs text-slate-400 hover:text-sky-500"
          onClick={() => setIsLoginMode((prev) => !prev)}
        >
          {isLoginMode
            ? "Ainda não tem conta? Criar conta"
            : "Já tem conta? Fazer login"}
        </button>

        <p className="mt-6 text-center text-[11px] text-slate-500">
          Autenticação gerenciada via Supabase Auth. Use um e-mail válido para
          confirmar o cadastro, se exigido nas configurações do projeto.
        </p>
      </div>
    </div>
  );
}
// Intentionally left empty; backup exists at page.backup.tsx
"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

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
      }

      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-50 px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white/90 p-8 shadow-xl shadow-slate-200">
        <div className="pointer-events-none absolute -left-24 -top-24 h-40 w-40 rounded-full bg-sky-100/70 blur-2xl" />
        <div className="pointer-events-none absolute -right-16 -bottom-16 h-40 w-40 rounded-full bg-sky-100/70 blur-2xl" />

        <div className="relative mb-6 flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-slate-900 shadow-sm shadow-sky-400/40 ring-2 ring-sky-100">
            <span className="h-full w-full bg-[url('/formulario-central-icon.png')] bg-contain bg-center bg-no-repeat p-1.5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">
              Formulário Central
            </h1>
            <p className="text-xs text-slate-500">
              Acesse para gerenciar documentos
            </p>
          </div>
        </div>

        <h2 className="mb-4 text-base font-medium text-slate-900">
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
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500/40 placeholder:text-slate-400 focus:border-sky-500 focus:ring"
              placeholder="seuemail@empresa.com"
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
            />
          </div>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-sky-400/40 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading
              ? "Enviando..."
              : isLoginMode
                ? "Entrar"
                : "Criar conta"}
          </button>
        </form>

        <button
          type="button"
          className="mt-4 w-full text-center text-xs text-slate-400 hover:text-sky-500"
          onClick={() => setIsLoginMode((prev) => !prev)}
        >
          {isLoginMode
            ? "Ainda não tem conta? Criar conta"
            : "Já tem conta? Fazer login"}
        </button>

        <p className="mt-6 text-center text-[11px] text-slate-500">
          Autenticação gerenciada via Supabase Auth. Use um e-mail válido para
          confirmar o cadastro, se exigido nas configurações do projeto.
        </p>
      </div>
    </div>
  );
}
