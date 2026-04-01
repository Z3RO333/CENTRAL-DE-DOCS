"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, LoaderCircle, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import type {
  DocumentoCopilotFilters,
  DocumentoCopilotInsights,
  DocumentoCopilotMatch,
} from "@/lib/documentosCopilot";

export type DocumentosCopilotProps = {
  currentFilters: DocumentoCopilotFilters;
};

type CopilotResponse = {
  reply: string;
  summary: string;
  filters: DocumentoCopilotFilters;
  results: DocumentoCopilotMatch[];
  total: number;
  insights: DocumentoCopilotInsights;
  error?: string;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleDateString("pt-BR");
};

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

export function DocumentosCopilot({
  currentFilters,
}: DocumentosCopilotProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<CopilotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getAccessToken = async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }
    const token = data.session?.access_token;
    if (!token) {
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    return token;
  };

  const insights = response?.insights;
  const maxStatus = Math.max(
    ...(insights?.porStatus.map((item) => item.total) ?? [0]),
    1,
  );
  const maxLoja = Math.max(
    ...(insights?.porLoja.map((item) => item.total) ?? [0]),
    1,
  );
  const maxTrend = Math.max(
    ...(insights?.tendenciaMensal.map((item) => item.total) ?? [0]),
    1,
  );

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    setMessage(trimmed);
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const token = await getAccessToken();
      const res = await fetch("/api/documentos/copilot", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmed,
          currentFilters,
        }),
      });

      const payload = (await res.json()) as CopilotResponse;
      if (!res.ok) {
        throw new Error(
          payload.error ?? "Não foi possível consultar o copilot.",
        );
      }

      setResponse(payload);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível consultar o copilot.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,31,0.98),rgba(11,18,34,0.94))] text-white shadow-[0_22px_60px_rgba(2,6,23,0.45)]">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
          <Bot className="h-3.5 w-3.5" />
          Copiloto de documentos
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Pergunta
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ex.: encontre as notas fiscais da loja 302 de março"
            className="mt-2 min-h-32 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void submit(message)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {loading ? "Buscando..." : "Perguntar ao copilot"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMessage("");
              setResponse(null);
              setError(null);
            }}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/5"
          >
            Limpar
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        {response && (
          <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Resposta
              </p>
              <p className="text-sm text-slate-100">{response.reply}</p>
              <p className="text-xs leading-5 text-slate-300">{response.summary}</p>
            </div>

            {insights && insights.totalDocumentos > 0 && (
              <div className="space-y-4 rounded-3xl border border-white/10 bg-slate-950/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Leitura rápida
                    </p>
                    <p className="text-[11px] text-slate-400">
                      O copilot resumiu o cenário com base nos documentos encontrados.
                    </p>
                  </div>
                  {insights.isTruncated && (
                    <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold text-amber-100">
                      Análise parcial
                    </span>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Documentos
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-white">
                      {insights.totalDocumentos}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Lojas
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-white">
                      {insights.totalLojas}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Pendentes
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-white">
                      {insights.totalPendentes}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Assinados
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-white">
                      {insights.totalAssinados}
                    </p>
                  </div>
                </div>

                {insights.observacoes.length > 0 && (
                  <div className="space-y-2 rounded-2xl border border-cyan-400/10 bg-cyan-400/5 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-100">
                      Análise
                    </p>
                    <div className="space-y-1 text-sm text-slate-100">
                      {insights.observacoes.map((item) => (
                        <p key={item}>{item}</p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Por status
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Distribuição do conjunto analisado
                      </p>
                    </div>
                    <div className="mt-3 space-y-3">
                      {insights.porStatus.map((item) => (
                        <div key={item.key}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-200">{item.label}</span>
                            <span className="font-semibold text-white">
                              {item.total} ({formatPercent(item.percentual)})
                            </span>
                          </div>
                          <div className="mt-1 h-2 rounded-full bg-white/5">
                            <div
                              className="h-full rounded-full bg-cyan-400"
                              style={{
                                width: `${Math.max((item.total / maxStatus) * 100, 6)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Por loja
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Top 5 lojas mais recorrentes
                      </p>
                    </div>
                    <div className="mt-3 space-y-3">
                      {insights.porLoja.map((item) => (
                        <div key={item.key}>
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate text-slate-200">
                              {item.label}
                            </span>
                            <span className="shrink-0 font-semibold text-white">
                              {item.total}
                            </span>
                          </div>
                          <div className="mt-1 h-2 rounded-full bg-white/5">
                            <div
                              className="h-full rounded-full bg-emerald-400"
                              style={{
                                width: `${Math.max((item.total / maxLoja) * 100, 6)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {insights.tendenciaMensal.length > 0 && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Documentos por mês
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Volume total em cada mês observado
                      </p>
                    </div>
                    <div className="mt-4 flex items-end gap-2">
                      {insights.tendenciaMensal.map((item) => (
                        <div key={item.key} className="flex-1 text-center">
                          <div className="flex h-24 items-end">
                            <div
                              className="w-full rounded-t-xl bg-sky-400/80"
                              style={{
                                height: `${Math.max((item.total / maxTrend) * 100, 6)}%`,
                              }}
                            />
                          </div>
                          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {item.label}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {item.total} docs
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Resultados
                </p>
                <p className="text-[11px] text-slate-500">
                  {response.results.length} encontrado(s)
                </p>
              </div>
              {response.results.length > 0 ? (
                response.results.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {item.nome}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {item.identificacao}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push(`/documentos/${item.id}`)}
                      className="shrink-0 rounded-full border border-white/15 px-3 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-white/5"
                    >
                      Abrir
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/15 px-4 py-6 text-sm text-slate-300">
                  Nenhum documento encontrado com essa busca.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
