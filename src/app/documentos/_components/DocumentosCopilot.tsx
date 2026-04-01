"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, LoaderCircle, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import type {
  DocumentoCopilotFilters,
  DocumentoCopilotMatch,
} from "@/lib/documentosCopilot";

export type DocumentosCopilotProps = {
  currentFilters: DocumentoCopilotFilters;
  onApplyFilters: (filters: DocumentoCopilotFilters) => void;
};

type CopilotResponse = {
  reply: string;
  summary: string;
  filters: DocumentoCopilotFilters;
  results: DocumentoCopilotMatch[];
  total: number;
  error?: string;
};

const SUGESTOES = [
  "Ache o laudo do prestador com observações em dezembro",
  "Me mostre notas fiscais da loja 123",
  "Procure documentos assinados desta semana",
];

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleDateString("pt-BR");
};

export function DocumentosCopilot({
  currentFilters,
  onApplyFilters,
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
    <section className="hidden overflow-hidden rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(15,23,42,0.92))] text-white shadow-2xl shadow-slate-900/10 xl:fixed xl:right-8 xl:top-6 xl:z-20 xl:block xl:w-[380px] xl:max-h-[calc(100vh-3rem)] xl:overflow-auto">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100">
              <Bot className="h-3.5 w-3.5" />
              Copilot de documentos
            </div>
            <h2 className="mt-3 text-lg font-semibold text-white">
              Encontrar um documento ficou mais rápido
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-300">
              Descreva o que você procura em linguagem natural e eu monto a
              busca para você.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right text-xs text-slate-300">
            <p className="font-semibold text-white">Busca guiada</p>
            <p className="mt-1">Acesso respeita suas permissões atuais.</p>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        <div className="grid gap-2">
          {SUGESTOES.map((sugestao) => (
            <button
              key={sugestao}
              type="button"
              onClick={() => void submit(sugestao)}
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left text-xs leading-5 text-slate-200 transition hover:border-cyan-300/40 hover:bg-cyan-400/10 hover:text-white"
            >
              {sugestao}
            </button>
          ))}
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Pergunta
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ex.: encontre as notas fiscais da loja 302 de março"
            className="mt-2 min-h-28 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
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
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-xs leading-5 text-slate-300">
                {response.summary}
              </div>
            </div>

            <div className="grid gap-3">
              {response.results.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 transition hover:border-cyan-300/30 hover:bg-slate-950/70"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {item.nome}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">
                        {item.identificacao}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-[11px] font-semibold text-slate-200">
                      {item.status}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-slate-300">
                    <p>
                      Tipo: <span className="text-slate-100">{item.tipo}</span>
                    </p>
                    <p>
                      Enviado em:{" "}
                      <span className="text-slate-100">
                        {formatDate(item.created_at)}
                      </span>
                    </p>
                    {item.lojaNome && (
                      <p>
                        Loja:{" "}
                        <span className="text-slate-100">{item.lojaNome}</span>
                      </p>
                    )}
                    {item.prestadorNome && (
                      <p>
                        Prestador:{" "}
                        <span className="text-slate-100">
                          {item.prestadorNome}
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => router.push(`/documentos/${item.id}`)}
                      className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-white/5"
                    >
                      Abrir
                    </button>
                    <button
                      type="button"
                      onClick={() => onApplyFilters(response.filters)}
                      className="rounded-full bg-cyan-400 px-3 py-1 text-[11px] font-semibold text-slate-950 transition hover:bg-cyan-300"
                    >
                      Aplicar filtros
                    </button>
                  </div>
                </div>
              ))}
              {response.results.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/15 px-4 py-6 text-sm text-slate-300">
                  Nenhum documento encontrado com essa busca.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">
            Como funciona
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
            <li>1. Você escreve a intenção em português, do jeito natural.</li>
            <li>2. O copilot traduz isso para filtros de documento.</li>
            <li>3. A busca respeita as mesmas permissões do restante do sistema.</li>
            <li>4. Depois você pode aplicar os filtros na tela principal.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
