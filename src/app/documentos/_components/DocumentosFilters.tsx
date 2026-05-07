"use client";

import { useEffect, useState } from "react";
import {
  Filter,
  LayoutGrid,
  Search,
  SlidersHorizontal,
  Table as TableIcon,
  X,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";

type FilterOption = {
  value: string;
  label: string;
};

type QuickFilter =
  | "todos"
  | "pendentes"
  | "assinados"
  | "notas_fiscais"
  | "laudos"
  | "este_mes";

type DocumentosFiltersProps = {
  canManageDocuments: boolean;
  filterOptionsLoading: boolean;
  adminUsersLoading: boolean;
  viewMode: "tabela" | "cards";
  identificacaoFilter: string;
  tipoFilter: string;
  tipoLaudoFilter: string;
  userFilter: string;
  lojaFilter: string;
  prestadorFilter: string;
  anoFilter: string;
  mesFilter: string;
  somenteAssinados: boolean;
  somenteDisponiveisLote: boolean;
  tipoOptions: FilterOption[];
  tipoLaudoOptions: string[];
  colaboradorOptions: FilterOption[];
  lojaOptions: FilterOption[];
  prestadorOptions: FilterOption[];
  anosDisponiveis: string[];
  meses: { value: string; label: string }[];
  activeFilterCount: number;
  onResetFilters: () => void;
  onQuickFilter: (filter: QuickFilter) => void;
  onViewModeChange: (mode: "tabela" | "cards") => void;
  onIdentificacaoFilterChange: (value: string) => void;
  onTipoFilterChange: (value: string) => void;
  onTipoLaudoFilterChange: (value: string) => void;
  onUserFilterChange: (value: string) => void;
  onLojaFilterChange: (value: string) => void;
  onPrestadorFilterChange: (value: string) => void;
  onAnoFilterChange: (value: string) => void;
  onMesFilterChange: (value: string) => void;
  onSomenteAssinadosChange: (value: boolean) => void;
  onSomenteDisponiveisLoteChange: (value: boolean) => void;
};

const inputClassName =
  "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400";

export function DocumentosFilters({
  canManageDocuments,
  filterOptionsLoading,
  adminUsersLoading,
  viewMode,
  identificacaoFilter,
  tipoFilter,
  tipoLaudoFilter,
  userFilter,
  lojaFilter,
  prestadorFilter,
  anoFilter,
  mesFilter,
  somenteAssinados,
  somenteDisponiveisLote,
  tipoOptions,
  tipoLaudoOptions,
  colaboradorOptions,
  lojaOptions,
  prestadorOptions,
  anosDisponiveis,
  meses,
  activeFilterCount,
  onResetFilters,
  onQuickFilter,
  onViewModeChange,
  onIdentificacaoFilterChange,
  onTipoFilterChange,
  onTipoLaudoFilterChange,
  onUserFilterChange,
  onLojaFilterChange,
  onPrestadorFilterChange,
  onAnoFilterChange,
  onMesFilterChange,
  onSomenteAssinadosChange,
  onSomenteDisponiveisLoteChange,
}: DocumentosFiltersProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!isAdvancedOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAdvancedOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAdvancedOpen]);

  const quickFilters: { value: QuickFilter; label: string }[] = [
    { value: "todos", label: "Todos" },
    { value: "pendentes", label: "Pendentes" },
    { value: "assinados", label: "Assinados" },
    { value: "notas_fiscais", label: "Notas Fiscais" },
    { value: "laudos", label: "Laudos" },
    { value: "este_mes", label: "Este mes" },
  ];

  return (
    <>
      <section className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
          <label className="text-xs font-semibold text-slate-600">
            Busca global
            <div className="mt-1 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 transition focus-within:border-sky-400 focus-within:bg-white">
              <Search className="h-5 w-5 text-slate-400" />
              <input
                type="search"
                value={identificacaoFilter}
                onChange={(event) =>
                  onIdentificacaoFilterChange(event.target.value)
                }
                placeholder="Busque por NF, pedido, CNPJ, loja, prestador, responsável ou nome do arquivo..."
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none"
              />
            </div>
          </label>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => setIsAdvancedOpen(true)}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 px-4 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filtros
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-700">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={onResetFilters}
              className="h-11 rounded-full border border-slate-200 px-4 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Limpar
            </button>
          </div>

          <div className="flex items-end">
            <div className="inline-flex h-11 overflow-hidden rounded-full border border-slate-200 bg-slate-50 text-slate-600">
              <button
                type="button"
                onClick={() => onViewModeChange("tabela")}
                className={`flex items-center gap-1 px-3 text-xs font-semibold transition ${
                  viewMode === "tabela"
                    ? "bg-white text-slate-900"
                    : "text-slate-500"
                }`}
                aria-pressed={viewMode === "tabela"}
              >
                <TableIcon className="h-4 w-4" />
                Tabela
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange("cards")}
                className={`flex items-center gap-1 border-l border-slate-200 px-3 text-xs font-semibold transition ${
                  viewMode === "cards"
                    ? "bg-white text-slate-900"
                    : "text-slate-500"
                }`}
                aria-pressed={viewMode === "cards"}
              >
                <LayoutGrid className="h-4 w-4" />
                Cards
              </button>
            </div>
          </div>

          <div className="flex items-end text-[11px] text-slate-500">
            {(filterOptionsLoading || adminUsersLoading) && (
              <span>Carregando opções...</span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {quickFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => onQuickFilter(filter.value)}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
            >
              {filter.label}
            </button>
          ))}
        </div>
      </section>

      {isAdvancedOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
          onClick={() => setIsAdvancedOpen(false)}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="documentos-filtros-title"
            className="flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl shadow-slate-900/20"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Filter className="h-4 w-4 text-slate-400" />
                  Filtros avançados
                </div>
                <p id="documentos-filtros-title" className="mt-1 text-lg font-semibold text-slate-900">
                  Refinar documentos
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAdvancedOpen(false)}
                className="rounded-full bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200"
                aria-label="Fechar filtros"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">
                  Tipo
                  <select
                    value={tipoFilter}
                    onChange={(event) => onTipoFilterChange(event.target.value)}
                    className={inputClassName}
                  >
                    {tipoOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs font-semibold text-slate-600">
                  Tipo de laudo
                  <select
                    value={tipoLaudoFilter}
                    onChange={(event) =>
                      onTipoLaudoFilterChange(event.target.value)
                    }
                    disabled={filterOptionsLoading}
                    className={inputClassName}
                  >
                    {tipoLaudoOptions.map((tipoLaudo) => (
                      <option key={tipoLaudo} value={tipoLaudo}>
                        {tipoLaudo === "todos" ? "Todos os tipos" : tipoLaudo}
                      </option>
                    ))}
                  </select>
                </label>

                {canManageDocuments && (
                  <label className="text-xs font-semibold text-slate-600">
                    Colaborador
                    <select
                      value={userFilter}
                      onChange={(event) => onUserFilterChange(event.target.value)}
                      disabled={adminUsersLoading}
                      className={inputClassName}
                    >
                      {colaboradorOptions.map((colaborador) => (
                        <option key={colaborador.value} value={colaborador.value}>
                          {colaborador.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {(canManageDocuments || lojaOptions.length > 1) && (
                  <label className="text-xs font-semibold text-slate-600">
                    Loja
                    <div className="mt-1">
                      <SearchableSelect
                        options={lojaOptions}
                        value={lojaFilter}
                        onChange={onLojaFilterChange}
                        disabled={filterOptionsLoading}
                        searchPlaceholder="Buscar por centro ou nome..."
                        ariaLabel="Loja"
                      />
                    </div>
                  </label>
                )}

                {prestadorOptions.length > 1 && (
                  <label className="text-xs font-semibold text-slate-600">
                    Prestador
                    <div className="mt-1">
                      <SearchableSelect
                        options={prestadorOptions}
                        value={prestadorFilter}
                        onChange={onPrestadorFilterChange}
                        disabled={filterOptionsLoading}
                        searchPlaceholder="Buscar prestador..."
                        ariaLabel="Prestador"
                      />
                    </div>
                  </label>
                )}

                <label className="text-xs font-semibold text-slate-600">
                  Ano
                  <select
                    value={anoFilter}
                    onChange={(event) => onAnoFilterChange(event.target.value)}
                    disabled={filterOptionsLoading}
                    className={inputClassName}
                  >
                    <option value="todos">Todos os anos</option>
                    {anosDisponiveis.map((ano) => (
                      <option key={ano} value={ano}>
                        {ano}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs font-semibold text-slate-600">
                  Mês
                  <select
                    value={mesFilter}
                    onChange={(event) => onMesFilterChange(event.target.value)}
                    disabled={anoFilter === "todos"}
                    className={inputClassName}
                  >
                    <option value="todos">Todos os meses</option>
                    {meses.map((mes) => (
                      <option key={mes.value} value={mes.value}>
                        {anoFilter !== "todos"
                          ? `${mes.value}/${anoFilter}`
                          : mes.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-5 grid gap-3">
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    checked={somenteAssinados}
                    onChange={(event) =>
                      onSomenteAssinadosChange(event.target.checked)
                    }
                  />
                  Apenas assinados
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    checked={somenteDisponiveisLote}
                    onChange={(event) =>
                      onSomenteDisponiveisLoteChange(event.target.checked)
                    }
                  />
                  Disponíveis para assinatura em lote
                </label>
              </div>
            </div>

            <footer className="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4 text-xs">
              <button
                type="button"
                onClick={onResetFilters}
                className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Limpar filtros
              </button>
              <button
                type="button"
                onClick={() => setIsAdvancedOpen(false)}
                className="rounded-full bg-slate-900 px-4 py-2 font-semibold text-white transition hover:bg-slate-700"
              >
                Aplicar
              </button>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
