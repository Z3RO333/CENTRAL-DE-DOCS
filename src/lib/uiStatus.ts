export type StatusTone = "neutral" | "info" | "warning" | "success" | "danger";

export type StatusPresentation = {
  label: string;
  tone: StatusTone;
  className: string;
};

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  danger: "bg-rose-50 text-rose-700 ring-rose-200",
};

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pendente: { label: "Pendente", tone: "warning" },
  em_analise: { label: "Em análise", tone: "info" },
  revisado: { label: "Revisado", tone: "success" },
  assinado: { label: "Assinado", tone: "success" },
  aguardando_verificacao: { label: "Aguardando verificação", tone: "warning" },
  concluida: { label: "Concluída", tone: "success" },
  rejeitada: { label: "Rejeitada", tone: "danger" },
  rascunho: { label: "Rascunho", tone: "neutral" },
  aguardando_aprovacao: { label: "Aguardando aprovação", tone: "warning" },
  em_analise_gestor: { label: "Em análise do gestor", tone: "info" },
  reenviado: { label: "Reenviado", tone: "info" },
  ajuste_solicitado: { label: "Ajuste solicitado", tone: "warning" },
  aprovado_assinado: { label: "Aprovado e assinado", tone: "success" },
  rejeitado: { label: "Rejeitado", tone: "danger" },
  aprovado: { label: "Aprovado", tone: "success" },
  reprovado: { label: "Reprovado", tone: "danger" },
  cancelado: { label: "Cancelado", tone: "neutral" },
  erro: { label: "Erro", tone: "danger" },
  falha: { label: "Falha", tone: "danger" },
  recebido: { label: "Aguardando análise", tone: "neutral" },
  necessita_revisao: { label: "Necessita revisão", tone: "warning" },
  duplicado: { label: "Duplicado", tone: "neutral" },
};

const humanize = (value: string) =>
  value
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

export function getStatusPresentation(status: string): StatusPresentation {
  const normalized = status.trim().toLowerCase();
  const presentation = STATUS[normalized] ?? {
    label: humanize(normalized || "indefinido"),
    tone: "neutral" as const,
  };
  return {
    ...presentation,
    className: TONE_CLASS[presentation.tone],
  };
}
