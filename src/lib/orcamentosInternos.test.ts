import { describe, expect, it } from "vitest";
import {
  assertCanDecide,
  assertCanManageSignedOrcamento,
  elegiveisParaDecidir,
  finalizaAoAprovar,
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
  pre_aprovado_arquivo_path: null,
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

const grupos = {
  padrao: [
    { email: "walterrodrigues@bemol.com.br", nome: "Walter", grupo: "padrao" as const },
    { email: "lucianaoliveira@bemol.com.br", nome: "Luciana", grupo: "padrao" as const },
  ],
  alta: [
    { email: "danieldamasceno@bemol.com.br", nome: "Daniel", grupo: "alta" as const },
    { email: "flavioqueiroz@bemol.com.br", nome: "Flávio", grupo: "alta" as const },
  ],
};

describe("finalizaAoAprovar (faixa de valor)", () => {
  it("faixa baixa finaliza para qualquer grupo", () => {
    expect(finalizaAoAprovar({ valor_total: 15000 }, "padrao")).toBe(true);
    expect(finalizaAoAprovar({ valor_total: 15000 }, "alta")).toBe(true);
  });

  it("faixa alta só finaliza quando quem decide é do grupo alta", () => {
    expect(finalizaAoAprovar({ valor_total: 15000.01 }, "padrao")).toBe(false);
    expect(finalizaAoAprovar({ valor_total: 15000.01 }, "alta")).toBe(true);
  });

  it("Daniel/Flávio aprovam qualquer valor direto, mesmo faixa alta", () => {
    expect(finalizaAoAprovar({ valor_total: 999999 }, "alta")).toBe(true);
  });

  it("valor não informado é tratado como faixa alta por segurança", () => {
    expect(finalizaAoAprovar({ valor_total: null }, "padrao")).toBe(false);
    expect(finalizaAoAprovar({ valor_total: null }, "alta")).toBe(true);
  });
});

describe("elegiveisParaDecidir", () => {
  it("antes de pré-aprovar, qualquer aprovador (padrão ou alta) pode agir", () => {
    const elegiveis = elegiveisParaDecidir(
      { valor_total: 30000, pre_aprovado_por: null },
      grupos,
    );
    expect(elegiveis.has("walterrodrigues@bemol.com.br")).toBe(true);
    expect(elegiveis.has("danieldamasceno@bemol.com.br")).toBe(true);
  });

  it("depois de pré-aprovado em faixa alta, só o grupo alta decide", () => {
    const elegiveis = elegiveisParaDecidir(
      { valor_total: 30000, pre_aprovado_por: "gestor-1" },
      grupos,
    );
    expect(elegiveis.has("walterrodrigues@bemol.com.br")).toBe(false);
    expect(elegiveis.has("danieldamasceno@bemol.com.br")).toBe(true);
  });

  it("faixa baixa é sempre de todo mundo, mesmo com pre_aprovado_por preenchido", () => {
    const elegiveis = elegiveisParaDecidir(
      { valor_total: 10000, pre_aprovado_por: "gestor-1" },
      grupos,
    );
    expect(elegiveis.has("walterrodrigues@bemol.com.br")).toBe(true);
  });
});
