export const TIPO_ORCAMENTO_INTERNO = "orcamentos_internos";

export const ORCAMENTO_INTERNO_STATUSES = [
  "rascunho",
  "aguardando_aprovacao",
  "em_analise_gestor",
  "ajuste_solicitado",
  "reenviado",
  "aprovado_assinado",
  "rejeitado",
  "cancelado",
] as const;

export type OrcamentoInternoStatus =
  (typeof ORCAMENTO_INTERNO_STATUSES)[number];

export const STATUS_LABEL: Record<OrcamentoInternoStatus, string> = {
  rascunho: "Rascunho",
  aguardando_aprovacao: "Aguardando aprovação",
  em_analise_gestor: "Em análise pelo gestor",
  ajuste_solicitado: "Ajuste solicitado",
  reenviado: "Reenviado",
  aprovado_assinado: "Aprovado e assinado",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
};
