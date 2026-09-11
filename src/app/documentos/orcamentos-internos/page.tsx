"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Download,
  Eye,
  ExternalLink,
  FilePlus2,
  FileText,
  Plus,
  X,
  History,
  LoaderCircle,
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
import { useIsAprovadorInterno } from "@/hooks/useIsAprovadorInterno";
import {
  STATUS_LABEL,
  type OrcamentoInternoStatus,
} from "@/lib/orcamentosInternosShared";
import { uploadDocumentFile } from "@/lib/documentUpload";
import { StatusBadge } from "@/components/StatusBadge";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { OrcamentoModal } from "./_components/OrcamentoModal";
import {
  EMPTY_FILTERS,
  OrcamentoFiltersPanel,
  type OrcamentoFilters,
} from "./_components/OrcamentoFiltersModal";
import { OrcamentoIntakeForm } from "./_components/OrcamentoIntakeForm";
import type {
  ColaboradorOption,
  GestorOption,
  OrcamentoInterno,
} from "./_lib/orcamentosTypes";

type UploadedFileSummary = {
  path: string;
  name: string;
  type: string;
  size: number;
  principal: boolean;
};

type Versao = {
  id: string;
  versao: number;
  arquivo_path: string;
  nome_arquivo: string;
  principal: boolean;
  arquivo_assinado_path: string | null;
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

type PreviewDocument = {
  path: string;
  name: string;
  kind: "Original" | "Assinado";
};

const STORAGE_BUCKET = "formularios";

function formatDateTime(value: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("pt-BR");
}

function formatCurrency(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function humanizeEvent(value: string) {
  const labels: Record<string, string> = {
    orcamento_criado: "Orçamento criado",
    orcamento_analisado_ia: "Dados extraídos pela IA",
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
    numero_pedido_registrado: "Número do pedido registrado",
    orcamento_pdf_substituido: "PDF substituído e assinado novamente",
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

function buildAssinadoFileName(nomeOriginal: string) {
  const match = nomeOriginal.match(/^(.*)(\.pdf)$/i);
  return match ? `${match[1]} (assinado)${match[2]}` : `${nomeOriginal} (assinado)`;
}

async function downloadPath(path: string, fileName?: string) {
  const url = await getSignedFileUrl(path);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Não foi possível baixar o arquivo.");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName ?? path.split("/").pop() ?? "documento.pdf";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export default function OrcamentosInternosPage() {
  const { confirm, confirmationDialog } = useConfirmDialog();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { isAdmin, loading: accessLoading, modules } = useDocumentsAccess();
  const { isAprovadorInterno, loading: aprovadorLoading } = useIsAprovadorInterno();
  const isGestor = isAdmin || isAprovadorInterno;
  const [tab, setTab] = useState<"meus" | "aprovacao" | "todos">("meus");
  const [orcamentos, setOrcamentos] = useState<OrcamentoInterno[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [principalIndex, setPrincipalIndex] = useState(0);
  const [gestores, setGestores] = useState<GestorOption[]>([]);
  const [colaboradores, setColaboradores] = useState<ColaboradorOption[]>([]);
  const [colaboradoresEnviaram, setColaboradoresEnviaram] = useState<ColaboradorOption[]>([]);
  const [draftToResume, setDraftToResume] = useState<OrcamentoInterno | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [filters, setFilters] = useState<OrcamentoFilters>(EMPTY_FILTERS);
  const { statusFilter, gestorFilter, colaboradorFilter, dataInicio, dataFim } = filters;
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [numeroPedido, setNumeroPedido] = useState("");
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [replacementValor, setReplacementValor] = useState("");
  const [previewDocument, setPreviewDocument] = useState<PreviewDocument | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const deepLinkHandledRef = useRef(false);

  const canAccess = modules.documentos;
  const visibleTabs = [
    ["meus", "Meus orçamentos"],
    ...(isGestor ? [["aprovacao", "Aguardando minha aprovação"], ["todos", "Todos os orçamentos"]] : []),
  ];

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
    if (!authLoading && user && !accessLoading && !canAccess) {
      router.replace("/documentos");
    }
  }, [accessLoading, authLoading, canAccess, router, user]);

  useEffect(() => {
    if (!accessLoading && !aprovadorLoading && !isGestor && tab !== "meus") {
      setTab("meus");
    }
  }, [accessLoading, aprovadorLoading, isGestor, tab]);

  const loadOptions = useCallback(async () => {
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };
      const gestoresRes = await fetch("/api/orcamentos-internos/gestores", { headers });
      if (gestoresRes.ok) {
        const payload = (await gestoresRes.json()) as { gestores?: GestorOption[] };
        setGestores(payload.gestores ?? []);
      }
      if (isAprovadorInterno) {
        const [colaboradoresRes, enviaramRes] = await Promise.all([
          fetch("/api/orcamentos-internos/colaboradores", { headers }),
          fetch("/api/orcamentos-internos/colaboradores?escopo=enviaram", { headers }),
        ]);
        if (colaboradoresRes.ok) {
          const payload = (await colaboradoresRes.json()) as {
            colaboradores?: ColaboradorOption[];
          };
          setColaboradores(payload.colaboradores ?? []);
        }
        if (enviaramRes.ok) {
          const payload = (await enviaramRes.json()) as {
            colaboradores?: ColaboradorOption[];
          };
          setColaboradoresEnviaram(payload.colaboradores ?? []);
        }
      } else {
        setColaboradores([]);
        setColaboradoresEnviaram([]);
      }
    } catch (err) {
      console.error("Erro ao carregar opções de orçamento:", err);
    }
  }, [isAprovadorInterno]);

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

  useEffect(() => {
    let cancelled = false;

    if (!detailId || !previewDocument?.path) {
      setPreviewUrl(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(true);

    void getSignedFileUrl(previewDocument.path)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviewError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar a pré-visualização.",
        );
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detailId, previewDocument?.path]);

  const colaboradorOptions = useMemo(() => {
    const map = new Map<string, string>();
    colaboradoresEnviaram.forEach((colaborador) => {
      map.set(colaborador.id, colaborador.name ?? colaborador.email);
    });
    orcamentos.forEach((orcamento) => {
      if (map.has(orcamento.solicitante_id)) return;
      map.set(
        orcamento.solicitante_id,
        orcamento.solicitante_email ?? orcamento.solicitante_id,
      );
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [colaboradoresEnviaram, orcamentos]);

  const activeFilters = (Object.keys(filters) as Array<keyof OrcamentoFilters>)
    .filter((key) => filters[key] !== EMPTY_FILTERS[key])
    .map((key) => {
      const value = filters[key];
      const labels: Record<keyof OrcamentoFilters, string> = {
        statusFilter: STATUS_LABEL[statusFilter as OrcamentoInternoStatus] ?? statusFilter,
        gestorFilter: `Decidido por: ${gestores.find((gestor) => gestor.email === gestorFilter)?.name ?? gestorFilter}`,
        colaboradorFilter: `Colaborador: ${colaboradorOptions.find((option) => option.id === colaboradorFilter)?.label ?? colaboradorFilter}`,
        dataInicio: `De ${value.split("-").reverse().join("/")}`,
        dataFim: `Até ${value.split("-").reverse().join("/")}`,
      };
      return { key, label: labels[key] };
    });

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
      const currentVersion =
        payload.versoes.find(
          (version) => version.arquivo_path === payload.orcamento.arquivo_original_path,
        ) ??
        payload.versoes.find((version) => version.principal) ??
        payload.versoes[0];
      setDetail(payload);
      setPreviewDocument({
        path: payload.orcamento.arquivo_original_path,
        name:
          currentVersion?.nome_arquivo ||
          payload.orcamento.arquivo_original_nome ||
          "documento.pdf",
        kind: "Original",
      });
      setNumeroPedido(payload.orcamento.numero_pedido ?? "");
      setReplacementFile(null);
      setReplacementValor("");
      setOrcamentos((current) =>
        current.map((item) => (item.id === payload.orcamento.id ? payload.orcamento : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar detalhes.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (
      deepLinkHandledRef.current ||
      !user ||
      accessLoading ||
      aprovadorLoading
    ) {
      return;
    }

    deepLinkHandledRef.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "aprovacao" && isGestor) {
      setTab("aprovacao");
    }

    const orcamentoId = params.get("orcamento")?.trim();
    if (orcamentoId && isGestor) {
      setDetailId(orcamentoId);
      void loadDetail(orcamentoId);
    }
  }, [accessLoading, aprovadorLoading, isGestor, loadDetail, user]);

  const openDetail = (id: string) => {
    setDetailId(id);
    setPreviewDocument(null);
    setPreviewUrl(null);
    setPreviewError(null);
    setJustificativa("");
    setNumeroPedido("");
    setReplacementFile(null);
    setReplacementValor("");
    void loadDetail(id);
  };

  const replaceSignedPdf = async (orcamento: OrcamentoInterno) => {
    if (!replacementFile) {
      setError("Selecione o novo PDF.");
      return;
    }
    setError(null);
    try {
      setActionLoading("substituir_pdf_assinado");
      const upload = await uploadDocumentFile(
        replacementFile,
        "orcamentos_internos/substituicoes",
      );
      await patchAction(
        orcamento.id,
        {
          action: "substituir_pdf_assinado",
          arquivos: [{ ...upload, principal: true }],
          ...(replacementValor.trim()
            ? { valorTotal: replacementValor.trim() }
            : {}),
        },
        "PDF substituído e assinado novamente. A versão anterior foi preservada.",
      );
      setReplacementFile(null);
      setReplacementValor("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível substituir o PDF.");
    } finally {
      setActionLoading(null);
    }
  };

  const uploadSelectedFiles = async () => {
    if (!user) throw new Error("Sessão expirada.");
    if (files.length === 0) {
      throw new Error("Selecione ao menos um PDF.");
    }
    const uploads: UploadedFileSummary[] = [];
    for (const [index, file] of files.entries()) {
      const data = await uploadDocumentFile(
        file,
        "orcamentos_internos/originais",
      );
      uploads.push({
        ...data,
        principal: index === principalIndex,
      });
    }
    return uploads;
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
    await patchAction(
      orcamento.id,
      { action: "aprovar_assinar" },
      "Orçamento aprovado e assinado.",
    );
  };

  const baixarArquivo = async (
    orcamento: OrcamentoInterno,
    signed: boolean,
    nomeOriginal?: string | null,
  ) => {
    const path = signed ? orcamento.arquivo_assinado_path : orcamento.arquivo_original_path;
    if (!path) {
      setError("Arquivo indisponível.");
      return;
    }
    try {
      const fileName = nomeOriginal
        ? signed
          ? buildAssinadoFileName(nomeOriginal)
          : nomeOriginal
        : undefined;
      await downloadPath(path, fileName);
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
    <div className="flex min-w-0 flex-1 flex-col gap-6 py-4">
      {confirmationDialog}
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
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:self-end">
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800" title="Orçamentos aguardando aprovação entre os registros carregados.">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {aguardandoCount} aguardando aprovação
          </span>
          <button
            type="button"
            onClick={() => setIntakeOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-500"
          >
            <Plus className="h-4 w-4" />
            Novo orçamento
          </button>
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

      <OrcamentoModal
        open={intakeOpen}
        onClose={() => setIntakeOpen(false)}
        title="Novo orçamento"
        description="Envie seus PDFs, confira os dados e encaminhe para aprovação."
        wide
      >
        <OrcamentoIntakeForm
          colaboradores={colaboradores}
          draftToResume={draftToResume}
          onResumeHandled={() => setDraftToResume(null)}
          onUpsert={(orcamento) => {
            setOrcamentos((current) => {
              const exists = current.some((item) => item.id === orcamento.id);
              return exists
                ? current.map((item) => (item.id === orcamento.id ? orcamento : item))
                : [orcamento, ...current];
            });
          }}
          onSubmitted={(orcamento) => {
            setSuccess(`Orçamento de ${orcamento.prestador_nome} enviado para aprovação.`);
            void loadOrcamentos();
          }}
        />

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="max-w-md text-xs leading-relaxed text-slate-500">Ao fechar, seu preenchimento fica preservado enquanto você estiver nesta página.</p>
          <button type="button" onClick={() => setIntakeOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Voltar à lista</button>
        </div>
      </OrcamentoModal>

      {filtersOpen && (
        <OrcamentoFiltersPanel
          filters={filters}
          gestores={gestores}
          onClose={() => setFiltersOpen(false)}
          onApply={(next) => {
            setFilters(next);
            setFiltersOpen(false);
          }}
        />
      )}

      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-100 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <select
            aria-label="Visualização dos orçamentos"
            value={tab}
            onChange={(event) => setTab(event.target.value as "meus" | "aprovacao" | "todos")}
            className="w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800 sm:hidden"
          >
            {visibleTabs.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <div className="hidden flex-wrap gap-2 sm:flex">
            {visibleTabs.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value as "meus" | "aprovacao" | "todos")}
                aria-pressed={tab === value}
                className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold ${
                  tab === value
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <select
                aria-label="Filtrar por colaborador"
                value={filters.colaboradorFilter}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, colaboradorFilter: event.target.value }))
                }
                className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 sm:w-auto"
              >
                <option value="todos">Colaborador: todos</option>
                {colaboradorOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${activeFilters.length > 0 ? "border-sky-200 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filtros
              {activeFilters.length > 0 && <span className="rounded-md bg-sky-600 px-1.5 py-0.5 text-[10px] text-white">{activeFilters.length}</span>}
            </button>
            <button
              type="button"
              onClick={() => void loadOrcamentos()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </button>
          </div>
        </div>

        {activeFilters.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <span className="mr-1 text-xs text-slate-500">Filtros ativos</span>
            {activeFilters.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilters((current) => ({ ...current, [key]: EMPTY_FILTERS[key] }))}
                aria-label={`Remover filtro: ${label}`}
                className="inline-flex max-w-full items-center gap-2 rounded-lg bg-sky-50 px-3 py-1.5 text-xs text-sky-700 hover:bg-sky-100"
              >
                <span className="truncate">{label}</span>
                <X className="h-3.5 w-3.5 shrink-0" />
              </button>
            ))}
            <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="px-2 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900">Limpar todos</button>
          </div>
        )}

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-100">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-2 font-semibold">
              <FileText className="h-4 w-4" />
              {total} {total === 1 ? "orçamento" : "orçamentos"}
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
            <>
              <div className="divide-y divide-slate-100 lg:hidden">
                {orcamentos.map((orcamento) => (
                  <article key={orcamento.id} className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusBadge status={orcamento.status} />
                      <span className="text-sm font-semibold tabular-nums text-slate-900">{formatCurrency(orcamento.valor_total)}</span>
                    </div>
                    <div>
                      <button type="button" onClick={() => openDetail(orcamento.id)} className="break-words text-left text-sm font-semibold text-slate-900 hover:text-sky-600">
                        {orcamento.numero_orcamento || orcamento.arquivo_original_nome || orcamento.id.slice(0, 8)}
                      </button>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">{orcamento.prestador_nome || "Fornecedor não identificado"}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{orcamento.descricao}</p>
                    </div>
                    {orcamento.numero_pedido && <p className="text-xs text-slate-500">Pedido: {orcamento.numero_pedido}</p>}
                    <div className="flex items-center justify-between gap-2">
                      <button type="button" onClick={() => openDetail(orcamento.id)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                        <Eye className="h-4 w-4" />
                        Ver detalhes
                      </button>
                      <button type="button" onClick={() => void baixarArquivo(orcamento, Boolean(orcamento.arquivo_assinado_path), orcamento.arquivo_original_nome)} aria-label={orcamento.arquivo_assinado_path ? "Baixar assinado" : "Baixar original"} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50">
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1000px] table-fixed text-left text-sm">
                  <caption className="sr-only">Orçamentos internos e status de aprovação</caption>
                  <colgroup>
                    <col className="w-[26%]" />
                    <col className="w-[20%]" />
                    <col className="w-[13%]" />
                    <col className="w-[18%]" />
                    <col className="w-[11%]" />
                    <col className="w-[12%]" />
                  </colgroup>
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3.5">Orçamento</th>
                      <th className="px-5 py-3.5">Fornecedor</th>
                      <th className="px-5 py-3.5 text-right">Valor</th>
                      <th className="px-5 py-3.5">Status</th>
                      <th className="px-5 py-3.5">Pedido</th>
                      <th className="px-5 py-3.5 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orcamentos.map((orcamento) => {
                      return (
                        <tr
                          key={orcamento.id}
                          className="align-top transition-colors hover:bg-slate-50/70"
                        >
                          <td className="px-5 py-4">
                            <button type="button" onClick={() => openDetail(orcamento.id)} className="max-w-full truncate text-left font-semibold text-slate-900 hover:text-sky-600 hover:underline">
                              {orcamento.numero_orcamento ||
                                orcamento.arquivo_original_nome ||
                                orcamento.id.slice(0, 8)}
                            </button>
                            <p className="mt-1 line-clamp-1 text-xs leading-relaxed text-slate-500">
                              {orcamento.descricao}
                            </p>
                          </td>
                          <td className="px-5 py-4 text-xs text-slate-600">
                            <p className="font-semibold text-slate-800">
                              {orcamento.prestador_nome || "Não identificado"}
                            </p>
                            {orcamento.fornecedor_cnpj ? (
                              <p className="mt-1 text-[11px] text-slate-400">
                                {orcamento.fornecedor_cnpj}
                              </p>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-semibold tabular-nums text-slate-700">
                            {formatCurrency(orcamento.valor_total)}
                          </td>
                          <td className="px-5 py-4">
                            <StatusBadge status={orcamento.status} />
                          </td>
                          <td className="px-5 py-4 text-xs text-slate-600">
                            {orcamento.numero_pedido || "--"}
                          </td>
                          <td className="px-5 py-4">
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
                                onClick={() =>
                                  void baixarArquivo(
                                    orcamento,
                                    Boolean(orcamento.arquivo_assinado_path),
                                    orcamento.arquivo_original_nome,
                                  )
                                }
                                className="rounded-full border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                                aria-label={
                                  orcamento.arquivo_assinado_path
                                    ? "Baixar assinado"
                                    : "Baixar original"
                                }
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
            </>
          )}
        </div>
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
            className="flex h-full w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Detalhes do orçamento
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">
                  {selectedDetail?.numero_orcamento ||
                    detail?.versoes.find(
                      (v) => v.arquivo_path === selectedDetail?.arquivo_original_path,
                    )?.nome_arquivo ||
                    detailId.slice(0, 8)}
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
                      ["Fornecedor", selectedDetail.prestador_nome || "--"],
                      ["CNPJ", selectedDetail.fornecedor_cnpj || "--"],
                      ["Valor", formatCurrency(selectedDetail.valor_total)],
                      ["Validade", selectedDetail.data_validade || "--"],
                      ["Solicitante", selectedDetail.solicitante_email ?? selectedDetail.solicitante_id],
                      ["Decidido por", selectedDetail.gestor_nome || selectedDetail.gestor_email || "--"],
                      ["Número do pedido", selectedDetail.numero_pedido || "--"],
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
                          <span className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewDocument({
                                  path: versao.arquivo_path,
                                  name: versao.nome_arquivo,
                                  kind: "Original",
                                })
                              }
                              className={`inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1 font-semibold transition ${
                                previewDocument?.path === versao.arquivo_path
                                  ? "border-sky-300 text-sky-700 ring-2 ring-sky-100"
                                  : "border-slate-200 text-slate-600 hover:border-sky-200 hover:text-sky-700"
                              }`}
                            >
                              <Eye className="h-3 w-3" />
                              Original
                            </button>
                            {versao.arquivo_assinado_path ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setPreviewDocument({
                                    path: versao.arquivo_assinado_path!,
                                    name: buildAssinadoFileName(versao.nome_arquivo),
                                    kind: "Assinado",
                                  })
                                }
                                className={`inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1 font-semibold transition ${
                                  previewDocument?.path === versao.arquivo_assinado_path
                                    ? "border-emerald-400 text-emerald-700 ring-2 ring-emerald-100"
                                    : "border-emerald-200 text-emerald-700 hover:border-emerald-400"
                                }`}
                              >
                                <Signature className="h-3 w-3" />
                                Assinado
                              </button>
                            ) : null}
                          </span>
                        </div>
                      ))}
                      {selectedDetail.arquivo_assinado_path ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                          <span className="font-semibold">Arquivo assinado disponível</span>
                          <button
                            type="button"
                            onClick={() =>
                              void baixarArquivo(
                                selectedDetail,
                                true,
                                detail.versoes.find(
                                  (v) => v.arquivo_path === selectedDetail.arquivo_original_path,
                                )?.nome_arquivo,
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 font-semibold"
                          >
                            <Download className="h-3 w-3" />
                            Baixar assinado
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Pré-visualização · {previewDocument?.kind ?? "Documento"}
                          </p>
                          <p className="mt-0.5 truncate text-xs font-semibold text-slate-700">
                            {previewDocument?.name ?? "Nenhum documento selecionado"}
                          </p>
                        </div>
                        {previewDocument ? (
                          <span className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void downloadPath(previewDocument.path, previewDocument.name)}
                              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              <Download className="h-3 w-3" />
                              Baixar
                            </button>
                            <button
                              type="button"
                              onClick={() => void abrirArquivo(previewDocument.path)}
                              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Nova aba
                            </button>
                          </span>
                        ) : null}
                      </div>

                      <div className="relative flex min-h-[28rem] items-center justify-center bg-slate-100 sm:min-h-[36rem]">
                        {previewLoading ? (
                          <div className="flex items-center gap-2 text-sm text-slate-500">
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                            Carregando documento...
                          </div>
                        ) : previewError ? (
                          <div className="max-w-md px-6 text-center">
                            <TriangleAlert className="mx-auto h-6 w-6 text-orange-500" />
                            <p className="mt-2 text-sm font-semibold text-slate-700">
                              Não foi possível exibir o documento aqui.
                            </p>
                            <p className="mt-1 text-xs text-slate-500">{previewError}</p>
                            {previewDocument ? (
                              <button
                                type="button"
                                onClick={() => void abrirArquivo(previewDocument.path)}
                                className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                              >
                                Abrir em nova aba
                              </button>
                            ) : null}
                          </div>
                        ) : previewUrl ? (
                          <iframe
                            key={previewUrl}
                            src={`${previewUrl}#toolbar=1&navpanes=0&view=FitH`}
                            title={`Pré-visualização de ${previewDocument?.name ?? "documento"}`}
                            className="absolute inset-0 h-full w-full border-0 bg-white"
                          />
                        ) : (
                          <p className="text-sm text-slate-500">
                            Selecione um documento para visualizar.
                          </p>
                        )}
                      </div>
                    </div>
                  </section>

                  {isAdmin && selectedDetail.status === "aprovado_assinado" ? (
                    <section className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">
                        Administração pós-assinatura
                      </p>
                      <div className="mt-3 grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="text-xs font-semibold text-slate-700">
                            Número do pedido
                            <input
                              value={numeroPedido}
                              onChange={(event) => setNumeroPedido(event.target.value)}
                              placeholder="Ex.: 4500123456"
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                          </label>
                          <button
                            type="button"
                            disabled={Boolean(actionLoading) || !numeroPedido.trim()}
                            onClick={() =>
                              void patchAction(
                                selectedDetail.id,
                                {
                                  action: "registrar_numero_pedido",
                                  numeroPedido,
                                },
                                "Número do pedido registrado.",
                              )
                            }
                            className="mt-2 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                          >
                            {actionLoading === "registrar_numero_pedido"
                              ? "Salvando..."
                              : "Salvar número"}
                          </button>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate-700">
                            Substituir PDF aprovado
                            <input
                              key={`${selectedDetail.id}-${selectedDetail.updated_at}`}
                              type="file"
                              accept="application/pdf,.pdf"
                              onChange={(event) =>
                                setReplacementFile(event.target.files?.[0] ?? null)
                              }
                              className="mt-1 block w-full text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold"
                            />
                          </label>
                          <label className="mt-2 block text-xs font-semibold text-slate-700">
                            Novo valor total (opcional)
                            <input
                              value={replacementValor}
                              onChange={(event) =>
                                setReplacementValor(event.target.value)
                              }
                              inputMode="decimal"
                              placeholder="Ex.: 1.250,00"
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                          </label>
                          <button
                            type="button"
                            disabled={Boolean(actionLoading) || !replacementFile}
                            onClick={async () => {
                              const confirmed = await confirm({
                                title: "Substituir PDF aprovado",
                                description:
                                  "O novo PDF será assinado novamente. A versão anterior continuará disponível no histórico.",
                                confirmLabel: "Substituir e assinar",
                              });
                              if (confirmed) void replaceSignedPdf(selectedDetail);
                            }}
                            className="mt-2 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                          >
                            <Signature className="h-4 w-4" />
                            {actionLoading === "substituir_pdf_assinado"
                              ? "Substituindo..."
                              : "Substituir e assinar"}
                          </button>
                          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                            Use quando o fornecedor enviar um novo PDF, por exemplo após
                            conceder desconto. O arquivo anterior não será apagado.
                          </p>
                        </div>
                      </div>
                    </section>
                  ) : null}

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
                <div className="flex flex-wrap justify-end gap-2 text-xs">
                  {selectedDetail.status === "rascunho" &&
                  selectedDetail.solicitante_id === user.id ? (
                    <button
                      type="button"
                      disabled={Boolean(actionLoading)}
                      onClick={() => {
                        setDraftToResume(selectedDetail);
                        setDetailId(null);
                        setDetail(null);
                        setIntakeOpen(true);
                      }}
                      className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
                    >
                      <FilePlus2 className="h-4 w-4" />
                      Continuar rascunho
                    </button>
                  ) : null}
                  {detail?.canDecide &&
                  ["aguardando_aprovacao", "em_analise_gestor", "reenviado"].includes(
                    selectedDetail.status,
                  ) ? (
                    <>
                      <button
                        type="button"
                        disabled={Boolean(actionLoading)}
                        onClick={async () => {
                          const confirmed = await confirm({
                            title: "Aprovar e assinar orçamento",
                            description: `Confirma a aprovação e assinatura do orçamento de ${selectedDetail.prestador_nome}?`,
                            confirmLabel: "Aprovar e assinar",
                          });
                          if (confirmed) void signAndApprove(selectedDetail);
                        }}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
                      >
                        <Signature className="h-4 w-4" />
                        {actionLoading === "aprovar_assinar" ? "Assinando..." : "Aprovar e assinar"}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(actionLoading) || !justificativa.trim()}
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
                    </>
                  ) : null}
                  {detail?.canDecide &&
                  ["aguardando_aprovacao", "em_analise_gestor", "reenviado"].includes(
                    selectedDetail.status,
                  ) ? (
                    <button
                      type="button"
                      disabled={Boolean(actionLoading) || !justificativa.trim()}
                      onClick={() =>
                        void patchAction(
                          selectedDetail.id,
                          { action: "rejeitar", justificativa },
                          "Orçamento rejeitado.",
                        )
                      }
                      className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
                    >
                      <XCircle className="h-4 w-4" />
                      Não Autorizado
                    </button>
                  ) : null}
                  {selectedDetail.status === "ajuste_solicitado" &&
                  selectedDetail.solicitante_id === user.id ? (
                    <div className="flex w-full flex-wrap items-center justify-end gap-2 rounded-xl bg-orange-50 p-3">
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={(event) => {
                          setFiles(event.target.files ? Array.from(event.target.files) : []);
                          setPrincipalIndex(0);
                        }}
                        className="min-w-0 flex-1 text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold"
                      />
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
                    </div>
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
