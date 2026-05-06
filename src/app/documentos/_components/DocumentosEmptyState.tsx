type DocumentosEmptyStateProps = {
  hasYearFilter: boolean;
  onResetFilters: () => void;
  onSearchAllYears: () => void;
  onRefresh: () => void;
};

export function DocumentosEmptyState({
  hasYearFilter,
  onResetFilters,
  onSearchAllYears,
  onRefresh,
}: DocumentosEmptyStateProps) {
  return (
    <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm shadow-slate-200">
      <p className="text-base font-semibold text-slate-700">
        Nenhum documento encontrado com esses filtros.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        A lista pode estar filtrada por busca, status, loja, prestador ou
        período.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={onResetFilters}
          className="rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
        >
          Limpar filtros
        </button>
        <button
          type="button"
          onClick={onSearchAllYears}
          disabled={!hasYearFilter}
          className="rounded-full border border-sky-200 px-4 py-1.5 text-xs font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Buscar em todos os anos
        </button>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
        >
          Atualizar lista
        </button>
      </div>
    </div>
  );
}
