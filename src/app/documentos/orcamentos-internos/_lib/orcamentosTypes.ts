import type { OrcamentoInternoStatus } from "@/lib/orcamentosInternosShared";

export type GestorOption = {
  id: string | null;
  email: string;
  name: string | null;
  role: "admin" | "gerente";
};

export type ColaboradorOption = {
  id: string;
  email: string;
  name: string | null;
};

export type OrcamentoInterno = {
  id: string;
  solicitante_id: string;
  solicitante_email: string | null;
  loja_id: string | null;
  loja_nome: string | null;
  area_solicitante: string;
  prestador_id: string | null;
  prestador_nome: string;
  fornecedor_cnpj: string | null;
  numero_orcamento: string;
  descricao: string;
  valor_total: number | null;
  data_validade: string | null;
  numero_referencia: string | null;
  numero_pedido: string | null;
  gestor_id: string | null;
  gestor_email: string;
  gestor_nome: string | null;
  observacoes: string | null;
  arquivo_original_path: string;
  arquivo_original_nome?: string | null;
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
