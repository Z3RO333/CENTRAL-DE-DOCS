"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { STATUS_LABEL, type OrcamentoInternoStatus } from "@/lib/orcamentosInternosShared";
import type { GestorOption } from "../_lib/orcamentosTypes";

export const EMPTY_FILTERS = {
  statusFilter: "todos",
  gestorFilter: "todos",
  colaboradorFilter: "todos",
  dataInicio: "",
  dataFim: "",
};

export type OrcamentoFilters = typeof EMPTY_FILTERS;

const STATUS_GROUPS: Array<{ label: string; statuses: OrcamentoInternoStatus[] }> = [
  { label: "Precisam de ação", statuses: ["rascunho", "ajuste_solicitado", "reenviado"] },
  { label: "Em andamento", statuses: ["aguardando_aprovacao", "em_analise_gestor"] },
  { label: "Encerrados", statuses: ["aprovado_assinado", "rejeitado", "cancelado"] },
];

const fieldClassName = "mt-2 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100";

export function OrcamentoFiltersPanel({
  filters,
  gestores,
  onApply,
  onClose,
}: {
  filters: OrcamentoFilters;
  gestores: GestorOption[];
  onApply: (filters: OrcamentoFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(filters);
  const invalidDates = Boolean(draft.dataInicio && draft.dataFim && draft.dataInicio > draft.dataFim);
  const update = (key: keyof OrcamentoFilters, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100 sm:p-5">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Filtrar orçamentos</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">Escolha os critérios para encontrar os orçamentos que precisa.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar filtros"
          className="shrink-0 rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-600"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <form
        className="pt-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalidDates) onApply(draft);
        }}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Status
            <select value={draft.statusFilter} onChange={(event) => update("statusFilter", event.target.value)} className={fieldClassName}>
              <option value="todos">Todos os status</option>
              {STATUS_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.statuses.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Decidido por
            <select value={draft.gestorFilter} onChange={(event) => update("gestorFilter", event.target.value)} className={fieldClassName}>
              <option value="todos">Todos</option>
              {gestores.map((gestor) => <option key={gestor.email} value={gestor.email}>{gestor.name ?? gestor.email}</option>)}
            </select>
          </label>
          <fieldset className="grid min-w-0 gap-4 sm:col-span-2 sm:grid-cols-2">
            <legend className="mb-3 text-sm font-semibold text-slate-900">Período</legend>
            <label className="min-w-0 text-sm font-medium text-slate-700">
              Data inicial
              <input type="date" value={draft.dataInicio} max={draft.dataFim || undefined} onChange={(event) => update("dataInicio", event.target.value)} className={fieldClassName} />
            </label>
            <label className="min-w-0 text-sm font-medium text-slate-700">
              Data final
              <input type="date" value={draft.dataFim} min={draft.dataInicio || undefined} onChange={(event) => update("dataFim", event.target.value)} className={fieldClassName} />
            </label>
          </fieldset>
        </div>
        {invalidDates && <p role="alert" className="mt-3 text-sm text-red-600">A data final deve ser igual ou posterior à data inicial.</p>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
          <button type="button" onClick={() => setDraft(EMPTY_FILTERS)} className="text-sm font-semibold text-slate-500 hover:text-slate-900">Limpar filtros</button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancelar</button>
            <button type="submit" disabled={invalidDates} className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">Aplicar filtros</button>
          </div>
        </div>
      </form>
    </div>
  );
}
