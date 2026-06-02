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
import type { Loja } from "@/hooks/useLojas";

type LojaCombobox = {
  lojas: Loja[];
  value: string;
  onChange: (lojaId: string) => void;
  loading?: boolean;
  disabled?: boolean;
  required?: boolean;
  id?: string;
};

const compareCodigo = (a: string | null, b: string | null) => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const numA = Number(a);
  const numB = Number(b);
  if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB;
  return a.localeCompare(b);
};

const formatLabel = (loja: Loja) =>
  loja.codigo ? `${loja.codigo} - ${loja.nome}` : loja.nome;

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const buildSearchKey = (loja: Loja) =>
  norm(`${loja.codigo ?? ""} ${loja.nome}`);

export default function LojaCombobox({
  lojas,
  value,
  onChange,
  loading,
  disabled,
  required,
  id,
}: LojaCombobox) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const sortedLojas = useMemo(
    () => [...lojas].sort((a, b) => compareCodigo(a.codigo, b.codigo)),
    [lojas],
  );

  const filteredLojas = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return sortedLojas;
    return sortedLojas.filter((loja) => buildSearchKey(loja).includes(q));
  }, [sortedLojas, query]);

  const selected = useMemo(
    () => lojas.find((loja) => loja.id === value) ?? null,
    [lojas, value],
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
    const handleClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, closeMenu]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.querySelector<HTMLElement>(
      `[data-index="${highlightIndex}"]`,
    );
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, open, filteredLojas]);

  const commit = useCallback(
    (loja: Loja) => {
      onChange(loja.id);
      closeMenu();
    },
    [onChange, closeMenu],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((prev) =>
        Math.min(prev + 1, Math.max(filteredLojas.length - 1, 0)),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = filteredLojas[highlightIndex];
      if (target) commit(target);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const triggerLabel = selected
    ? formatLabel(selected)
    : loading
      ? "Carregando lojas..."
      : lojas.length === 0
        ? "Nenhuma loja cadastrada"
        : "Selecione uma loja";

  const isPlaceholder = !selected;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled || loading || lojas.length === 0}
        onClick={() => (open ? closeMenu() : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open ? "true" : "false"}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-left text-sm shadow-sm outline-none transition focus:border-sky-500 focus:ring focus:ring-sky-500/40 disabled:cursor-not-allowed disabled:bg-slate-50 ${
          selected?.categoria === "REVISAR"
            ? "border-amber-300"
            : "border-slate-300"
        }`}
      >
        <span
          className={`flex-1 truncate ${isPlaceholder ? "text-slate-400" : "text-slate-900"}`}
        >
          {triggerLabel}
        </span>
        {selected?.categoria === "REVISAR" && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            Revisar
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}
        />
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
            <Search className="h-4 w-4 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Buscar por centro ou nome..."
              className="w-full text-sm text-slate-900 outline-none placeholder:text-slate-400"
              aria-label="Buscar loja"
            />
          </div>
          <div
            ref={listRef}
            role="listbox"
            aria-label="Lista de lojas"
            className="max-h-72 overflow-y-auto py-1 text-sm"
          >
            {filteredLojas.length === 0 ? (
              <p className="px-3 py-3 text-center text-xs text-slate-500">
                Nenhuma unidade encontrada.
              </p>
            ) : (
              filteredLojas.map((loja, index) => {
                const isHighlighted = index === highlightIndex;
                const isSelected = loja.id === value;
                const isRevisar = loja.categoria === "REVISAR";
                return (
                  <div
                    key={loja.id}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected ? "true" : "false"}
                    onMouseEnter={() => setHighlightIndex(index)}
                    onClick={() => commit(loja)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        commit(loja);
                      }
                    }}
                    tabIndex={-1}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${
                      isHighlighted ? "bg-sky-50" : ""
                    } ${isSelected ? "font-semibold text-sky-700" : "text-slate-700"}`}
                  >
                    <span className="w-12 shrink-0 font-mono text-xs text-slate-500">
                      {loja.codigo ?? "—"}
                    </span>
                    <span className="flex-1 truncate">{loja.nome}</span>
                    {isRevisar && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        Revisar
                      </span>
                    )}
                    {isSelected && (
                      <Check className="h-4 w-4 shrink-0 text-sky-600" />
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
            {filteredLojas.length} de {lojas.length} unidades
          </div>
        </div>
      )}
    </div>
  );
}
