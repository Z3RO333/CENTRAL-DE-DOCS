// src/components/AssistenteWidget.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Bot, LoaderCircle, Send, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import {
  getSignedFileUrl,
  resolveSignedPdfPath,
} from "@/app/documentos/_lib/documentosShared";
import type {
  AssistenteDominioId,
  AssistenteInsights,
  AssistenteResultItem,
} from "@/lib/assistenteTypes";

type AssistenteApiResponse = {
  reply: string;
  dominio: AssistenteDominioId | null;
  summary: string;
  filters: Record<string, unknown>;
  filtrosUrl: string | null;
  results: AssistenteResultItem[];
  total: number;
  insights: AssistenteInsights;
  error?: string;
};

type ChatTurn =
  | { id: string; role: "user"; text: string }
  | ({ id: string; role: "assistant" } & AssistenteApiResponse);

const ROUTE_DOMINIO: { prefix: string; dominio: AssistenteDominioId }[] = [
  { prefix: "/documentos/orcamentos-internos", dominio: "orcamentos" },
  { prefix: "/documentos/cobrancas", dominio: "cobrancas" },
  { prefix: "/documentos", dominio: "documentos" },
];

const CHIPS: { dominio: AssistenteDominioId; label: string; pergunta: string }[] = [
  { dominio: "documentos", label: "Documentos", pergunta: "Buscar documentos" },
  { dominio: "orcamentos", label: "Orçamentos", pergunta: "Consultar meus orçamentos" },
  { dominio: "cobrancas", label: "Cobranças", pergunta: "Ver pendências de cobrança" },
];

function detectarDominioDaRota(pathname: string | null): AssistenteDominioId | null {
  if (!pathname) return null;
  const match = ROUTE_DOMINIO.find((entry) => pathname.startsWith(entry.prefix));
  return match?.dominio ?? null;
}

export default function AssistenteWidget() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [historicoCarregado, setHistoricoCarregado] = useState(false);
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [turns]);

  const getAccessToken = async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const token = data.session?.access_token;
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    return token;
  };

  const carregarHistorico = async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/assistente/historico", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await res.json()) as {
        mensagens?: { role: "user" | "assistant"; text: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? "Não foi possível carregar o histórico.");
      const carregadas: ChatTurn[] = (payload.mensagens ?? []).map((m, index) =>
        m.role === "user"
          ? { id: `hist-${index}`, role: "user", text: m.text }
          : {
              id: `hist-${index}`,
              role: "assistant",
              reply: m.text,
              dominio: null,
              summary: "",
              filters: {},
              filtrosUrl: null,
              results: [],
              total: 0,
              insights: {
                totais: [],
                isTruncated: false,
                porStatus: [],
                porLoja: [],
                tendenciaMensal: [],
                observacoes: [],
              },
            },
      );
      setTurns(carregadas);
    } catch (err) {
      console.error("Erro ao carregar histórico do assistente:", err);
    } finally {
      setHistoricoCarregado(true);
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
    if (!historicoCarregado) {
      void carregarHistorico();
    }
  };

  const buildCurrentContext = () => {
    const dominio = detectarDominioDaRota(pathname);
    if (!dominio) return undefined;
    const filtros: Record<string, unknown> = {};
    searchParams.forEach((value, key) => {
      filtros[key] = value;
    });
    return { dominio, filtros };
  };

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userTurn: ChatTurn = { id: crypto.randomUUID(), role: "user", text: trimmed };
    setTurns((prev) => [...prev, userTurn]);
    setMessage("");
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const res = await fetch("/api/assistente/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pergunta: trimmed, currentContext: buildCurrentContext() }),
      });
      const payload = (await res.json()) as AssistenteApiResponse;
      if (!res.ok) throw new Error(payload.error ?? "Não foi possível consultar o assistente.");
      setTurns((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", ...payload }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível consultar o assistente.");
    } finally {
      setLoading(false);
    }
  };

  const handleNovaConversa = async () => {
    try {
      const token = await getAccessToken();
      await fetch("/api/assistente/historico", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error("Erro ao limpar histórico:", err);
    } finally {
      setTurns([]);
      setMessage("");
      setError(null);
    }
  };

  const handleAbrirArquivo = async (item: AssistenteResultItem) => {
    if (!item.abrirArquivoPath) return;
    const path = resolveSignedPdfPath(item.abrirArquivoPath) ?? item.abrirArquivoPath;
    try {
      setOpeningId(item.id);
      const signedUrl = await getSignedFileUrl(path);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("Erro ao abrir arquivo:", err);
      setError("Não foi possível abrir o arquivo.");
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {isOpen && (
        <div className="flex max-h-[70vh] w-[380px] max-w-[92vw] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl shadow-slate-400/20">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Bot className="h-4 w-4 text-sky-600" />
              Assistente
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Fechar assistente"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={bodyRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {turns.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {CHIPS.map((chip) => (
                  <button
                    key={chip.dominio}
                    type="button"
                    onClick={() => setMessage(chip.pergunta)}
                    className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}

            {turns.map((turn) =>
              turn.role === "user" ? (
                <div
                  key={turn.id}
                  className="ml-auto max-w-[85%] rounded-2xl bg-sky-600 px-3 py-2 text-sm text-white"
                >
                  {turn.text}
                </div>
              ) : (
                <div key={turn.id} className="space-y-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <p>{turn.reply}</p>
                  {turn.filtrosUrl && turn.results.length > 0 && (
                    <a
                      href={turn.filtrosUrl}
                      className="inline-block rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-500"
                    >
                      Aplicar na tela
                    </a>
                  )}
                  {turn.insights.totais.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      {turn.insights.totais.map((item) => (
                        <div key={item.key} className="rounded-xl bg-white px-2 py-1.5 text-center">
                          <p className="text-[10px] uppercase text-slate-400">{item.label}</p>
                          <p className="text-sm font-semibold text-slate-800">{item.valor}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {turn.results.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {turn.results.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 rounded-xl bg-white px-2.5 py-1.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-slate-800">{item.titulo}</p>
                            <p className="truncate text-[11px] text-slate-500">{item.subtitulo}</p>
                          </div>
                          {item.abrirArquivoPath ? (
                            <button
                              type="button"
                              disabled={openingId === item.id}
                              onClick={() => void handleAbrirArquivo(item)}
                              className="shrink-0 rounded-full border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                            >
                              {openingId === item.id ? "Abrindo..." : "Ver arquivo"}
                            </button>
                          ) : item.url ? (
                            <a
                              href={item.url}
                              className="shrink-0 rounded-full border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              Abrir
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>

          {error && <p className="px-4 pb-1 text-xs text-red-600">{error}</p>}

          <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-3">
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !loading) void submit(message);
              }}
              placeholder="Pergunte algo..."
              className="min-w-0 flex-1 rounded-full border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400"
            />
            <button
              type="button"
              onClick={() => void submit(message)}
              disabled={loading}
              className="rounded-full bg-sky-600 p-2 text-white hover:bg-sky-500 disabled:opacity-60"
              aria-label="Enviar"
            >
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          {turns.length > 0 && (
            <button
              type="button"
              onClick={() => void handleNovaConversa()}
              className="border-t border-slate-100 px-4 py-2 text-left text-xs font-semibold text-slate-500 hover:bg-slate-50"
            >
              Nova conversa
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : handleOpen())}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-600 text-white shadow-xl shadow-sky-900/20 transition hover:bg-sky-500"
        aria-label={isOpen ? "Fechar assistente" : "Abrir assistente"}
      >
        {isOpen ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>
    </div>
  );
}
