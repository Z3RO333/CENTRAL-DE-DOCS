type DocumentosPaginationProps = {
  totalResultados: number;
  page: number;
  totalPages: number;
  canPrevPage: boolean;
  canNextPage: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
};

export function DocumentosPagination({
  totalResultados,
  page,
  totalPages,
  canPrevPage,
  canNextPage,
  onPrevPage,
  onNextPage,
}: DocumentosPaginationProps) {
  if (totalResultados <= 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-3 text-xs text-slate-500 shadow-sm shadow-slate-200">
      <span>
        {totalResultados} resultado(s) · Página {page} de {totalPages}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPrevPage}
          disabled={!canPrevPage}
          className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={onNextPage}
          disabled={!canNextPage}
          className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
