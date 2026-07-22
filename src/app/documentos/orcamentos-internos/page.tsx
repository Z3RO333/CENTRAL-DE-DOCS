"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FilePlus2,
  History,
  LoaderCircle,
  PenLine,
  RefreshCw,
  Send,
  Signature,
  SlidersHorizontal,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import {
  STATUS_LABEL,
  type OrcamentoInternoStatus,
} from "@/lib/orcamentosInternosShared";
import { formatPersonName } from "@/lib/displayName";

type GestorOption = {
  id: string | null;
  email: string;
  name: string | null;
  role: "admin" | "gerente";
};

type UploadedFileSummary = {
  path: string;
  name: string;
  type: string;
  size: number;
  principal: boolean;
};

type OrcamentoInterno = {
  id: string;
  solicitante_id: string;
  solicitante_email: string | null;
  loja_id: string | null;
  loja_nome: string | null;
  area_solicitante: string;
  prestador_id: string | null;
  prestador_nome: string;
  numero_orcamento: string;
  descricao: string;
  valor_total: number | null;
  data_validade: string | null;
  numero_referencia: string | null;
  gestor_id: string | null;
  gestor_email: string;
  gestor_nome: string | null;
  observacoes: string | null;
  arquivo_original_path: string;
  arquivo_assinado_path: string | null;
  status: OrcamentoInternoStatus;
  versao_atual: number;
  enviado_em: string | null;
  aprovado_em: string | null;
  rejeitado_em: string | null;
  cancelado_em: string | null;
  ultima_justificativa: string | null;
  created_at: string;
  updated_at: string;
};

type Versao = {
  id: string;
  versao: number;
  arquivo_path: string;
  nome_arquivo: string;
  principal: boolean;
  created_at: string;
};

type TimelineEvent = {
  id: string;
  event_type: string;
  actor_email: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type DetailPayload = {
  orcamento: OrcamentoInterno;
  versoes: Versao[];
  timeline: TimelineEvent[];
  canDecide: boolean;
  error?: string;
};

const STATUS_BADGE: Record<OrcamentoInternoStatus, string> = {
  rascunho: "bg-slate-100 text-slate-700 ring-slate-200",
  aguardando_aprovacao: "bg-amber-50 text-amber-700 ring-amber-200",
  em_analise_gestor: "bg-sky-50 text-sky-700 ring-sky-200",
  ajuste_solicitado: "bg-orange-50 text-orange-700 ring-orange-200",
  reenviado: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  aprovado_assinado: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejeitado: "bg-red-50 text-red-700 ring-red-200",
  cancelado: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};

const STORAGE_BUCKET = "formularios";

const statusOptions: Array<{ value: "todos" | OrcamentoInternoStatus; label: string }> = [
  { value: "todos", label: "Todos os status" },
  ...Object.entries(STATUS_LABEL).map(([value, label]) => ({
    value: value as OrcamentoInternoStatus,
    label,
  })),
];

function formatDateTime(value: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("pt-BR");
}

function humanizeEvent(value: string) {
  const labels: Record<string, string> = {
    orcamento_criado: "Orçamento criado",
    orcamento_enviado_aprovacao: "Enviado para aprovação",
    aprovador_atribuido: "Aprovador atribuído",
    orcamento_visualizado_gestor: "Visualizado pelo gestor",
    ajuste_solicitado: "Ajuste solicitado",
    orcamento_reenviado: "Orçamento reenviado",
    orcamento_aprovado: "Orçamento aprovado",
    orcamento_assinado: "Orçamento assinado",
    orcamento_rejeitado: "Orçamento rejeitado",
    aprovador_alterado: "Aprovador alterado",
    documento_baixado: "Documento baixado",
    documento_editado: "Documento editado",
    status_alterado: "Status alterado",
  };
  return labels[value] ?? value.split("_").map((p) => p[0]?.toUpperCase() + p.slice(1)).join(" ");
}

async function getToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Faça login novamente.");
  return token;
}

async function getSignedFileUrl(path: string) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, 60 * 30);
  if (error || !data?.signedUrl) {
    throw error ?? new Error("Não foi possível gerar o link do arquivo.");
  }
  return data.signedUrl;
}

async function downloadPath(path: string) {
  const url = await getSignedFileUrl(path);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Não foi possível baixar o arquivo.");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = path.split("/").pop() ?? "documento.pdf";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export default function OrcamentosInternosPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { isAdmin, loading: accessLoading, modules } = useDocumentsAccess();
  const [tab, setTab] = useState<"meus" | "aprovacao" | "todos">("meus");
  const [orcamentos, setOrcamentos] = useState<OrcamentoInterno[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [principalIndex, setPrincipalIndex] = useState(0);
  const [submitting, setSubmitting] = useState<"draft" | "submit" | null>(null);
  const [gestores, setGestores] = useState<GestorOption[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [gestorFilter, setGestorFilter] = useState("todos");
  const [colaboradorFilter, setColaboradorFilter] = useState("todos");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [reassignEmail, setReassignEmail] = useState("");

  const canAccess = modules.documentos;

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
    if (!authLoading && user && !accessLoading && !canAccess) {
      router.replace("/documentos");
    }
  }, [accessLoading, authLoading, canAccess, router, user]);

  const loadOptions = useCallback(async () => {
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };
      const gestoresRes = await fetch("/api/orcamentos-internos/gestores", { headers });
      if (gestoresRes.ok) {
        const payload = (await gestoresRes.json()) as { gestores?: GestorOption[] };
        setGestores(payload.gestores ?? []);
      }
    } catch (err) {
      console.error("Erro ao carregar opções de orçamento:", err);
    }
  }, []);

  const loadOrcamentos = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const params = new URLSearchParams({ tab, limit: "50", offset: "0" });
      if (statusFilter !== "todos") params.set("status", statusFilter);
      if (gestorFilter !== "todos") params.set("gestor", gestorFilter);
      if (colaboradorFilter !== "todos") params.set("colaborador", colaboradorFilter);
      if (dataInicio) params.set("dataInicio", dataInicio);
      if (dataFim) params.set("dataFim", dataFim);
      const response = await fetch(`/api/orcamentos-internos?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json()) as {
        orcamentos?: OrcamentoInterno[];
        total?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Falha ao carregar.");
      setOrcamentos(payload.orcamentos ?? []);
      setTotal(payload.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar.");
    } finally {
      setLoading(false);
    }
  }, [colaboradorFilter, dataFim, dataInicio, gestorFilter, statusFilter, tab, user]);

  useEffect(() => {
    if (user) {
      void loadOptions();
    }
  }, [loadOptions, user]);

  useEffect(() => {
    if (user) {
      void loadOrcamentos();
    }
  }, [loadOrcamentos, user]);

  const aguardandoCount = useMemo(
    () =>
      orcamentos.filter((item) =>
        ["aguardando_aprovacao", "em_analise_gestor", "reenviado"].includes(item.status),
      ).length,
    [orcamentos],
  );

  const selectedDetail = detail?.orcamento ?? null;
  const colaboradorOptions = useMemo(() => {
    const map = new Map<string, string>();
    orcamentos.forEach((orcamento) => {
      map.set(
        orcamento.solicitante_id,
        orcamento.solicitante_email ?? orcamento.solicitante_id,
      );
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [orcamentos]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const response = await fetch(`/api/orcamentos-internos/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json()) as DetailPayload;
      if (!response.ok) throw new Error(payload.error ?? "Falha ao carregar detalhes.");
      setDetail(payload);
      setReassignEmail(payload.orcamento.gestor_email ?? "");
      setOrcamentos((current) =>
        current.map((item) => (item.id === payload.orcamento.id ? payload.orcamento : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar detalhes.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openDetail = (id: string) => {
    setDetailId(id);
    setJustificativa("");
    void loadDetail(id);
  };

  const uploadSelectedFiles = async () => {
    if (!user) throw new Error("Sessão expirada.");
    if (files.length === 0) {
      throw new Error("Selecione ao menos um PDF.");
    }
    const uploads: UploadedFileSummary[] = [];
    for (const [index, file] of files.entries()) {
      const ext = file.name.split(".").pop() ?? "pdf";
      const path = `${user.id}/orcamentos_internos/originais/${Date.now()}-${index}.${ext}`;
      const { data, error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file);
      if (uploadError || !data) {
        throw uploadError ?? new Error("Erro ao enviar arquivo.");
      }
      uploads.push({
        path: data.path ?? path,
        name: file.name,
        type: file.type,
        size: file.size,
        principal: index === principalIndex,
      });
    }
    return uploads;
  };

  const saveOrSubmit = async (submit: boolean) => {
    setSubmitting(submit ? "submit" : "draft");
    setError(null);
    setSuccess(null);
    try {
      const token = await getToken();
      const arquivos = await uploadSelectedFiles();
      const response = await fetch("/api/orcamentos-internos", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          submit,
          arquivos,
        }),
      });
      const payload = (await response.json()) as {
        orcamento?: OrcamentoInterno;
        error?: string;
      };
      if (!response.ok || !payload.orcamento) {
        throw new Error(payload.error ?? "Não foi possível salvar o orçamento.");
      }
      setSuccess(submit ? "Orçamento enviado para aprovação." : "Rascunho salvo.");
      setFiles([]);
      setPrincipalIndex(0);
      setOrcamentos((current) => [payload.orcamento!, ...current]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSubmitting(null);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void saveOrSubmit(true);
  };

  const patchAction = async (
    id: string,
    body: Record<string, unknown>,
    successMessage: string,
  ) => {
    setActionLoading(String(body.action ?? "acao"));
    setError(null);
    try {
      const token = await getToken();
      const response = await fetch(`/api/orcamentos-internos/${id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        orcamento?: OrcamentoInterno;
        error?: string;
      };
      if (!response.ok || !payload.orcamento) {
        throw new Error(payload.error ?? "Ação não concluída.");
      }
      setSuccess(successMessage);
      setOrcamentos((current) =>
        current.map((item) => (item.id === payload.orcamento!.id ? payload.orcamento! : item)),
      );
      await loadDetail(id);
      void loadOrcamentos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ação não concluída.");
    } finally {
      setActionLoading(null);
    }
  };

  const signAndApprove = async (orcamento: OrcamentoInterno) => {
    if (!user) return;
    setActionLoading("aprovar_assinar");
    setError(null);
    try {
      const originalUrl = await getSignedFileUrl(orcamento.arquivo_original_path);
      const originalBytes = await fetch(originalUrl).then((res) => {
        if (!res.ok) throw new Error("Não foi possível baixar o PDF original.");
        return res.arrayBuffer();
      });
      const pdfDoc = await PDFDocument.load(originalBytes);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const pages = pdfDoc.getPages();
      const page = pages[pages.length - 1];

      const displayName =
        formatPersonName({
          name: (user.user_metadata?.name as string | undefined) ?? null,
          fullName: (user.user_metadata?.full_name as string | undefined) ?? null,
          email: user.email ?? null,
        }) ||
        user.email ||
        "Gestor aprovador";

      const approvedAt = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const offsetMinutesTotal = -approvedAt.getTimezoneOffset();
      const offsetSign = offsetMinutesTotal >= 0 ? "+" : "-";
      const offsetHours = pad(Math.floor(Math.abs(offsetMinutesTotal) / 60));
      const offsetMinutes = pad(Math.abs(offsetMinutesTotal) % 60);
      const dadosLabel = `Dados: ${approvedAt.getFullYear()}.${pad(approvedAt.getMonth() + 1)}.${pad(approvedAt.getDate())} ${pad(approvedAt.getHours())}:${pad(approvedAt.getMinutes())}:${pad(approvedAt.getSeconds())} ${offsetSign}${offsetHours}'${offsetMinutes}'`;

      const stampX = 48;
      const stampBaseY = 54;
      page.drawText("Assinado de forma digital por", {
        x: stampX,
        y: stampBaseY + 24,
        size: 8,
        font,
        color: rgb(0.4, 0.45, 0.5),
      });
      page.drawText(displayName, {
        x: stampX,
        y: stampBaseY + 12,
        size: 12,
        font: fontBold,
        color: rgb(0.1, 0.12, 0.16),
      });
      page.drawText(dadosLabel, {
        x: stampX,
        y: stampBaseY,
        size: 8,
        font,
        color: rgb(0.4, 0.45, 0.5),
      });

      const bytes = await pdfDoc.save();
      const pdfBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(pdfBuffer).set(bytes);
      const blob = new Blob([pdfBuffer], { type: "application/pdf" });
      const signedPath = `${user.id}/orcamentos_internos/assinados/${orcamento.id}-${Date.now()}.pdf`;
      const { data, error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(signedPath, blob, { contentType: "application/pdf" });
      if (uploadError || !data) {
        throw uploadError ?? new Error("Não foi possível enviar o PDF assinado.");
      }
      await patchAction(
        orcamento.id,
        {
          action: "aprovar_assinar",
          signedFile: {
            path: data.path ?? signedPath,
            name: signedPath.split("/").pop(),
            type: "application/pdf",
            size: blob.size,
          },
        },
        "Orçamento aprovado e assinado.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível assinar.");
    } finally {
      setActionLoading(null);
    }
  };

  const baixarArquivo = async (orcamento: OrcamentoInterno, signed: boolean) => {
    const path = signed ? orcamento.arquivo_assinado_path : orcamento.arquivo_original_path;
    if (!path) {
      setError("Arquivo indisponível.");
      return;
    }
    try {
      await downloadPath(path);
      const token = await getToken();
      await fetch(`/api/orcamentos-internos/${orcamento.id}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ arquivo_path: path, signed }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível baixar.");
    }
  };

  const abrirArquivo = async (path: string | null) => {
    if (!path) {
      setError("Arquivo indisponível.");
      return;
    }
    try {
      const url = await getSignedFileUrl(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível abrir.");
    }
  };

  if (authLoading || accessLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando orçamentos internos...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => router.back()}
            className="mb-2 text-xs text-slate-500 hover:text-sky-600"
          >
            Voltar
          </button>
          <div className="flex items-center gap-2">
            <FilePlus2 className="h-5 w-5 text-slate-700" />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Orçamentos Internos
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Envio, análise, assinatura e consulta centralizada de orçamentos internos.
          </p>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">{aguardandoCount} aguardando aprovação</p>
          <p className="text-xs">Fila atual conforme os filtros aplicados.</p>
        </div>
      </header>

      {(error || success) && (
        <div
          className={`rounded-2xl px-4 py-3 text-sm ${
            error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {error ?? success}
        </div>
      )}

      <section className="grid gap-5 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.5fr)]">
        <form
          onSubmit={handleSubmit}
          className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-100"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Novo orçamento
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              Cadastro pelo auxiliar administrativo
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Ao enviar, o orçamento fica disponível para qualquer aprovador da fila.
            </p>
          </div>

          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Orçamentos em PDF
              <input
                required
                multiple
                type="file"
                accept="application/pdf"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const selected = event.target.files ? Array.from(event.target.files) : [];
                  setFiles(selected);
                  setPrincipalIndex(0);
                }}
                className="mt-2 block w-full cursor-pointer text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-sky-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
              />
            </label>
            {files.length > 0 && (
              <div className="mt-3 space-y-2">
                {files.map((file, index) => (
                  <label
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs text-slate-700"
                  >
                    <span className="truncate">{file.name}</span>
                    <span className="inline-flex items-center gap-1">
                      <input
                        type="radio"
                        name="principal"
                        checked={principalIndex === index}
                        onChange={() => setPrincipalIndex(index)}
                      />
                      Principal
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => void saveOrSubmit(false)}
              disabled={Boolean(submitting)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <PenLine className="h-4 w-4" />
              {submitting === "draft" ? "Salvando..." : "Salvar rascunho"}
            </button>
            <button
              type="submit"
              disabled={Boolean(submitting)}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              {submitting === "submit" ? "Enviando..." : "Enviar para aprovação"}
            </button>
          </div>
        </form>

        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {[
                ["meus", "Meus orçamentos"],
                ["aprovacao", "Aguardando minha aprovação"],
                ...(isAdmin ? [["todos", "Todos os orçamentos"]] : []),
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value as "meus" | "aprovacao" | "todos")}
                  className={`rounded-full px-4 py-2 text-xs font-semibold ${
                    tab === value
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void loadOrcamentos()}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </button>
          </div>

          <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3 md:grid-cols-4">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs normal-case tracking-normal text-slate-800"
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Gestor
              <select
                value={gestorFilter}
                onChange={(event) => setGestorFilter(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs normal-case tracking-normal text-slate-800"
              >
                <option value="todos">Todos</option>
                {gestores.map((gestor) => (
                  <option key={gestor.email} value={gestor.email}>
                    {gestor.name ?? gestor.email}
                  </option>
                ))}
              </select>
            </label>
            {isAdmin ? (
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Colaborador
                <select
                  value={colaboradorFilter}
                  onChange={(event) => setColaboradorFilter(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs normal-case tracking-normal text-slate-800"
                >
                  <option value="todos">Todos</option>
                  {colaboradorOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <input
              value={dataInicio}
              onChange={(event) => setDataInicio(event.target.value)}
              type="date"
              className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"
              aria-label="Data inicial"
            />
            <input
              value={dataFim}
              onChange={(event) => setDataFim(event.target.value)}
              type="date"
              className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"
              aria-label="Data final"
            />
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-2 font-semibold">
                <SlidersHorizontal className="h-4 w-4" />
                {total} registro(s)
              </span>
              {loading ? (
                <span className="inline-flex items-center gap-1">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  Carregando
                </span>
              ) : null}
            </div>
            {orcamentos.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                Nenhum orçamento encontrado.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Orçamento</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Gestor</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orcamentos.map((orcamento) => {
                      return (
                        <tr key={orcamento.id} className="align-top">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-900">
                              {orcamento.numero_orcamento || orcamento.id.slice(0, 8)}
                            </p>
                            <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                              {orcamento.descricao}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${
                                STATUS_BADGE[orcamento.status]
                              }`}
                            >
                              {STATUS_LABEL[orcamento.status]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            {orcamento.gestor_nome || orcamento.gestor_email || "--"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openDetail(orcamento.id)}
                                className="rounded-full border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                                aria-label="Abrir detalhes"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void baixarArquivo(orcamento, false)}
                                className="rounded-full border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                                aria-label="Baixar original"
                              >
                                <Download className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </section>

      {detailId ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
          onClick={() => {
            setDetailId(null);
            setDetail(null);
          }}
        >
          <aside
            className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Detalhes do orçamento
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">
                  {selectedDetail?.numero_orcamento ?? detailId.slice(0, 8)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDetailId(null);
                  setDetail(null);
                }}
                className="rounded-full bg-slate-100 p-2 text-slate-600"
                aria-label="Fechar"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {detailLoading || !detail || !selectedDetail ? (
                <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Carregando detalhes...
                </div>
              ) : (
                <div className="space-y-5">
                  <section className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
                    {[
                      ["Status", STATUS_LABEL[selectedDetail.status]],
                      ["Solicitante", selectedDetail.solicitante_email ?? selectedDetail.solicitante_id],
                      ["Gestor", selectedDetail.gestor_nome || selectedDetail.gestor_email || "--"],
                      ["Enviado em", formatDateTime(selectedDetail.enviado_em)],
                      ["Aprovado em", formatDateTime(selectedDetail.aprovado_em)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {label}
                        </p>
                        <p className="mt-1 text-sm font-medium text-slate-900">{value}</p>
                      </div>
                    ))}
                    {selectedDetail.ultima_justificativa ? (
                      <div className="sm:col-span-2 rounded-xl bg-orange-50 px-3 py-2 text-sm text-orange-800">
                        {selectedDetail.ultima_justificativa}
                      </div>
                    ) : null}
                  </section>

                  <section className="rounded-2xl border border-slate-100 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <FilePlus2 className="h-4 w-4 text-slate-500" />
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Arquivos e versões
                      </p>
                    </div>
                    <div className="space-y-2">
                      {detail.versoes.map((versao) => (
                        <div
                          key={versao.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs"
                        >
                          <span className="font-semibold text-slate-700">
                            v{versao.versao} {versao.principal ? "- principal" : ""} · {versao.nome_arquivo}
                          </span>
                          <button
                            type="button"
                            onClick={() => void abrirArquivo(versao.arquivo_path)}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Abrir
                          </button>
                        </div>
                      ))}
                      {selectedDetail.arquivo_assinado_path ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                          <span className="font-semibold">Arquivo assinado disponível</span>
                          <button
                            type="button"
                            onClick={() => void baixarArquivo(selectedDetail, true)}
                            className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 font-semibold"
                          >
                            <Download className="h-3 w-3" />
                            Baixar assinado
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-100 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <History className="h-4 w-4 text-slate-500" />
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Timeline
                      </p>
                    </div>
                    <div className="space-y-3">
                      {detail.timeline.map((event) => (
                        <div key={event.id} className="border-l-2 border-sky-200 pl-3">
                          <p className="text-sm font-semibold text-slate-900">
                            {humanizeEvent(event.event_type)}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {formatDateTime(event.created_at)}
                            {event.actor_email ? ` por ${event.actor_email}` : ""}
                          </p>
                          {typeof event.metadata?.justificativa === "string" ? (
                            <p className="mt-1 text-xs text-slate-600">
                              {event.metadata.justificativa}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              )}
            </div>

            {selectedDetail ? (
              <footer className="border-t border-slate-100 bg-white px-5 py-4">
                <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    value={justificativa}
                    onChange={(event) => setJustificativa(event.target.value)}
                    placeholder="Justificativa para ajuste, rejeição ou cancelamento"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void abrirArquivo(selectedDetail.arquivo_original_path)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Ver original
                  </button>
                </div>
                {isAdmin ? (
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                    <select
                      value={reassignEmail}
                      onChange={(event) => setReassignEmail(event.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800"
                      aria-label="Novo gestor aprovador"
                    >
                      <option value="">Selecione um gestor</option>
                      {gestores.map((gestor) => (
                        <option key={gestor.email} value={gestor.email}>
                          {gestor.name
                            ? `${gestor.name} (${gestor.email})`
                            : gestor.email}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={Boolean(actionLoading) || !reassignEmail}
                      onClick={() => {
                        const gestor = gestores.find(
                          (item) => item.email === reassignEmail,
                        );
                        void patchAction(
                          selectedDetail.id,
                          {
                            action: "reatribuir_gestor",
                            gestorEmail: reassignEmail,
                            gestorId: gestor?.id ?? null,
                            gestorNome: gestor?.name ?? null,
                          },
                          "Gestor reatribuído.",
                        );
                      }}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Reatribuir gestor
                    </button>
                  </div>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2 text-xs">
                  {detail?.canDecide ? (
                    <>
                      <button
                        type="button"
                        disabled={Boolean(actionLoading)}
                        onClick={() => void signAndApprove(selectedDetail)}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
                      >
                        <Signature className="h-4 w-4" />
                        {actionLoading === "aprovar_assinar" ? "Assinando..." : "Aprovar e assinar"}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(actionLoading)}
                        onClick={() =>
                          void patchAction(
                            selectedDetail.id,
                            { action: "solicitar_ajuste", justificativa },
                            "Ajuste solicitado.",
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 font-semibold text-orange-700 disabled:opacity-60"
                      >
                        <TriangleAlert className="h-4 w-4" />
                        Solicitar ajuste
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(actionLoading)}
                        onClick={() =>
                          void patchAction(
                            selectedDetail.id,
                            { action: "rejeitar", justificativa },
                            "Orçamento rejeitado.",
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 font-semibold text-red-700 disabled:opacity-60"
                      >
                        <XCircle className="h-4 w-4" />
                        Rejeitar
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(actionLoading)}
                        onClick={() =>
                          void patchAction(
                            selectedDetail.id,
                            { action: "devolver_sem_decisao" },
                            "Orçamento devolvido para a fila.",
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 disabled:opacity-60"
                      >
                        <Clock className="h-4 w-4" />
                        Devolver sem decisão
                      </button>
                    </>
                  ) : null}
                  {selectedDetail.status === "ajuste_solicitado" &&
                  selectedDetail.solicitante_id === user.id ? (
                    <button
                      type="button"
                      disabled={files.length === 0 || Boolean(actionLoading)}
                      onClick={async () => {
                        try {
                          setActionLoading("reenviar");
                          const arquivos = await uploadSelectedFiles();
                          await patchAction(
                            selectedDetail.id,
                            { action: "reenviar", arquivos },
                            "Orçamento reenviado para aprovação.",
                          );
                          setFiles([]);
                        } finally {
                          setActionLoading(null);
                        }
                      }}
                      className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
                    >
                      <Send className="h-4 w-4" />
                      Reenviar ajuste
                    </button>
                  ) : null}
                  {isAdmin ? (
                    <button
                      type="button"
                      disabled={Boolean(actionLoading)}
                      onClick={() =>
                        void patchAction(
                          selectedDetail.id,
                          { action: "cancelar", justificativa },
                          "Orçamento cancelado.",
                        )
                      }
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 disabled:opacity-60"
                    >
                      <XCircle className="h-4 w-4" />
                      Cancelar
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void loadDetail(selectedDetail.id)}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Atualizar histórico
                  </button>
                </div>
              </footer>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
