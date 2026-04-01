type DocumentosEmptyStateProps = {
  onResetFilters: () => void;
};

export function DocumentosEmptyState({
  onResetFilters,
}: DocumentosEmptyStateProps) {
  return (
    <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm shadow-slate-200">
      <p className="text-base font-semibold text-slate-700">
        Nenhum documento encontrado
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Ajuste ou limpe os filtros para visualizar todos os registros.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <button
          type="button"
          onClick={onResetFilters}
          className="rounded-full border border-slate-300 px-4 py-1.5 text-xs text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
        >
          Limpar filtros
        </button>
      </div>
    </div>
  );
}
