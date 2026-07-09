type DocumentosBatchActionsProps = {
  assinaturasPendentesCount: number;
  selectedIds: string[];
  hasSelection: boolean;
  registrosFiltradosCount: number;
  assinaturasSelecionadasCount: number;
  deletingBatch: boolean;
  startingBatch: boolean;
  onToggleSelecionar: (id: string) => void;
  onSelecionarTodos: () => void;
  onLimparSelecao: () => void;
  onRemoverSelecionados: () => void;
  onIniciarAssinaturaEmLote: () => void;
};

export function DocumentosBatchActions({
  assinaturasPendentesCount,
  selectedIds,
  hasSelection,
  registrosFiltradosCount,
  assinaturasSelecionadasCount,
  deletingBatch,
  startingBatch,
  onToggleSelecionar,
  onSelecionarTodos,
  onLimparSelecao,
  onRemoverSelecionados,
  onIniciarAssinaturaEmLote,
}: DocumentosBatchActionsProps) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Assinaturas disponíveis
          </p>
          <p className="text-sm text-slate-600">
            {assinaturasPendentesCount > 0 ? (
              <>
                {assinaturasPendentesCount} documento(s) pendentes do tipo
                Registro e Laudos podem ser assinados.
              </>
            ) : (
              <>Nenhum documento pendente para assinatura em lote.</>
            )}
          </p>
          {hasSelection && (
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
              {selectedIds.slice(0, 4).map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 font-mono text-[10px] text-slate-600"
                >
                  {id.slice(0, 8)}...
                  <button
                    type="button"
                    onClick={() => onToggleSelecionar(id)}
                    className="text-[10px] font-semibold text-slate-500 transition hover:text-slate-800"
                    title="Remover da seleção"
                  >
                    x
                  </button>
                </span>
              ))}
              {selectedIds.length > 4 && (
                <span className="text-[11px] text-slate-500">
                  +{selectedIds.length - 4} outros
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <button
            type="button"
            onClick={onSelecionarTodos}
            disabled={registrosFiltradosCount === 0}
            className="rounded-full border border-slate-200 px-4 py-1.5 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {registrosFiltradosCount === 0
              ? "Nenhum registro na página"
              : "Selecionar página atual"}
          </button>
          <button
            type="button"
            onClick={onLimparSelecao}
            disabled={!hasSelection}
            className="rounded-full border border-slate-200 px-4 py-1.5 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Limpar seleção
          </button>
          <button
            type="button"
            onClick={onRemoverSelecionados}
            disabled={!hasSelection || deletingBatch}
            className="rounded-full border border-red-200 px-4 py-1.5 text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deletingBatch ? "Removendo..." : "Remover selecionados"}
          </button>
          <button
            type="button"
            onClick={onIniciarAssinaturaEmLote}
            disabled={assinaturasSelecionadasCount === 0 || startingBatch}
            className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm shadow-emerald-200 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {startingBatch
              ? "Abrindo..."
              : assinaturasSelecionadasCount > 1
                ? "Assinar em lote"
                : "Assinar selecionados"}
          </button>
        </div>
      </div>
    </div>
  );
}
