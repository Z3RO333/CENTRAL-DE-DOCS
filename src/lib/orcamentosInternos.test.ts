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
  gestor_id: null,
  gestor_email: "",
  gestor_nome: null,
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
    userId: "aprovador-1",
    email: "aprovador1@bemol.com.br",
    isAdmin: false,
    realUserId: "aprovador-1",
    realEmail: "aprovador1@bemol.com.br",
    realIsAdmin: false,
    isSimulating: false,
    ...overrides,
  };
}

describe("fluxo de orçamentos internos", () => {
  it("exige fornecedor ao enviar para aprovação", () => {
    expect(() =>
      validateOrcamentoInput({ arquivos: [arquivo] }, "submit"),
    ).toThrow("Confirme o fornecedor");

    expect(() =>
      validateOrcamentoInput(
        { arquivos: [arquivo], prestadorNome: "Fornecedor Teste" },
        "submit",
      ),
    ).not.toThrow();
  });

  it("aceita rascunho contendo somente o PDF", () => {
    expect(() =>
      validateOrcamentoInput({ arquivos: [arquivo] }, "draft"),
    ).not.toThrow();
  });

  it("permite decisão de qualquer aprovador cadastrado", () => {
    const aprovadores = new Set([
      "aprovador1@bemol.com.br",
      "aprovador2@bemol.com.br",
    ]);
    expect(() => assertCanDecide(baseRow, actor(), aprovadores)).not.toThrow();
    expect(() =>
      assertCanDecide(
        baseRow,
        actor({
          userId: "aprovador-2",
          email: "aprovador2@bemol.com.br",
          realUserId: "aprovador-2",
          realEmail: "aprovador2@bemol.com.br",
        }),
        aprovadores,
      ),
    ).not.toThrow();
  });

  it("impede decisão de quem não está na lista de aprovadores", () => {
    expect(() =>
      assertCanDecide(
        baseRow,
        actor({
          userId: "estranho-1",
          email: "naoaprovador@bemol.com.br",
          realUserId: "estranho-1",
          realEmail: "naoaprovador@bemol.com.br",
        }),
        new Set(["aprovador1@bemol.com.br", "aprovador2@bemol.com.br"]),
      ),
    ).toThrow("Somente um aprovador");
  });

  it("impede decisão em orçamento já encerrado", () => {
    expect(() =>
      assertCanDecide(
        { ...baseRow, status: "aprovado_assinado" },
        actor(),
        new Set(["aprovador1@bemol.com.br"]),
      ),
    ).toThrow("não está aguardando decisão");
  });
});
