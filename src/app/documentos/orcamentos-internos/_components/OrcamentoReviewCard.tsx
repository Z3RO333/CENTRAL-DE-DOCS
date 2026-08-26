"use client";

import { FileSearch, LoaderCircle, Save, Send, Sparkles } from "lucide-react";

export type ReviewValues = {
  prestadorId: string;
  prestadorNome: string;
  fornecedorCnpj: string;
  numeroOrcamento: string;
  valorTotal: string;
  dataValidade: string;
  descricao: string;
  observacoes: string;
};

export const EMPTY_REVIEW_VALUES: ReviewValues = {
  prestadorId: "",
  prestadorNome: "",
  fornecedorCnpj: "",
  numeroOrcamento: "",
  valorTotal: "",
  dataValidade: "",
  descricao: "",
  observacoes: "",
};

export type OrcamentoReviewCardBusy =
  | "uploading"
  | "analyzing"
  | "saving"
  | "submitting"
  | null;

type Props = {
  fileName: string;
  values: ReviewValues;
  onChange: (values: ReviewValues) => void;
  confidence: number | null;
  alerts: string[];
  onReanalyze: (() => void) | null;
  onSaveDraft: () => void;
  onSubmit: () => void;
  busy: OrcamentoReviewCardBusy;
  error: string | null;
  success: string | null;
};

export function OrcamentoReviewCard({
  fileName,
  values,
  onChange,
  confidence,
  alerts,
  onReanalyze,
  onSaveDraft,
  onSubmit,
  busy,
  error,
  success,
}: Props) {
  const busyState = busy !== null;
  const update = (name: keyof ReviewValues, value: string) => {
    onChange({ ...values, [name]: value });
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
        <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-slate-700">
          <FileSearch className="h-4 w-4 shrink-0" />
          <span className="truncate">{fileName}</span>
        </span>
        {onReanalyze ? (
          <button
            type="button"
            onClick={onReanalyze}
            disabled={busyState}
            className="inline-flex items-center gap-1 font-semibold text-sky-700 disabled:opacity-50"
          >
            {busy === "analyzing" ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Analisar novamente
          </button>
        ) : null}
      </div>

      {(error || success) && (
        <div
          className={`mt-3 rounded-xl px-3 py-2 text-xs ${
            error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {error ?? success}
        </div>
      )}

      {confidence !== null ? (
        <p className="mt-3 text-[11px] text-slate-500">
          Confiança geral da leitura: {Math.round(confidence * 100)}%. Sempre confira os
          dados antes do envio.
        </p>
      ) : null}
      {alerts.length > 0 ? (
        <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {alerts.join(" ")}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Fornecedor identificado *
          <input
            value={values.prestadorNome}
            onChange={(event) =>
              onChange({ ...values, prestadorId: "", prestadorNome: event.target.value })
            }
            placeholder="Razão social ou nome da empresa"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          CNPJ
          <input
            value={values.fornecedorCnpj}
            onChange={(event) =>
              onChange({ ...values, prestadorId: "", fornecedorCnpj: event.target.value })
            }
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Número do orçamento
          <input
            value={values.numeroOrcamento}
            onChange={(event) => update("numeroOrcamento", event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Valor total
          <input
            type="number"
            min="0"
            step="0.01"
            value={values.valorTotal}
            onChange={(event) => update("valorTotal", event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Validade
          <input
            type="date"
            value={values.dataValidade}
            onChange={(event) => update("dataValidade", event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Descrição
          <textarea
            value={values.descricao}
            onChange={(event) => update("descricao", event.target.value)}
            className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
        <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Observações internas
          <textarea
            value={values.observacoes}
            onChange={(event) => update("observacoes", event.target.value)}
            className="mt-1 min-h-16 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={busyState}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {busy === "saving" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Salvar rascunho
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busyState || !values.prestadorNome.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
        >
          {busy === "submitting" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Enviar para aprovação
        </button>
      </div>
    </div>
  );
}
