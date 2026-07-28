"use client";

import { useEffect, useState } from "react";
import { FileSearch, LoaderCircle, Save, Send, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import type { GestorOption, OrcamentoInterno } from "../_lib/orcamentosTypes";
import { uploadDocumentFile } from "@/lib/documentUpload";

type FormValues = {
  prestadorId: string;
  prestadorNome: string;
  fornecedorCnpj: string;
  numeroOrcamento: string;
  valorTotal: string;
  dataValidade: string;
  descricao: string;
  gestorEmail: string;
  observacoes: string;
};

type AnalisePayload = {
  sugestao?: {
    prestadorId: string | null;
    prestadorNome: string;
    fornecedorCnpj: string;
    numeroOrcamento: string;
    valorTotal: number | null;
    dataValidade: string | null;
    descricao: string;
    confianca: number;
    alertas: string[];
  };
  error?: string;
};

type Props = {
  gestores: GestorOption[];
  draftToResume: OrcamentoInterno | null;
  onUpsert: (orcamento: OrcamentoInterno) => void;
  onSubmitted: (orcamento: OrcamentoInterno) => void;
  onResumeHandled: () => void;
};

const EMPTY_VALUES: FormValues = {
  prestadorId: "",
  prestadorNome: "",
  fornecedorCnpj: "",
  numeroOrcamento: "",
  valorTotal: "",
  dataValidade: "",
  descricao: "",
  gestorEmail: "",
  observacoes: "",
};

async function getToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Faça login novamente.");
  return token;
}

export function OrcamentoIntakeForm({
  gestores,
  draftToResume,
  onUpsert,
  onSubmitted,
  onResumeHandled,
}: Props) {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [attachedFileName, setAttachedFileName] = useState("");
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [working, setWorking] = useState<
    "uploading" | "analyzing" | "saving" | "submitting" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!draftToResume) return;
    setDraftId(draftToResume.id);
    setAttachedFileName(
      draftToResume.arquivo_original_path.split("/").pop() || "orcamento.pdf",
    );
    setValues({
      prestadorId: draftToResume.prestador_id ?? "",
      prestadorNome: draftToResume.prestador_nome,
      fornecedorCnpj: draftToResume.fornecedor_cnpj ?? "",
      numeroOrcamento: draftToResume.numero_orcamento,
      valorTotal:
        draftToResume.valor_total === null ? "" : String(draftToResume.valor_total),
      dataValidade: draftToResume.data_validade ?? "",
      descricao: draftToResume.descricao,
      gestorEmail: draftToResume.gestor_email,
      observacoes: draftToResume.observacoes ?? "",
    });
    setFile(null);
    setConfidence(null);
    setAlerts([]);
    setError(null);
    setSuccess("Rascunho aberto para continuar.");
    onResumeHandled();
  }, [draftToResume, onResumeHandled]);

  const updateValue = (name: keyof FormValues, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
  };

  const resetForm = () => {
    setFile(null);
    setFileInputKey((current) => current + 1);
    setDraftId(null);
    setAttachedFileName("");
    setValues(EMPTY_VALUES);
    setConfidence(null);
    setAlerts([]);
    setError(null);
    setSuccess(null);
  };

  const analyzeDraft = async (id: string) => {
    setWorking("analyzing");
    setError(null);
    setSuccess(null);
    try {
      const token = await getToken();
      const response = await fetch(`/api/orcamentos-internos/${id}/analisar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json()) as AnalisePayload;
      if (!response.ok || !payload.sugestao) {
        throw new Error(payload.error ?? "Não foi possível analisar o orçamento.");
      }
      const sugestao = payload.sugestao;
      setValues((current) => ({
        ...current,
        prestadorId: sugestao.prestadorId ?? "",
        prestadorNome: sugestao.prestadorNome || current.prestadorNome,
        fornecedorCnpj: sugestao.fornecedorCnpj || current.fornecedorCnpj,
        numeroOrcamento: sugestao.numeroOrcamento || current.numeroOrcamento,
        valorTotal:
          sugestao.valorTotal === null ? current.valorTotal : String(sugestao.valorTotal),
        dataValidade: sugestao.dataValidade ?? current.dataValidade,
        descricao: sugestao.descricao || current.descricao,
      }));
      setConfidence(sugestao.confianca);
      setAlerts(sugestao.alertas ?? []);
      setSuccess("Análise concluída. Confira os dados antes de enviar.");
    } catch (err) {
      setError(
        `${err instanceof Error ? err.message : "A análise automática falhou."} O rascunho foi mantido e os campos podem ser preenchidos manualmente.`,
      );
    } finally {
      setWorking(null);
    }
  };

  const createDraftAndAnalyze = async () => {
    if (!user) return;
    if (!file) {
      setError("Selecione o PDF do orçamento.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("O orçamento deve ser enviado em PDF.");
      return;
    }

    setWorking("uploading");
    setError(null);
    setSuccess(null);
    let uploadedPath: string | null = null;
    try {
      const uploadData = await uploadDocumentFile(
        file,
        "orcamentos_internos/originais",
      );
      uploadedPath = uploadData.path;

      const token = await getToken();
      const response = await fetch("/api/orcamentos-internos", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          submit: false,
          arquivos: [
            {
              path: uploadedPath,
              name: file.name,
              type: "application/pdf",
              size: file.size,
              principal: true,
            },
          ],
        }),
      });
      const payload = (await response.json()) as {
        orcamento?: OrcamentoInterno;
        error?: string;
      };
      if (!response.ok || !payload.orcamento) {
        throw new Error(payload.error ?? "Não foi possível criar o rascunho.");
      }

      uploadedPath = null;
      setDraftId(payload.orcamento.id);
      setAttachedFileName(file.name);
      setFile(null);
      setFileInputKey((current) => current + 1);
      onUpsert(payload.orcamento);
      await analyzeDraft(payload.orcamento.id);
    } catch (err) {
      if (uploadedPath) {
        await supabase.storage.from("formularios").remove([uploadedPath]);
      }
      setError(err instanceof Error ? err.message : "Não foi possível enviar o orçamento.");
      setWorking(null);
    }
  };

  const persistDraft = async (submit: boolean) => {
    if (!draftId) return;
    if (submit && !values.prestadorNome.trim()) {
      setError("Confirme o nome do fornecedor.");
      return;
    }
    if (submit && !values.gestorEmail) {
      setError("Selecione o gestor responsável pela aprovação.");
      return;
    }

    const gestor = gestores.find((item) => item.email === values.gestorEmail);
    setWorking(submit ? "submitting" : "saving");
    setError(null);
    setSuccess(null);
    try {
      const token = await getToken();
      const response = await fetch(`/api/orcamentos-internos/${draftId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: submit ? "enviar_aprovacao" : "salvar_rascunho",
          prestadorId: values.prestadorId || null,
          prestadorNome: values.prestadorNome.trim(),
          fornecedorCnpj: values.fornecedorCnpj.trim() || null,
          numeroOrcamento: values.numeroOrcamento.trim(),
          valorTotal: values.valorTotal || null,
          dataValidade: values.dataValidade || null,
          descricao: values.descricao.trim(),
          gestorId: gestor?.id ?? null,
          gestorEmail: values.gestorEmail || null,
          gestorNome: gestor?.name ?? null,
          observacoes: values.observacoes.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        orcamento?: OrcamentoInterno;
        error?: string;
      };
      if (!response.ok || !payload.orcamento) {
        throw new Error(payload.error ?? "Não foi possível salvar o orçamento.");
      }
      onUpsert(payload.orcamento);
      if (submit) {
        onSubmitted(payload.orcamento);
        resetForm();
      } else {
        setSuccess("Rascunho salvo.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setWorking(null);
    }
  };

  const busy = working !== null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Novo orçamento
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            Envie o PDF, confira a leitura automática e escolha o gestor
          </p>
        </div>
        {draftId ? (
          <button
            type="button"
            onClick={resetForm}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Outro orçamento
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-[11px] font-semibold">
        {["1. PDF", "2. Conferência", "3. Gestor"].map((label, index) => {
          const active = draftId ? index <= 1 : index === 0;
          return (
            <div
              key={label}
              className={`rounded-full px-3 py-1.5 text-center ${
                active ? "bg-sky-50 text-sky-700" : "bg-slate-50 text-slate-400"
              }`}
            >
              {label}
            </div>
          );
        })}
      </div>

      {(error || success) && (
        <div
          className={`mt-4 rounded-xl px-3 py-2 text-xs ${
            error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {error ?? success}
        </div>
      )}

      {!draftId ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            PDF do orçamento
            <input
              key={fileInputKey}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="mt-2 block w-full cursor-pointer text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-sky-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
          </label>
          {file ? <p className="mt-2 truncate text-xs text-slate-600">{file.name}</p> : null}
          <button
            type="button"
            onClick={() => void createDraftAndAnalyze()}
            disabled={!file || busy}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {working === "uploading" || working === "analyzing" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {working === "uploading"
              ? "Enviando PDF..."
              : working === "analyzing"
                ? "Identificando fornecedor..."
                : "Enviar e analisar com IA"}
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
            <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-slate-700">
              <FileSearch className="h-4 w-4 shrink-0" />
              <span className="truncate">{attachedFileName}</span>
            </span>
            <button
              type="button"
              onClick={() => void analyzeDraft(draftId)}
              disabled={busy}
              className="inline-flex items-center gap-1 font-semibold text-sky-700 disabled:opacity-50"
            >
              {working === "analyzing" ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Analisar novamente
            </button>
          </div>

          {confidence !== null ? (
            <p className="text-[11px] text-slate-500">
              Confiança geral da leitura: {Math.round(confidence * 100)}%. Sempre confira os
              dados antes do envio.
            </p>
          ) : null}
          {alerts.length > 0 ? (
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {alerts.join(" ")}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Fornecedor identificado *
              <input
                value={values.prestadorNome}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    prestadorId: "",
                    prestadorNome: event.target.value,
                  }))
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
                  setValues((current) => ({
                    ...current,
                    prestadorId: "",
                    fornecedorCnpj: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Número do orçamento
              <input
                value={values.numeroOrcamento}
                onChange={(event) => updateValue("numeroOrcamento", event.target.value)}
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
                onChange={(event) => updateValue("valorTotal", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Validade
              <input
                type="date"
                value={values.dataValidade}
                onChange={(event) => updateValue("dataValidade", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              />
            </label>
            <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Descrição
              <textarea
                value={values.descricao}
                onChange={(event) => updateValue("descricao", event.target.value)}
                className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              />
            </label>
            <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Gestor responsável *
              <select
                value={values.gestorEmail}
                onChange={(event) => updateValue("gestorEmail", event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              >
                <option value="">Selecione quem avaliará o orçamento</option>
                {gestores.map((gestor) => (
                  <option key={gestor.email} value={gestor.email}>
                    {gestor.name ? `${gestor.name} (${gestor.email})` : gestor.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Observações internas
              <textarea
                value={values.observacoes}
                onChange={(event) => updateValue("observacoes", event.target.value)}
                className="mt-1 min-h-16 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900"
              />
            </label>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => void persistDraft(false)}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {working === "saving" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Salvar rascunho
            </button>
            <button
              type="button"
              onClick={() => void persistDraft(true)}
              disabled={busy || !values.prestadorNome.trim() || !values.gestorEmail}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
            >
              {working === "submitting" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Enviar para aprovação
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
