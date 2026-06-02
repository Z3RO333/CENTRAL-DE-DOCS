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

export type SearchableOption = {
  value: string;
  label: string;
  hint?: string;
};

type SearchableSelectProps = {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Selecione...",
  searchPlaceholder = "Buscar...",
  disabled,
  ariaLabel,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const filteredOptions = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return options;
    return options.filter((option) =>
      norm(`${option.label} ${option.hint ?? ""}`).includes(q),
    );
  }, [options, query]);

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
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
  }, [highlightIndex, open, filteredOptions]);

  const commit = useCallback(
    (option: SearchableOption) => {
      onChange(option.value);
      closeMenu();
    },
    [onChange, closeMenu],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((prev) =>
        Math.min(prev + 1, Math.max(filteredOptions.length - 1, 0)),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = filteredOptions[highlightIndex];
      if (target) commit(target);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    }
  };

  const triggerLabel = selected?.label ?? placeholder;

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => (open ? closeMenu() : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open ? "true" : "false"}
        aria-label={ariaLabel}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 outline-none transition focus:border-sky-400 disabled:cursor-not-allowed disabled:bg-slate-50"
      >
        <span className={`flex-1 truncate ${selected ? "" : "text-slate-400"}`}>
          {triggerLabel}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlightIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="w-full text-sm text-slate-900 outline-none placeholder:text-slate-400"
              aria-label={ariaLabel ? `Buscar em ${ariaLabel}` : "Buscar"}
            />
          </div>
          <div
            ref={listRef}
            role="listbox"
            aria-label={ariaLabel ?? "Opções"}
            className="max-h-64 overflow-y-auto py-1 text-sm"
          >
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-3 text-center text-xs text-slate-500">
                Nenhuma opção encontrada.
              </p>
            ) : (
              filteredOptions.map((option, index) => {
                const isHighlighted = index === highlightIndex;
                const isSelected = option.value === value;
                return (
                  <div
                    key={option.value}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={-1}
                    onMouseEnter={() => setHighlightIndex(index)}
                    onClick={() => commit(option)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        commit(option);
                      }
                    }}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${
                      isHighlighted ? "bg-sky-50" : ""
                    } ${isSelected ? "font-semibold text-sky-700" : "text-slate-700"}`}
                  >
                    <span className="flex-1 truncate">{option.label}</span>
                    {isSelected && (
                      <Check className="h-4 w-4 shrink-0 text-sky-600" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
