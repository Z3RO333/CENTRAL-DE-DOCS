"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  History,
  LoaderCircle,
  PenLine,
  Sparkles,
  Signature,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { BtrackerModal } from "@/app/documentos/_components/BtrackerModal";
import { useAccessibleDialog } from "@/hooks/useAccessibleDialog";

export type DrawerFormularioRecord = {
  id: string;
  tipo: string;
  status: string;
  status_analise_ia?: string | null;
  arquivo_path: string;
  arquivo_assinado_path?: string | null;
  created_at: string;
  dados: Record<string, unknown> | null;
  assinado_por?: string | null;
  prestador_id?: string | null;
  user_id?: string | null;
  nome_arquivo?: string | null;
};

type TimelineEvent = {
  id: string;
  event_type: string;
  actor_id: string | null;
  actor_email: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type RecomendacaoCriticaResultado = {
  trecho: string;
  pagina: number | null;
  problema: string;
  componente: string | null;
  recomendacao_tecnica: string;
  prioridade:
    | "emergencial"
    | "critica"
    | "alta"
    | "moderada"
    | "preventiva"
    | "informativa";
  prazo_dias: number | null;
  impacto: string | null;
  acao_necessaria: string;
  desligar_equipamento: boolean;
  substituir_peca: boolean;
  precisa_inspecao_presencial: boolean;
  abrir_ordem_corretiva: boolean;
  riscos: string[];
};

type DocumentoAnaliseResultado = {
  tipo_documento?: string;
  competencias?: string[];
  lojas?: Array<{
    codigo?: string | null;
    nome?: string | null;
    confianca?: number | null;
  }>;
  prestador?: string | null;
  cnpj?: string | null;
  numero_orcamento?: string | null;
  numero_nf?: string | null;
  numero_pedido?: string | null;
  numero_contrato?: string | null;
  valor_total?: number | null;
  descricao?: string | null;
  objeto?: string | null;
  tipo_servico?: string | null;
  data_assinatura?: string | null;
  data_vencimento?: string | null;
  data_validade?: string | null;
  itens?: Array<{
    descricao?: string;
    competencia?: string | null;
    loja_codigo?: string | null;
    valor?: number | null;
  }>;
  alertas?: string[];
  confianca_geral?: number | null;
  observacoes?: string | null;
  recomendacoes?: string[];
  recomendacoes_criticas?: RecomendacaoCriticaResultado[];
};

type DocumentoAnaliseIa = {
  id: string;
  documento_id: string;
  provider: string;
  model: string;
  status: string;
  resultado: DocumentoAnaliseResultado;
  erro: string | null;
  created_at: string;
};

type DetailsPayload = {
  documento: DrawerFormularioRecord;
  detalhes: {
    loja: { id: string; nome: string | null; codigo: string | null } | null;
    prestador: {
      id: string;
      nome: string | null;
      tipo_servico: string | null;
    } | null;
    enviadoPor: {
      id: string;
      email: string | null;
      name: string | null;
    } | null;
  };
  timeline: TimelineEvent[];
  analise_ia: DocumentoAnaliseIa | null;
  error?: string;
};

type DocumentDetailsDrawerProps = {
  documentId: string | null;
  fallbackRegistro: DrawerFormularioRecord | null;
  isOpen: boolean;
  canManageDocuments: boolean;
  pdfAction: { id: string; type: "open" | "download" } | null;
  reviewingId: string | null;
  onClose: () => void;
  onOpenPdf: (registro: DrawerFormularioRecord) => void;
  onDownloadPdf: (registro: DrawerFormularioRecord) => void;
  onEdit: (registro: DrawerFormularioRecord) => void;
  onReview: (registro: DrawerFormularioRecord) => void;
  onSign: (registro: DrawerFormularioRecord) => void;
  onAppliedSuggestions: (registro: DrawerFormularioRecord) => void;
};

const TIPO_ASSINAVEL = "registro_laudos";

const tipoLabel: Record<string, string> = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
  contratos: "Contratos",
  orcamentos: "Orçamentos",
};

const statusLabel: Record<string, string> = {
  pendente: "Pendente",
  em_analise: "Em análise",
  revisado: "Revisado",
  assinado: "Assinado",
};

const statusAnaliseIaLabel: Record<string, { texto: string; classe: string }> = {
  recebido: { texto: "Aguardando análise", classe: "bg-slate-100 text-slate-700" },
  aguardando_analise: { texto: "Aguardando análise", classe: "bg-slate-100 text-slate-700" },
  em_analise: { texto: "Em análise pela IA", classe: "bg-blue-100 text-blue-700" },
  concluida: { texto: "Análise concluída", classe: "bg-green-100 text-green-700" },
  necessita_revisao: { texto: "Necessita revisão", classe: "bg-amber-100 text-amber-700" },
  erro: { texto: "Erro na leitura", classe: "bg-red-100 text-red-700" },
  duplicado: { texto: "Documento duplicado", classe: "bg-purple-100 text-purple-700" },
};

const eventLabel: Record<string, string> = {
  documento_criado: "Documento criado",
  documento_editado: "Documento editado",
  status_alterado: "Status alterado",
  loja_alterada: "Loja alterada",
  prestador_alterado: "Prestador alterado",
  assinado: "Documento assinado",
  baixado: "PDF baixado",
};

const humanize = (value: string) =>
  value
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");

const formatDateTime = (value: string | null | undefined) => {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString("pt-BR");
};

const getCampoTexto = (
  dados: Record<string, unknown> | null | undefined,
  campos: string[],
) => {
  if (!dados) {
    return null;
  }
  for (const campo of campos) {
    const value = dados[campo];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const getMetadataText = (event: TimelineEvent) => {
  const from = event.metadata?.from;
  const to = event.metadata?.to;
  if (
    (event.event_type === "status_alterado" ||
      event.event_type === "loja_alterada" ||
      event.event_type === "prestador_alterado") &&
    (typeof from === "string" || typeof to === "string")
  ) {
    return `${from || "sem valor"} -> ${to || "sem valor"}`;
  }
  if (event.event_type === "documento_editado") {
    return "Dados do documento atualizados.";
  }
  if (event.event_type === "assinado") {
    return "Arquivo assinado vinculado ao documento.";
  }
  if (event.event_type === "baixado") {
    return "Download registrado para rastreabilidade.";
  }
  return null;
};

const formatConfidence = (value: number | null | undefined) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${Math.round(value * 100)}%`;
};

const PRIORIDADE_ESTILO: Record<
  RecomendacaoCriticaResultado["prioridade"],
  { label: string; badgeClass: string }
> = {
  emergencial: { label: "Emergencial", badgeClass: "bg-red-600 text-white" },
  critica: { label: "Critica", badgeClass: "bg-red-100 text-red-800" },
  alta: { label: "Alta", badgeClass: "bg-orange-100 text-orange-800" },
  moderada: { label: "Moderada", badgeClass: "bg-amber-100 text-amber-800" },
  preventiva: { label: "Preventiva", badgeClass: "bg-blue-100 text-blue-800" },
  informativa: { label: "Informativa", badgeClass: "bg-slate-100 text-slate-700" },
};

const stringifyValor = (value: number | null | undefined) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const buildUpdatesFromAnalise = (resultado: DocumentoAnaliseResultado) => {
  const updates: Record<string, string> = {};
  const competencia = resultado.competencias?.[0]?.trim();
  const valor = stringifyValor(resultado.valor_total);

  if (competencia) updates.competencia = competencia;
  if (resultado.numero_nf?.trim()) updates.numero_nf = resultado.numero_nf.trim();
  if (resultado.numero_pedido?.trim()) {
    updates.numero_pedido = resultado.numero_pedido.trim();
  }
  if (valor) updates.valor = valor;
  if (resultado.descricao?.trim()) updates.descricao = resultado.descricao.trim();
  if (resultado.prestador?.trim()) updates.prestador = resultado.prestador.trim();
  if (resultado.cnpj?.trim()) updates.cnpj = resultado.cnpj.trim();
  if (resultado.numero_orcamento?.trim()) {
    updates.numero_orcamento = resultado.numero_orcamento.trim();
  }
  if (resultado.data_assinatura?.trim()) {
    updates.data_assinatura = resultado.data_assinatura.trim();
  }
  if (resultado.data_vencimento?.trim()) {
    updates.data_vencimento = resultado.data_vencimento.trim();
  }
  if (resultado.data_validade?.trim()) {
    updates.data_validade = resultado.data_validade.trim();
  }
  if (resultado.tipo_servico?.trim()) {
    updates.tipo_servico = resultado.tipo_servico.trim();
  }
  if (resultado.numero_contrato?.trim()) {
    updates.numero_contrato = resultado.numero_contrato.trim();
  }
  if (resultado.objeto?.trim()) {
    updates.objeto = resultado.objeto.trim();
  }

  return updates;
};

const parseObservationItems = (value: string) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  const pedidoMatch = normalized.match(/pedido\s+de\s+compra:\s*([^.]+)\.?/i);
  const pedidoCompra = pedidoMatch?.[1]?.trim() ?? null;
  const withoutPedido = pedidoMatch
    ? normalized.replace(pedidoMatch[0], "").trim()
    : normalized;
  const totalMatch = withoutPedido.match(
    /(?:,\s*)?totalizando\s+(R\$\s*[\d.]+,\d{2})\.?$/i,
  );
  const valorTotal = totalMatch?.[1]?.trim() ?? null;
  const withoutTotal = totalMatch
    ? withoutPedido.replace(totalMatch[0], "").trim()
    : withoutPedido;
  const introMatch = withoutTotal.match(/^(.*?):\s*(?=1\.\s*)/);
  const intro = introMatch?.[1]?.trim() ?? null;
  const itemsText = introMatch
    ? withoutTotal.slice(introMatch[0].length).trim()
    : withoutTotal;
  const items = Array.from(
    itemsText.matchAll(/(?:^|;\s*)(\d+)\.\s*(.*?)(?=;\s*\d+\.\s*|$)/g),
  ).map((match) => {
    const raw = match[2].replace(/[.;]\s*$/, "").trim();
    const osMatch = raw.match(/^\(([^)]+)\),?\s*(.*)$/);
    const body = osMatch?.[2]?.trim() ?? raw;
    const dataMatch = body.match(/conclu[ií]da em\s*([^,]+),?\s*/i);
    const valorMatch = body.match(/no valor de\s*(R\$\s*[\d.]+,\d{2})/i);
    const service = body
      .replace(/conclu[ií]da em\s*[^,]+,?\s*/i, "")
      .replace(/^referente\s+[àa]\s*/i, "")
      .replace(/,\s*no valor de\s*R\$\s*[\d.]+,\d{2}/i, "")
      .trim();

    return {
      numero: match[1],
      os: osMatch?.[1]?.trim() ?? null,
      data: dataMatch?.[1]?.trim() ?? null,
      valor: valorMatch?.[1]?.trim() ?? null,
      service: service || body,
      raw,
    };
  });

  if (items.length === 0) {
    return null;
  }

  return {
    intro,
    items,
    pedidoCompra,
    valorTotal,
  };
};

function FormattedObservation({ value }: { value: string }) {
  const parsed = parseObservationItems(value);

  if (!parsed) {
    return (
      <p className="mt-1 whitespace-pre-line break-words text-sm font-medium leading-6 text-slate-900">
        {value}
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-3 text-sm text-slate-700">
      {parsed.intro ? (
        <p className="font-semibold text-slate-900">{parsed.intro}.</p>
      ) : null}
      <div className="space-y-2">
        {parsed.items.map((item) => (
          <div
            key={`${item.numero}-${item.os ?? item.raw}`}
            className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-slate-900">
                Item {item.numero}
                {item.os ? ` - ${item.os}` : ""}
              </p>
              {item.valor ? (
                <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                  {item.valor}
                </span>
              ) : null}
            </div>
            {item.data ? (
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Concluída em {item.data}
              </p>
            ) : null}
            <p className="mt-2 leading-6 text-slate-700">{item.service}</p>
          </div>
        ))}
      </div>
      {(parsed.valorTotal || parsed.pedidoCompra) && (
        <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
          {parsed.valorTotal ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
              Total: {parsed.valorTotal}
            </span>
          ) : null}
          {parsed.pedidoCompra ? (
            <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-700">
              Pedido de compra: {parsed.pedidoCompra}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function DocumentDetailsDrawer({
  documentId,
  fallbackRegistro,
  isOpen,
  canManageDocuments,
  pdfAction,
  reviewingId,
  onClose,
  onOpenPdf,
  onDownloadPdf,
  onEdit,
  onReview,
  onSign,
  onAppliedSuggestions,
}: DocumentDetailsDrawerProps) {
  const dialogRef = useAccessibleDialog<HTMLElement>(isOpen, onClose);
  const [payload, setPayload] = useState<DetailsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [applyingSuggestions, setApplyingSuggestions] = useState(false);
  const [btrackerModal, setBtrackerModal] = useState<{ token: string } | null>(null);

  const getAccessToken = useCallback(async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }
    const token = data.session?.access_token;
    if (!token) {
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    return token;
  }, []);

  useEffect(() => {
    if (!isOpen || !documentId) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    const loadDetails = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const response = await fetch(`/api/documentos/${documentId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const nextPayload = (await response.json()) as DetailsPayload;
        if (!response.ok) {
          throw new Error(
            nextPayload.error ?? "Não foi possível carregar o documento.",
          );
        }
        if (active) {
          setPayload(nextPayload);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível carregar o documento.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadDetails();
    return () => {
      active = false;
    };
  }, [documentId, getAccessToken, isOpen]);

  const registro = payload?.documento ?? fallbackRegistro;
  const details = payload?.detalhes;
  const timeline = payload?.timeline ?? [];
  const analiseIa = payload?.analise_ia ?? null;
  const analiseResultado =
    analiseIa && analiseIa.status !== "erro" ? analiseIa.resultado : null;
  const suggestedUpdates = analiseResultado
    ? buildUpdatesFromAnalise(analiseResultado)
    : {};

  const campos = useMemo(() => {
    if (!registro) {
      return [];
    }

    const dados = registro.dados;
    const lojaLabel = details?.loja
      ? details.loja.codigo
        ? `${details.loja.nome ?? "Loja"} - ${details.loja.codigo}`
        : details.loja.nome
      : getCampoTexto(dados, ["loja_nome", "loja_id"]);
    const prestadorLabel = details?.prestador
      ? details.prestador.tipo_servico
        ? `${details.prestador.nome ?? "Prestador"} - ${details.prestador.tipo_servico}`
        : details.prestador.nome
      : getCampoTexto(dados, ["prestador"]);
    const enviadoPor = details?.enviadoPor
      ? details.enviadoPor.name || details.enviadoPor.email || details.enviadoPor.id
      : registro.user_id ?? null;

    return [
      { label: "Tipo", value: tipoLabel[registro.tipo] ?? humanize(registro.tipo) },
      { label: "Status", value: statusLabel[registro.status] ?? humanize(registro.status) },
      { label: "Loja", value: lojaLabel },
      { label: "Prestador", value: prestadorLabel },
      { label: "Número da NF", value: getCampoTexto(dados, ["numero_nf"]) },
      { label: "Número do pedido", value: getCampoTexto(dados, ["numero_pedido"]) },
      { label: "CNPJ", value: getCampoTexto(dados, ["cnpj", "cnpj_emitente"]) },
      { label: "Responsável", value: getCampoTexto(dados, ["responsavel"]) },
      { label: "Data de envio", value: formatDateTime(registro.created_at) },
      { label: "Enviado por", value: enviadoPor },
      {
        label: "Nome do arquivo",
        value:
          registro.nome_arquivo ||
          getCampoTexto(dados, ["nome_arquivo"]) ||
          registro.arquivo_assinado_path?.split("/").pop() ||
          registro.arquivo_path?.split("/").pop(),
      },
      {
        label: "Observações",
        value: getCampoTexto(dados, ["observacoes", "descricao"]),
        wide: true,
      },
    ];
  }, [details, registro]);

  if (!isOpen) {
    return null;
  }

  const opening = Boolean(
    registro && pdfAction?.id === registro.id && pdfAction.type === "open",
  );
  const downloading = Boolean(
    registro && pdfAction?.id === registro.id && pdfAction.type === "download",
  );
  const canReview =
    canManageDocuments &&
    registro?.tipo !== TIPO_ASSINAVEL &&
    registro?.status !== "revisado" &&
    registro?.status !== "assinado";
  const canSign =
    canManageDocuments &&
    registro?.tipo === TIPO_ASSINAVEL &&
    registro?.status !== "assinado";

  const analisarComIa = async () => {
    if (!registro) return;
    try {
      setAnalyzing(true);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch(`/api/documentos/${registro.id}/analisar`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const nextPayload = (await response.json()) as {
        analise?: DocumentoAnaliseIa;
        error?: string;
      };
      if (!response.ok || !nextPayload.analise) {
        throw new Error(nextPayload.error ?? "Nao foi possivel analisar com IA.");
      }
      setPayload((current) =>
        current ? { ...current, analise_ia: nextPayload.analise ?? null } : current,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Nao foi possivel analisar com IA.",
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const aplicarSugestoes = async () => {
    if (!registro || !analiseResultado) return;
    const updates = buildUpdatesFromAnalise(analiseResultado);
    if (Object.keys(updates).length === 0) {
      setError("A analise nao trouxe campos seguros para aplicar.");
      return;
    }

    try {
      setApplyingSuggestions(true);
      setError(null);
      const token = await getAccessToken();
      const response = await fetch("/api/documentos", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: registro.id,
          updates,
        }),
      });
      const nextPayload = (await response.json()) as {
        registro?: DrawerFormularioRecord;
        error?: string;
      };
      if (!response.ok || !nextPayload.registro) {
        throw new Error(nextPayload.error ?? "Nao foi possivel aplicar sugestoes.");
      }
      setPayload((current) =>
        current ? { ...current, documento: nextPayload.registro! } : current,
      );
      onAppliedSuggestions(nextPayload.registro);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Nao foi possivel aplicar sugestoes.",
      );
    } finally {
      setApplyingSuggestions(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
      onClick={onClose}
    >
      <aside
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="documento-detalhes-title"
        className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl shadow-slate-900/30 outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <FileText className="h-4 w-4 text-slate-400" />
              Detalhes do documento
            </div>
            <h2
              id="documento-detalhes-title"
              className="mt-1 truncate text-lg font-semibold text-slate-900"
            >
              {registro?.nome_arquivo ||
                registro?.arquivo_assinado_path?.split("/").pop() ||
                registro?.arquivo_path?.split("/").pop() ||
                documentId ||
                "Documento"}
            </h2>
            {registro && (
              <p className="mt-1 font-mono text-[11px] text-slate-400">
                {registro.id}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200"
            aria-label="Fechar detalhes"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading && !payload ? (
            <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Carregando detalhes...
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {registro ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {campos.map((campo) => (
                  <div
                    key={campo.label}
                    className={campo.wide ? "sm:col-span-2" : ""}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {campo.label}
                    </p>
                    {campo.label === "Observações" && campo.value ? (
                      <FormattedObservation value={campo.value} />
                    ) : (
                      <p className="mt-1 break-words text-sm font-medium text-slate-900">
                        {campo.value || "Não informado"}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <section className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-sky-600" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Analise por IA
                    </p>
                  </div>
                  {canManageDocuments ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2">
                        {(() => {
                          const statusInfo =
                            statusAnaliseIaLabel[registro?.status_analise_ia ?? "recebido"] ??
                            statusAnaliseIaLabel.recebido;
                          return (
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-medium ${statusInfo.classe}`}
                            >
                              {statusInfo.texto}
                            </span>
                          );
                        })()}
                        {(registro?.status_analise_ia === "erro" ||
                          registro?.status_analise_ia === "necessita_revisao") && (
                          <button
                            type="button"
                            onClick={() => void analisarComIa()}
                            disabled={analyzing}
                            className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
                          >
                            {analyzing ? "Reprocessando..." : "Reprocessar com IA"}
                          </button>
                        )}
                      </div>
                      {analiseResultado ? (
                        <button
                          type="button"
                          onClick={() => void aplicarSugestoes()}
                          disabled={
                            applyingSuggestions ||
                            analyzing ||
                            Object.keys(suggestedUpdates).length === 0
                          }
                          className="rounded-full bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {applyingSuggestions ? "Aplicando..." : "Aplicar sugestoes"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {analiseIa?.status === "erro" && analiseIa.erro ? (
                  <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {analiseIa.erro}
                  </div>
                ) : null}

                {analiseResultado ? (
                  <div className="mt-4 space-y-3 text-sm">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Tipo detectado
                        </p>
                        <p className="mt-1 font-medium text-slate-900">
                          {analiseResultado.tipo_documento ?? "Nao informado"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Confianca
                        </p>
                        <p className="mt-1 font-medium text-slate-900">
                          {formatConfidence(analiseResultado.confianca_geral)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Competencias
                        </p>
                        <p className="mt-1 font-medium text-slate-900">
                          {analiseResultado.competencias?.join(", ") ||
                            "Nao informado"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          NF / Pedido
                        </p>
                        <p className="mt-1 font-medium text-slate-900">
                          {[analiseResultado.numero_nf, analiseResultado.numero_pedido]
                            .filter(Boolean)
                            .join(" / ") || "Nao informado"}
                        </p>
                      </div>
                    </div>
                    {analiseResultado.valor_total ? (
                      <p className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-800">
                        Valor total: R$ {stringifyValor(analiseResultado.valor_total)}
                      </p>
                    ) : null}
                    {analiseResultado.descricao ? (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Descricao
                        </p>
                        <p className="mt-1 leading-6 text-slate-700">
                          {analiseResultado.descricao}
                        </p>
                      </div>
                    ) : null}
                    {analiseResultado.lojas && analiseResultado.lojas.length > 0 ? (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Lojas detectadas
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {analiseResultado.lojas.map((loja, index) => (
                            <span
                              key={`${loja.codigo ?? loja.nome ?? index}`}
                              className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                            >
                              {[loja.codigo, loja.nome].filter(Boolean).join(" - ") ||
                                "Loja nao identificada"}{" "}
                              ({formatConfidence(loja.confianca)})
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {analiseResultado.alertas && analiseResultado.alertas.length > 0 ? (
                      <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {analiseResultado.alertas.join(" ")}
                      </div>
                    ) : null}
                    {analiseResultado.observacoes ? (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Observacoes do documento
                        </p>
                        <p className="mt-1 rounded-xl bg-white px-3 py-2 text-sm leading-6 text-slate-700 italic">
                          &ldquo;{analiseResultado.observacoes}&rdquo;
                        </p>
                      </div>
                    ) : null}
                    {analiseResultado.recomendacoes && analiseResultado.recomendacoes.length > 0 ? (
                      <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">
                          Recomendacoes identificadas
                        </p>
                        <ul className="mt-2 space-y-1.5">
                          {analiseResultado.recomendacoes.map((rec, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-orange-900">
                              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400" />
                              {rec}
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3 border-t border-orange-100 pt-3">
                          <a
                            href="https://witty-stone-0805fa60f.2.azurestaticapps.net/auth/login"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-full bg-orange-600 px-4 py-1.5 text-[11px] font-semibold text-white transition hover:bg-orange-500"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Gerar ordem
                          </a>
                        </div>
                      </div>
                    ) : null}
                    {analiseResultado.recomendacoes_criticas &&
                    analiseResultado.recomendacoes_criticas.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Achados criticos identificados
                        </p>
                        {analiseResultado.recomendacoes_criticas.map((achado, i) => {
                          const estilo = PRIORIDADE_ESTILO[achado.prioridade];
                          const flags = [
                            achado.desligar_equipamento && "Desligar equipamento",
                            achado.substituir_peca && "Substituir peca",
                            achado.precisa_inspecao_presencial && "Inspecao presencial",
                            achado.abrir_ordem_corretiva && "Abrir ordem corretiva",
                          ].filter((flag): flag is string => Boolean(flag));

                          return (
                            <div
                              key={i}
                              className="rounded-xl border border-red-100 bg-red-50 px-4 py-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${estilo.badgeClass}`}
                                >
                                  {estilo.label}
                                </span>
                                {achado.prazo_dias !== null ? (
                                  <span className="text-[11px] font-medium text-red-700">
                                    Prazo: {achado.prazo_dias} dia(s)
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-2 text-sm font-medium text-red-900">
                                {achado.problema}
                              </p>
                              <p className="mt-1 text-xs text-red-800">
                                {achado.acao_necessaria}
                              </p>
                              {flags.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {flags.map((flag) => (
                                    <span
                                      key={flag}
                                      className="rounded-full bg-red-600/10 px-2 py-0.5 text-[10px] font-semibold text-red-700"
                                    >
                                      {flag}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    <p className="text-[11px] text-slate-400">
                      Ultima analise: {formatDateTime(analiseIa?.created_at)} via{" "}
                      {analiseIa?.provider} / {analiseIa?.model}
                    </p>
                  </div>
                ) : analiseIa?.status !== "erro" ? (
                  <p className="mt-3 text-sm text-slate-500">
                    Nenhuma analise salva para este documento ainda.
                  </p>
                ) : null}
              </section>

              <section className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-4">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-slate-500" />
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Timeline
                  </p>
                </div>
                <div className="mt-4 space-y-3">
                  {timeline.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      Nenhum evento registrado ainda.
                    </p>
                  ) : (
                    timeline.map((event) => {
                      const metadataText = getMetadataText(event);
                      return (
                        <div
                          key={event.id}
                          className="border-l-2 border-sky-200 pl-3"
                        >
                          <p className="text-sm font-semibold text-slate-900">
                            {eventLabel[event.event_type] ??
                              humanize(event.event_type)}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {formatDateTime(event.created_at)}
                            {event.actor_email ? ` por ${event.actor_email}` : ""}
                          </p>
                          {metadataText ? (
                            <p className="mt-1 text-xs text-slate-500">
                              {metadataText}
                            </p>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </div>
          ) : null}
        </div>

        {/* BTracker Modal */}
        {btrackerModal && registro ? (
          <BtrackerModal
            documentoId={registro.id}
            fileName={
              registro.nome_arquivo ??
              registro.arquivo_path?.split("/").pop() ??
              "documento"
            }
            cnpj={
              typeof registro.dados?.cnpj === "string"
                ? registro.dados.cnpj
                : null
            }
            initialNroPedido={
              typeof registro.dados?.numero_pedido === "string"
                ? registro.dados.numero_pedido
                : null
            }
            initialNumeroNf={
              typeof registro.dados?.numero_nf === "string"
                ? registro.dados.numero_nf
                : null
            }
            accessToken={btrackerModal.token}
            onClose={() => setBtrackerModal(null)}
          />
        ) : null}

        {registro ? (
          <footer className="border-t border-slate-100 bg-white px-5 py-4">
            <div className="flex flex-wrap justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => onOpenPdf(registro)}
                disabled={opening || downloading}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ExternalLink className="h-4 w-4" />
                {opening ? "Abrindo..." : "Ver PDF"}
              </button>
              <button
                type="button"
                onClick={() => onDownloadPdf(registro)}
                disabled={opening || downloading}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                {downloading ? "Baixando..." : "Baixar PDF"}
              </button>
              {canManageDocuments ? (
                <button
                  type="button"
                  onClick={() => onEdit(registro)}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <PenLine className="h-4 w-4" />
                  Editar dados
                </button>
              ) : null}
              {registro.tipo === "notas_fiscais" ? (
                <button
                  type="button"
                  onClick={() => {
                    void getAccessToken().then((token) =>
                      setBtrackerModal({ token }),
                    );
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
                >
                  <FileCheck2 className="h-4 w-4" />
                  Enviar ao BTracker
                </button>
              ) : null}
              {canReview ? (
                <button
                  type="button"
                  onClick={() => onReview(registro)}
                  disabled={reviewingId === registro.id}
                  className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {reviewingId === registro.id ? "Salvando..." : "Revisar"}
                </button>
              ) : null}
              {canSign ? (
                <button
                  type="button"
                  onClick={() => onSign(registro)}
                  className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-4 py-2 font-semibold text-white transition hover:bg-sky-500"
                >
                  <Signature className="h-4 w-4" />
                  Revisar/Assinar
                </button>
              ) : null}
            </div>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
