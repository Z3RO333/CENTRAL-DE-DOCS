"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FileText, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { StatusBadge } from "@/components/StatusBadge";
import { fixMojibakeText } from "@/lib/textEncoding";

type SearchRecord = {
  id: string;
  tipo: string;
  status: string;
  arquivo_path: string;
  arquivo_assinado_path?: string | null;
  dados: Record<string, unknown> | null;
};

const TYPE_LABEL: Record<string, string> = {
  retencao_trabalhista: "Retenção trabalhista",
  registro_laudos: "Registro e laudos",
  notas_fiscais: "Nota fiscal",
  notas_fiscais_conservacao: "Nota fiscal de conservação",
  contratos: "Contrato",
  orcamentos: "Orçamento",
  orcamentos_internos: "Orçamento interno",
};

function textField(record: SearchRecord, fields: string[]) {
  for (const field of fields) {
    const value = record.dados?.[field];
    if (typeof value === "string" && value.trim()) return fixMojibakeText(value.trim());
  }
  return null;
}

function recordName(record: SearchRecord) {
  const attachments = record.dados?.anexos;
  if (Array.isArray(attachments)) {
    const name = (attachments[0] as { nome?: unknown } | undefined)?.nome;
    if (typeof name === "string" && name.trim()) return fixMojibakeText(name.trim());
  }
  return (
    textField(record, ["numero_nf", "numero_contrato", "numero_orcamento", "numero_pedido"]) ??
    fixMojibakeText(
      (record.arquivo_assinado_path ?? record.arquivo_path)?.split("/").pop() ?? record.id,
    )
  );
}

export function GlobalSearch({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
    else {
      setQuery("");
      setResults([]);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Sessão expirada.");
        const params = new URLSearchParams({
          identificacao: normalized,
          globalSearch: "true",
          limit: "8",
          offset: "0",
        });
        const response = await fetch(`/api/documentos?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as {
          registros?: SearchRecord[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "Não foi possível pesquisar.");
        setResults(payload.registros ?? []);
        setActiveIndex(0);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Não foi possível pesquisar.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const openResult = (record: SearchRecord) => {
    setOpen(false);
    router.push(`/documentos/${record.id}`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center rounded-2xl border border-slate-200 bg-slate-50 text-sm font-medium text-slate-500 transition hover:border-sky-300 hover:bg-white hover:text-slate-800 ${
          collapsed ? "justify-center px-2 py-3" : "justify-between gap-3 px-4 py-3"
        }`}
        aria-label="Abrir busca global"
      >
        <span className="flex items-center gap-2">
          <Search className="h-4 w-4" aria-hidden="true" />
          {!collapsed && <span>Buscar em tudo</span>}
        </span>
        {!collapsed && <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px]">Ctrl K</kbd>}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-950/45 px-4 pt-[12vh] backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="global-search-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl shadow-slate-950/30">
            <h2 id="global-search-title" className="sr-only">Busca global</h2>
            <div className="flex items-center gap-3 border-b border-slate-200 px-4">
              <Search className="h-5 w-5 text-sky-600" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveIndex((current) => Math.min(current + 1, results.length - 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveIndex((current) => Math.max(current - 1, 0));
                  } else if (event.key === "Enter" && results[activeIndex]) {
                    event.preventDefault();
                    openResult(results[activeIndex]);
                  }
                }}
                placeholder="Busque por NF, CNPJ, loja, prestador ou arquivo..."
                className="min-w-0 flex-1 border-0 bg-transparent py-5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls="global-search-results"
                aria-autocomplete="list"
                aria-activedescendant={results[activeIndex] ? `global-result-${results[activeIndex].id}` : undefined}
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Fechar busca"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[55vh] overflow-y-auto p-2" aria-live="polite">
              {query.trim().length < 2 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">Digite ao menos 2 caracteres para pesquisar.</p>
              ) : loading ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">Pesquisando...</p>
              ) : error ? (
                <p className="px-4 py-8 text-center text-sm text-rose-700">{error}</p>
              ) : results.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">Nenhum resultado encontrado. Confira o termo ou tente outro campo.</p>
              ) : (
                <ul id="global-search-results" role="listbox" className="space-y-1">
                  {results.map((record, index) => {
                    const subtitle = [
                      TYPE_LABEL[record.tipo] ?? record.tipo,
                      textField(record, ["loja_nome"]),
                      textField(record, ["prestador", "empresa"]),
                      textField(record, ["cnpj_emitente", "cnpj"]),
                    ].filter(Boolean).join(" · ");
                    return (
                      <li
                        id={`global-result-${record.id}`}
                        key={record.id}
                        role="option"
                        aria-selected={index === activeIndex}
                      >
                        <Link
                          href={`/documentos/${record.id}`}
                          onClick={() => setOpen(false)}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={`flex items-center gap-3 rounded-2xl px-3 py-3 transition ${index === activeIndex ? "bg-sky-50" : "hover:bg-slate-50"}`}
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-sky-700 shadow-sm">
                            <FileText className="h-5 w-5" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-slate-900">{recordName(record)}</span>
                            <span className="block truncate text-xs text-slate-500">{subtitle}</span>
                          </span>
                          <StatusBadge status={record.status} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
