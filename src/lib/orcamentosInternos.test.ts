import { describe, expect, it } from "vitest";
import {
  assertCanDecide,
  assertCanManageSignedOrcamento,
  resolverEtapaAprovacao,
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
  numero_pedido: null,
  gestor_id: null,
  gestor_email: "",
  gestor_nome: null,
  aprovadores_emails: null,
  pre_aprovado_por: null,
  pre_aprovado_email: null,
  pre_aprovado_nome: null,
  pre_aprovado_em: null,
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

  it("impede que o solicitante decida o próprio orçamento, mesmo sendo aprovador", () => {
    expect(() =>
      assertCanDecide(
        { ...baseRow, solicitante_id: "aprovador-1" },
        actor(),
        new Set(["aprovador1@bemol.com.br"]),
      ),
    ).toThrow("Você não pode decidir um orçamento que você mesmo enviou.");
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

  it("permite que administrador gerencie um orçamento assinado", () => {
    expect(() =>
      assertCanManageSignedOrcamento(
        { ...baseRow, status: "aprovado_assinado" },
        actor({ realIsAdmin: true, isAdmin: true }),
      ),
    ).not.toThrow();
  });

  it("impede alterações pós-assinatura por não administradores", () => {
    expect(() =>
      assertCanManageSignedOrcamento(
        { ...baseRow, status: "aprovado_assinado" },
        actor(),
      ),
    ).toThrow("Somente administradores");
  });

  it("aprovadores_emails do registro não restringe mais quem decide (só a faixa de valor decide)", () => {
    const direcionado = {
      ...baseRow,
      aprovadores_emails: ["aprovador2@bemol.com.br"],
    };
    expect(() =>
      assertCanDecide(direcionado, actor(), new Set(["aprovador1@bemol.com.br"])),
    ).not.toThrow();
  });

  it("administrador sem estar na lista de aprovadores não pode decidir", () => {
    expect(() =>
      assertCanDecide(
        baseRow,
        actor({
          userId: "admin-1",
          email: "admin@bemol.com.br",
          realUserId: "admin-1",
          realEmail: "admin@bemol.com.br",
          realIsAdmin: true,
          isAdmin: true,
        }),
        new Set(["aprovador1@bemol.com.br"]),
      ),
    ).toThrow("Somente um aprovador");
  });
});

describe("resolverEtapaAprovacao (faixa de valor)", () => {
  it("valor até 15.000 vai direto pro grupo padrão e finaliza", () => {
    expect(
      resolverEtapaAprovacao({ valor_total: 15000, pre_aprovado_por: null }),
    ).toEqual({ grupo: "padrao", finalizaAprovacao: true });
  });

  it("valor a partir de 15.000,01 exige pré-aprovação do grupo padrão primeiro", () => {
    expect(
      resolverEtapaAprovacao({ valor_total: 15000.01, pre_aprovado_por: null }),
    ).toEqual({ grupo: "padrao", finalizaAprovacao: false });
  });

  it("depois de pré-aprovado, cai pro grupo alta finalizar", () => {
    expect(
      resolverEtapaAprovacao({ valor_total: 20000, pre_aprovado_por: "gestor-1" }),
    ).toEqual({ grupo: "alta", finalizaAprovacao: true });
  });

  it("valor não informado é tratado como faixa alta por segurança", () => {
    expect(
      resolverEtapaAprovacao({ valor_total: null, pre_aprovado_por: null }),
    ).toEqual({ grupo: "padrao", finalizaAprovacao: false });
  });
});
