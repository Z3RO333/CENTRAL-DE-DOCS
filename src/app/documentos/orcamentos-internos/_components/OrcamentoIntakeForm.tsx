"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import type { ColaboradorOption, OrcamentoInterno } from "../_lib/orcamentosTypes";
import { uploadDocumentFile } from "@/lib/documentUpload";
import {
  EMPTY_REVIEW_VALUES,
  OrcamentoReviewCard,
  type ReviewValues,
} from "./OrcamentoReviewCard";

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

type BulkDraft = {
  orcamentoId: string;
  fileName: string;
  values: ReviewValues;
  confidence: number | null;
  alerts: string[];
  busy: "analyzing" | "saving" | "submitting" | null;
  error: string | null;
  success: string | null;
};

type Props = {
  colaboradores: ColaboradorOption[];
  draftToResume: OrcamentoInterno | null;
  onUpsert: (orcamento: OrcamentoInterno) => void;
  onSubmitted: (orcamento: OrcamentoInterno) => void;
  onResumeHandled: () => void;
};

async function getToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Faça login novamente.");
  return token;
}

function sugestaoToValues(
  sugestao: NonNullable<AnalisePayload["sugestao"]>,
  current: ReviewValues,
): ReviewValues {
  return {
    ...current,
    prestadorId: sugestao.prestadorId ?? "",
    prestadorNome: sugestao.prestadorNome || current.prestadorNome,
    fornecedorCnpj: sugestao.fornecedorCnpj || current.fornecedorCnpj,
    numeroOrcamento: sugestao.numeroOrcamento || current.numeroOrcamento,
    valorTotal:
      sugestao.valorTotal === null ? current.valorTotal : String(sugestao.valorTotal),
    dataValidade: sugestao.dataValidade ?? current.dataValidade,
    descricao: sugestao.descricao || current.descricao,
  };
}

export function OrcamentoIntakeForm({
  colaboradores,
  draftToResume,
  onUpsert,
  onSubmitted,
  onResumeHandled,
}: Props) {
  const { user } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [solicitanteId, setSolicitanteId] = useState("");

  const [draftId, setDraftId] = useState<string | null>(null);
  const [attachedFileName, setAttachedFileName] = useState("");
  const [values, setValues] = useState<ReviewValues>(EMPTY_REVIEW_VALUES);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [working, setWorking] = useState<
    "uploading" | "analyzing" | "saving" | "submitting" | null
  >(null);

  const [bulkDrafts, setBulkDrafts] = useState<BulkDraft[]>([]);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [bulkFailed, setBulkFailed] = useState<string[]>([]);

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
      observacoes: draftToResume.observacoes ?? "",
    });
    setSolicitanteId("");
    setFiles([]);
    setBulkDrafts([]);
    setConfidence(null);
    setAlerts([]);
    setError(null);
    setSuccess("Rascunho aberto para continuar.");
    onResumeHandled();
  }, [draftToResume, onResumeHandled]);

  const resetForm = () => {
    setFiles([]);
    setFileInputKey((current) => current + 1);
    setSolicitanteId("");
    setDraftId(null);
    setAttachedFileName("");
    setValues(EMPTY_REVIEW_VALUES);
    setConfidence(null);
    setAlerts([]);
    setBulkDrafts([]);
    setBulkCreating(false);
    setBulkProgress(null);
    setBulkFailed([]);
    setError(null);
    setSuccess(null);
  };

  const uploadAndCreateDraft = async (file: File) => {
    const uploadData = await uploadDocumentFile(file, "orcamentos_internos/originais");
    try {
      const token = await getToken();
      const response = await fetch("/api/orcamentos-internos", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          submit: false,
          solicitanteId: solicitanteId || null,
          arquivos: [
            {
              path: uploadData.path,
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
      return payload.orcamento;
    } catch (err) {
      await supabase.storage.from("formularios").remove([uploadData.path]);
      throw err;
    }
  };

  const runAnalysis = async (id: string) => {
    const token = await getToken();
    const response = await fetch(`/api/orcamentos-internos/${id}/analisar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = (await response.json()) as AnalisePayload;
    if (!response.ok || !payload.sugestao) {
      throw new Error(payload.error ?? "Não foi possível analisar o orçamento.");
    }
    return payload.sugestao;
  };

  const analyzeDraft = async (id: string) => {
    setWorking("analyzing");
    setError(null);
    setSuccess(null);
    try {
      const sugestao = await runAnalysis(id);
      setValues((current) => sugestaoToValues(sugestao, current));
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

  const startSingleFlow = async (file: File) => {
    if (!user) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("O orçamento deve ser enviado em PDF.");
      return;
    }
    setWorking("uploading");
    setError(null);
    setSuccess(null);
    try {
      const orcamento = await uploadAndCreateDraft(file);
      setDraftId(orcamento.id);
      setAttachedFileName(file.name);
      setFiles([]);
      setFileInputKey((current) => current + 1);
      onUpsert(orcamento);
      await analyzeDraft(orcamento.id);
    } catch (err) {
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

  const startBulkFlow = async (selectedFiles: File[]) => {
    if (!user) return;
    setError(null);
    setSuccess(null);
    setBulkFailed([]);
    setBulkCreating(true);
    setBulkProgress({ current: 0, total: selectedFiles.length });

    const failed: string[] = [];
    for (let index = 0; index < selectedFiles.length; index += 1) {
      const file = selectedFiles[index];
      setBulkProgress({ current: index + 1, total: selectedFiles.length });
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        failed.push(`${file.name} (não é PDF)`);
        continue;
      }
      try {
        const orcamento = await uploadAndCreateDraft(file);
        onUpsert(orcamento);
        const entry: BulkDraft = {
          orcamentoId: orcamento.id,
          fileName: file.name,
          values: EMPTY_REVIEW_VALUES,
          confidence: null,
          alerts: [],
          busy: "analyzing",
          error: null,
          success: null,
        };
        setBulkDrafts((current) => [...current, entry]);

        try {
          const sugestao = await runAnalysis(orcamento.id);
          setBulkDrafts((current) =>
            current.map((item) =>
              item.orcamentoId === orcamento.id
                ? {
                    ...item,
                    values: sugestaoToValues(sugestao, item.values),
                    confidence: sugestao.confianca,
                    alerts: sugestao.alertas ?? [],
                    busy: null,
                  }
                : item,
            ),
          );
        } catch (analyzeErr) {
          setBulkDrafts((current) =>
            current.map((item) =>
              item.orcamentoId === orcamento.id
                ? {
                    ...item,
                    busy: null,
                    error:
                      analyzeErr instanceof Error
                        ? analyzeErr.message
                        : "A análise automática falhou. Preencha os campos manualmente.",
                  }
                : item,
            ),
          );
        }
      } catch (createErr) {
        failed.push(
          `${file.name} (${createErr instanceof Error ? createErr.message : "falha ao enviar"})`,
        );
      }
    }

    setBulkCreating(false);
    setBulkProgress(null);
    setFiles([]);
    setFileInputKey((current) => current + 1);
    setBulkFailed(failed);
  };

  const updateBulkDraftValues = (orcamentoId: string, next: ReviewValues) => {
    setBulkDrafts((current) =>
      current.map((item) => (item.orcamentoId === orcamentoId ? { ...item, values: next } : item)),
    );
  };

  const reanalyzeBulkDraft = async (orcamentoId: string) => {
    setBulkDrafts((current) =>
      current.map((item) =>
        item.orcamentoId === orcamentoId
          ? { ...item, busy: "analyzing", error: null, success: null }
          : item,
      ),
    );
    try {
      const sugestao = await runAnalysis(orcamentoId);
      setBulkDrafts((current) =>
        current.map((item) =>
          item.orcamentoId === orcamentoId
            ? {
                ...item,
                values: sugestaoToValues(sugestao, item.values),
                confidence: sugestao.confianca,
                alerts: sugestao.alertas ?? [],
                busy: null,
                success: "Análise concluída.",
              }
            : item,
        ),
      );
    } catch (err) {
      setBulkDrafts((current) =>
        current.map((item) =>
          item.orcamentoId === orcamentoId
            ? {
                ...item,
                busy: null,
                error: err instanceof Error ? err.message : "A análise automática falhou.",
              }
            : item,
        ),
      );
    }
  };

  const persistBulkDraft = async (orcamentoId: string, submit: boolean) => {
    const entry = bulkDrafts.find((item) => item.orcamentoId === orcamentoId);
    if (!entry) return;
    if (submit && !entry.values.prestadorNome.trim()) {
      setBulkDrafts((current) =>
        current.map((item) =>
          item.orcamentoId === orcamentoId
            ? { ...item, error: "Confirme o nome do fornecedor.", success: null }
            : item,
        ),
      );
      return;
    }
    setBulkDrafts((current) =>
      current.map((item) =>
        item.orcamentoId === orcamentoId
          ? { ...item, busy: submit ? "submitting" : "saving", error: null, success: null }
          : item,
      ),
    );
    try {
      const token = await getToken();
      const response = await fetch(`/api/orcamentos-internos/${orcamentoId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: submit ? "enviar_aprovacao" : "salvar_rascunho",
          prestadorId: entry.values.prestadorId || null,
          prestadorNome: entry.values.prestadorNome.trim(),
          fornecedorCnpj: entry.values.fornecedorCnpj.trim() || null,
          numeroOrcamento: entry.values.numeroOrcamento.trim(),
          valorTotal: entry.values.valorTotal || null,
          dataValidade: entry.values.dataValidade || null,
          descricao: entry.values.descricao.trim(),
          observacoes: entry.values.observacoes.trim() || null,
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
        setBulkDrafts((current) => current.filter((item) => item.orcamentoId !== orcamentoId));
      } else {
        setBulkDrafts((current) =>
          current.map((item) =>
            item.orcamentoId === orcamentoId
              ? { ...item, busy: null, success: "Rascunho salvo." }
              : item,
          ),
        );
      }
    } catch (err) {
      setBulkDrafts((current) =>
        current.map((item) =>
          item.orcamentoId === orcamentoId
            ? {
                ...item,
                busy: null,
                error: err instanceof Error ? err.message : "Não foi possível salvar.",
              }
            : item,
        ),
      );
    }
  };

  const handleSend = () => {
    if (files.length === 0) {
      setError("Selecione ao menos um PDF de orçamento.");
      return;
    }
    if (files.length === 1) {
      void startSingleFlow(files[0]);
    } else {
      void startBulkFlow(files);
    }
  };

  const idle = !draftId && bulkDrafts.length === 0;
  const busy = working !== null || bulkCreating;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Novo orçamento
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            Envie o PDF e confira a leitura automática
          </p>
        </div>
        {!idle ? (
          <button
            type="button"
            onClick={resetForm}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            {bulkDrafts.length > 0 ? "Novo lote" : "Outro orçamento"}
          </button>
        ) : null}
      </div>

      {idle || draftId ? (
        <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] font-semibold">
          {["1. PDF", "2. Conferência"].map((label, index) => {
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
      ) : null}

      {(error || success) && (
        <div
          className={`mt-4 rounded-xl px-3 py-2 text-xs ${
            error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {error ?? success}
        </div>
      )}

      {bulkFailed.length > 0 ? (
        <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Alguns arquivos não puderam ser enviados: {bulkFailed.join(", ")}
        </div>
      ) : null}

      {idle && colaboradores.length > 0 ? (
        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Enviar em nome de
          <select
            value={solicitanteId}
            onChange={(event) => setSolicitanteId(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs normal-case tracking-normal text-slate-800"
          >
            <option value="">Eu mesmo</option>
            {colaboradores.map((colaborador) => (
              <option key={colaborador.id} value={colaborador.id}>
                {colaborador.name ?? colaborador.email}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {idle ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            PDF do orçamento (pode selecionar vários)
            <input
              key={fileInputKey}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              className="mt-2 block w-full cursor-pointer text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-sky-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
          </label>
          {files.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {files.map((selectedFile, index) => (
                <li key={`${selectedFile.name}-${index}`} className="truncate">
                  {selectedFile.name}
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={handleSend}
            disabled={files.length === 0 || busy}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {working === "uploading" || working === "analyzing" || bulkCreating ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {bulkProgress
              ? `Processando ${bulkProgress.current} de ${bulkProgress.total}...`
              : working === "uploading"
                ? "Enviando PDF..."
                : working === "analyzing"
                  ? "Identificando fornecedor..."
                  : files.length > 1
                    ? `Enviar e analisar ${files.length} orçamentos`
                    : "Enviar e analisar com IA"}
          </button>
        </div>
      ) : null}

      {draftId ? (
        <div className="mt-4">
          <OrcamentoReviewCard
            fileName={attachedFileName}
            values={values}
            onChange={setValues}
            confidence={confidence}
            alerts={alerts}
            onReanalyze={() => void analyzeDraft(draftId)}
            onSaveDraft={() => void persistDraft(false)}
            onSubmit={() => void persistDraft(true)}
            busy={working}
            error={null}
            success={null}
          />
        </div>
      ) : null}

      {bulkDrafts.length > 0 ? (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-slate-500">
            Revise os dados de cada orçamento e envie individualmente.
          </p>
          {bulkDrafts.map((entry) => (
            <OrcamentoReviewCard
              key={entry.orcamentoId}
              fileName={entry.fileName}
              values={entry.values}
              onChange={(next) => updateBulkDraftValues(entry.orcamentoId, next)}
              confidence={entry.confidence}
              alerts={entry.alerts}
              onReanalyze={() => void reanalyzeBulkDraft(entry.orcamentoId)}
              onSaveDraft={() => void persistBulkDraft(entry.orcamentoId, false)}
              onSubmit={() => void persistBulkDraft(entry.orcamentoId, true)}
              busy={entry.busy}
              error={entry.error}
              success={entry.success}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
