import { describe, expect, it } from "vitest";
import {
  assertCanDecide,
  validateOrcamentoInput,
  type OrcamentoInternoRow,
} from "@/lib/orcamentosInternos";
import type { Actor } from "@/lib/apiAuth";

const arquivo = {
  path: "usuario/orcamentos_internos/originais/orcamento.pdf",
  name: "orcamento.pdf",
  type: "application/pdf",
  principal: true,
};

const baseRow: OrcamentoInternoRow = {
  id: "orcamento-1",
  solicitante_id: "solicitante-1",
  solicitante_email: "solicitante@bemol.com.br",
  loja_id: null,
  loja_nome: null,
  area_solicitante: "",
  prestador_id: null,
  prestador_nome: "Fornecedor Teste",
  fornecedor_cnpj: "00.000.000/0001-00",
  numero_orcamento: "ORC-10",
  descricao: "Serviço de teste",
  valor_total: 100,
  data_validade: null,
  numero_referencia: null,
  gestor_id: "gestor-1",
  gestor_email: "gestor@bemol.com.br",
  gestor_nome: "Gestor",
  observacoes: null,
  arquivo_original_path: arquivo.path,
  arquivo_assinado_path: null,
  status: "aguardando_aprovacao",
  versao_atual: 1,
  enviado_em: null,
  aprovado_em: null,
  rejeitado_em: null,
  cancelado_em: null,
  ultima_justificativa: null,
  created_at: "2026-07-23T00:00:00.000Z",
  updated_at: "2026-07-23T00:00:00.000Z",
};

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "gestor-1",
    email: "gestor@bemol.com.br",
    isAdmin: false,
    realUserId: "gestor-1",
    realEmail: "gestor@bemol.com.br",
    realIsAdmin: false,
    isSimulating: false,
    ...overrides,
  };
}

describe("fluxo de orçamentos internos", () => {
  it("exige fornecedor e gestor ao enviar para aprovação", () => {
    expect(() =>
      validateOrcamentoInput({ arquivos: [arquivo] }, "submit"),
    ).toThrow("Confirme o fornecedor");

    expect(() =>
      validateOrcamentoInput(
        { arquivos: [arquivo], prestadorNome: "Fornecedor Teste" },
        "submit",
      ),
    ).toThrow("Selecione o gestor");
  });

  it("aceita rascunho contendo somente o PDF", () => {
    expect(() =>
      validateOrcamentoInput({ arquivos: [arquivo] }, "draft"),
    ).not.toThrow();
  });

  it("permite decisão do aprovador atribuído", () => {
    expect(() =>
      assertCanDecide(baseRow, actor(), new Set(["gestor@bemol.com.br"])),
    ).not.toThrow();
  });

  it("impede que outro aprovador decida o orçamento", () => {
    expect(() =>
      assertCanDecide(
        baseRow,
        actor({
          userId: "gestor-2",
          email: "outro@bemol.com.br",
          realUserId: "gestor-2",
          realEmail: "outro@bemol.com.br",
        }),
        new Set(["gestor@bemol.com.br", "outro@bemol.com.br"]),
      ),
    ).toThrow("Somente um aprovador");
  });

  it("impede decisão em orçamento já encerrado", () => {
    expect(() =>
      assertCanDecide(
        { ...baseRow, status: "aprovado_assinado" },
        actor(),
        new Set(["gestor@bemol.com.br"]),
      ),
    ).toThrow("não está aguardando decisão");
  });
});
