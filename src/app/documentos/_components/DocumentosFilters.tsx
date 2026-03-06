import { Filter, LayoutGrid, Table as TableIcon } from "lucide-react";

type FilterOption = {
  value: string;
  label: string;
};

type DocumentosFiltersProps = {
  canManageDocuments: boolean;
  filterOptionsLoading: boolean;
  adminUsersLoading: boolean;
  viewMode: "tabela" | "cards";
  identificacaoFilter: string;
  tipoFilter: string;
  tipoLaudoFilter: string;
  statusFilter: string;
  userFilter: string;
  lojaFilter: string;
  prestadorFilter: string;
  anoFilter: string;
  mesFilter: string;
  somenteAssinados: boolean;
  somenteDisponiveisLote: boolean;
  tipoOptions: FilterOption[];
  tipoLaudoOptions: string[];
  statusOptions: string[];
  colaboradorOptions: FilterOption[];
  lojaOptions: FilterOption[];
  prestadorOptions: FilterOption[];
  anosDisponiveis: string[];
  meses: { value: string; label: string }[];
  anoSelecionadoLabel: string;
  mesSelecionadoLabel: string;
  onResetFilters: () => void;
  onViewModeChange: (mode: "tabela" | "cards") => void;
  onIdentificacaoFilterChange: (value: string) => void;
  onTipoFilterChange: (value: string) => void;
  onTipoLaudoFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onUserFilterChange: (value: string) => void;
  onLojaFilterChange: (value: string) => void;
  onPrestadorFilterChange: (value: string) => void;
  onAnoFilterChange: (value: string) => void;
  onMesFilterChange: (value: string) => void;
  onSomenteAssinadosChange: (value: boolean) => void;
  onSomenteDisponiveisLoteChange: (value: boolean) => void;
  formatStatusLabel: (status: string) => string;
};

export function DocumentosFilters({
  canManageDocuments,
  filterOptionsLoading,
  adminUsersLoading,
  viewMode,
  identificacaoFilter,
  tipoFilter,
  tipoLaudoFilter,
  statusFilter,
  userFilter,
  lojaFilter,
  prestadorFilter,
  anoFilter,
  mesFilter,
  somenteAssinados,
  somenteDisponiveisLote,
  tipoOptions,
  tipoLaudoOptions,
  statusOptions,
  colaboradorOptions,
  lojaOptions,
  prestadorOptions,
  anosDisponiveis,
  meses,
  anoSelecionadoLabel,
  mesSelecionadoLabel,
  onResetFilters,
  onViewModeChange,
  onIdentificacaoFilterChange,
  onTipoFilterChange,
  onTipoLaudoFilterChange,
  onStatusFilterChange,
  onUserFilterChange,
  onLojaFilterChange,
  onPrestadorFilterChange,
  onAnoFilterChange,
  onMesFilterChange,
  onSomenteAssinadosChange,
  onSomenteDisponiveisLoteChange,
  formatStatusLabel,
}: DocumentosFiltersProps) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Filter className="h-4 w-4 text-slate-400" />
          Painel de filtros
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {(filterOptionsLoading || adminUsersLoading) && (
            <span className="text-[11px] font-semibold text-slate-400">
              Carregando opções de filtro...
            </span>
          )}
          <button
            type="button"
            onClick={onResetFilters}
            className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Limpar filtros
          </button>
          <div className="inline-flex overflow-hidden rounded-full border border-slate-200 bg-slate-50 text-slate-600">
            <button
              type="button"
              onClick={() => onViewModeChange("tabela")}
              className={`flex items-center gap-1 px-3 py-1 text-xs font-semibold transition ${
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
              className={`flex items-center gap-1 border-l border-slate-200 px-3 py-1 text-xs font-semibold transition ${
                viewMode === "cards"
                  ? "bg-white text-slate-900"
                  : "text-slate-500"
              }`}
              aria-pressed={viewMode === "cards"}
            >
              <LayoutGrid className="h-4 w-4" />
              Cartões
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <label className="text-xs font-semibold text-slate-600">
          Identificação (Empresa/Prestador/Número do pedido)
          <input
            type="text"
            value={identificacaoFilter}
            onChange={(event) => onIdentificacaoFilterChange(event.target.value)}
            placeholder="Busque pela empresa, prestador ou número do pedido"
            className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Tipo de formulário
          <select
            value={tipoFilter}
            onChange={(event) => onTipoFilterChange(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
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
            onChange={(event) => onTipoLaudoFilterChange(event.target.value)}
            disabled={filterOptionsLoading}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
          >
            {tipoLaudoOptions.map((tipoLaudo) => (
              <option key={tipoLaudo} value={tipoLaudo}>
                {tipoLaudo === "todos" ? "Todos os tipos" : tipoLaudo}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Status
          <select
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value)}
            disabled={filterOptionsLoading}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
          >
            {statusOptions.map((statusOption) => (
              <option key={statusOption} value={statusOption}>
                {statusOption === "todos"
                  ? "Todos os status"
                  : formatStatusLabel(statusOption)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {canManageDocuments && (
          <label className="text-xs font-semibold text-slate-600">
            Colaborador (quem enviou)
            <select
              value={userFilter}
              onChange={(event) => onUserFilterChange(event.target.value)}
              disabled={adminUsersLoading}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
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
            <select
              value={lojaFilter}
              onChange={(event) => onLojaFilterChange(event.target.value)}
              disabled={filterOptionsLoading}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            >
              {lojaOptions.map((loja) => (
                <option key={loja.value} value={loja.value}>
                  {loja.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {prestadorOptions.length > 1 && (
          <label className="text-xs font-semibold text-slate-600">
            Prestador
            <select
              value={prestadorFilter}
              onChange={(event) => onPrestadorFilterChange(event.target.value)}
              disabled={filterOptionsLoading}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
            >
              {prestadorOptions.map((prestador) => (
                <option key={prestador.value} value={prestador.value}>
                  {prestador.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs font-semibold text-slate-600">
          Ano de envio
          <select
            value={anoFilter}
            onChange={(event) => onAnoFilterChange(event.target.value)}
            disabled={filterOptionsLoading}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
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
          Mês de envio
          <select
            value={mesFilter}
            onChange={(event) => onMesFilterChange(event.target.value)}
            disabled={anoFilter === "todos"}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
          >
            <option value="todos">Todos os meses</option>
            {meses.map((mes) => (
              <option key={mes.value} value={mes.value}>
                {anoFilter !== "todos" ? `${mes.value}/${anoFilter}` : mes.label}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-xl bg-slate-50 p-3 text-[11px] text-slate-500">
          Os filtros acima são aplicados automaticamente. Período selecionado:{" "}
          {anoSelecionadoLabel}, {mesSelecionadoLabel}.
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            checked={somenteAssinados}
            onChange={(event) => onSomenteAssinadosChange(event.target.checked)}
          />
          Mostrar apenas assinados
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
          Apenas disponíveis para assinatura em lote
        </label>
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          Combine os filtros para chegar ao subconjunto desejado.
        </div>
      </div>
    </div>
  );
}
