"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function RedefinirSenhaPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const checkSession = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();

      if (!isMounted) {
        return;
      }

      if (sessionError) {
        setError("Nao conseguimos validar o link. Solicite um novo envio.");
        setHasRecoverySession(false);
      } else {
        setHasRecoverySession(!!data.session);
      }

      setIsCheckingSession(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        setHasRecoverySession(true);
        setError(null);
      }
    });

    void checkSession();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFeedback(null);

    if (password.length < 6) {
      setError("A nova senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("As senhas informadas nao conferem.");
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(updateError.message);
        return;
      }

      await supabase.auth.signOut();
      setFeedback("Senha alterada com sucesso. Voce ja pode fazer login.");
      setPassword("");
      setConfirmPassword("");
      setHasRecoverySession(false);
    } catch (err) {
      console.error("Erro ao redefinir senha:", err);
      setError("Falha inesperada ao redefinir a senha. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const isFormDisabled = loading || isCheckingSession || !hasRecoverySession;

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-slate-50 px-4 py-12 text-slate-900 lg:py-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(30,64,175,0.12),transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom,_rgba(14,116,144,0.12),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.06)_1px,transparent_1px)] bg-[size:160px_160px]" />
        <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(15,23,42,0.06)_1px,transparent_1px)] bg-[size:160px_160px]" />
      </div>

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
            Central de Documentos
          </h1>
          <p className="text-xs text-slate-500 sm:text-sm">
            Defina uma nova senha para acessar o portal.
          </p>
        </div>

        <div className="relative w-full">
          <div className="absolute inset-0 -z-10 rounded-[26px] bg-gradient-to-br from-sky-200/50 via-white/30 to-cyan-200/40 blur-2xl" />
          <div className="relative rounded-[22px] border border-slate-200 bg-white/95 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur sm:p-8">
            <div className="mb-5 flex items-center justify-between text-xs text-slate-500">
              <span className="uppercase tracking-[0.2em]">Senha</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold text-slate-600">
                Portal interno
              </span>
            </div>

            <h2 className="mb-4 text-base font-semibold text-slate-900">
              Criar nova senha
            </h2>

            {isCheckingSession ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Validando link de redefinicao...
              </p>
            ) : null}

            {!isCheckingSession && !hasRecoverySession && !feedback ? (
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Link invalido ou expirado. Volte ao login e solicite uma nova
                redefinicao de senha.
              </p>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="space-y-2 text-sm">
                <label htmlFor="password" className="block text-slate-700">
                  Nova senha
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none ring-sky-400/40 placeholder:text-slate-400 focus:border-sky-400 focus:ring disabled:bg-slate-50"
                  placeholder="Minimo 6 caracteres"
                  disabled={isFormDisabled}
                />
              </div>

              <div className="space-y-2 text-sm">
                <label
                  htmlFor="confirm-password"
                  className="block text-slate-700"
                >
                  Confirmar senha
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none ring-sky-400/40 placeholder:text-slate-400 focus:border-sky-400 focus:ring disabled:bg-slate-50"
                  placeholder="Repita a nova senha"
                  disabled={isFormDisabled}
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
                disabled={isFormDisabled}
                className="flex w-full items-center justify-center rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-sky-400/40 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? "Salvando..." : "Salvar nova senha"}
              </button>
            </form>

            <Link
              href="/login"
              className="mt-4 block w-full text-center text-xs text-slate-500 hover:text-sky-500"
            >
              Voltar para login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
