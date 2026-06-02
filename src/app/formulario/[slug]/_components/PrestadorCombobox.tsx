"use client";

import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown, Search } from "lucide-react";

type Prestador = {
  id: string;
  nome: string;
  tipo_servico?: string | null;
};

type PrestadorComboboxProps = {
  prestadores: Prestador[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
  required?: boolean;
  id?: string;
};

const formatLabel = (p: Prestador) =>
  p.tipo_servico ? `${p.nome} — ${p.tipo_servico}` : p.nome;

const buildSearchKey = (p: Prestador) =>
  `${p.nome} ${p.tipo_servico ?? ""}`.toLowerCase();

export default function PrestadorCombobox({
  prestadores,
  value,
  onChange,
  loading,
  disabled,
  required,
  id,
}: PrestadorComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const sorted = useMemo(
    () => [...prestadores].sort((a, b) => a.nome.localeCompare(b.nome)),
    [prestadores],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((p) => buildSearchKey(p).includes(q));
  }, [sorted, query]);

  const selected = useMemo(
    () => prestadores.find((p) => p.id === value) ?? null,
    [prestadores, value],
  );

  const closeMenu = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHighlightIndex(0);
  }, []);

  const openMenu = useCallback(() => {
    setOpen(true);
    setQuery("");
    setHighlightIndex(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, closeMenu]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current
      .querySelector<HTMLElement>(`[data-index="${highlightIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, open]);

  const commit = useCallback(
    (p: Prestador) => {
      onChange(p.id);
      closeMenu();
    },
    [onChange, closeMenu],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[highlightIndex];
      if (target) commit(target);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  };

  const triggerLabel = selected
    ? formatLabel(selected)
    : loading
      ? "Carregando prestadores..."
      : prestadores.length === 0
        ? "Nenhum prestador disponível"
        : "Selecione um prestador";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled || loading || prestadores.length === 0}
        onClick={() => (open ? closeMenu() : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm shadow-sm outline-none transition focus:border-sky-500 focus:ring focus:ring-sky-500/40 disabled:cursor-not-allowed disabled:bg-slate-50"
      >
        <span className={`flex-1 truncate ${!selected ? "text-slate-400" : "text-slate-900"}`}>
          {triggerLabel}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
          value={value}
          onChange={() => {}}
          onFocus={() => openMenu()}
          required
        />
      )}

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlightIndex(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Buscar por nome ou tipo de serviço..."
              className="w-full text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>
          <div
            ref={listRef}
            role="listbox"
            className="max-h-72 overflow-y-auto py-1 text-sm"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-center text-xs text-slate-500">
                Nenhum prestador encontrado.
              </p>
            ) : (
              filtered.map((p, index) => {
                const isHighlighted = index === highlightIndex;
                const isSelected = p.id === value;
                return (
                  <div
                    key={p.id}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlightIndex(index)}
                    onClick={() => commit(p)}
                    tabIndex={-1}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${
                      isHighlighted ? "bg-sky-50" : ""
                    } ${isSelected ? "font-semibold text-sky-700" : "text-slate-700"}`}
                  >
                    <span className="flex-1 truncate">
                      <span className="font-medium">{p.nome}</span>
                      {p.tipo_servico && (
                        <span className="ml-1 text-slate-400">— {p.tipo_servico}</span>
                      )}
                    </span>
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-sky-600" />}
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
            {filtered.length} de {prestadores.length} prestadores
          </div>
        </div>
      )}
    </div>
  );
}
