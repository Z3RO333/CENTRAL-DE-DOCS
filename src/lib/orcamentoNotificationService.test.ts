import { beforeEach, describe, expect, it, vi } from "vitest";

const sendgrid = vi.hoisted(() => ({
  setApiKey: vi.fn(),
  sendMultiple: vi.fn(),
}));

vi.mock("@sendgrid/mail", () => ({ default: sendgrid }));

import { enviarEmailOrcamentoParaAprovacao } from "./orcamentoNotificationService";

const inputBase = {
  id: "orcamento-123",
  destinatarios: ["gestor@bemol.com.br"],
  solicitanteEmail: "solicitante@bemol.com.br",
  prestadorNome: "Fornecedor Teste",
  lojaNome: "Loja Centro",
  numeroOrcamento: "ORC-42",
  descricao: "Troca de equipamento",
  valorTotal: 1234.56,
};

describe("enviarEmailOrcamentoParaAprovacao", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SENDGRID_API_KEY;
    delete process.env.FROM_EMAIL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  it("ignora o envio quando o e-mail não está configurado", async () => {
    const result = await enviarEmailOrcamentoParaAprovacao(inputBase);

    expect(result).toEqual({
      status: "skipped",
      recipientCount: 0,
      reason: "not_configured",
    });
    expect(sendgrid.sendMultiple).not.toHaveBeenCalled();
  });

  it("envia uma mensagem individual por gestor e exclui o próprio solicitante", async () => {
    process.env.SENDGRID_API_KEY = "SG.test";
    process.env.FROM_EMAIL = "Avisos@Bemol.com.br";
    process.env.NEXT_PUBLIC_SITE_URL = "https://documentos.exemplo.com/";
    sendgrid.sendMultiple.mockResolvedValueOnce([{}, {}]);

    const result = await enviarEmailOrcamentoParaAprovacao({
      ...inputBase,
      destinatarios: [
        "GESTOR@bemol.com.br",
        "gestor@bemol.com.br",
        "solicitante@bemol.com.br",
        "segundo@bemol.com.br",
      ],
    });

    expect(result).toEqual({ status: "sent", recipientCount: 2 });
    expect(sendgrid.setApiKey).toHaveBeenCalledWith("SG.test");
    expect(sendgrid.sendMultiple).toHaveBeenCalledOnce();
    expect(sendgrid.sendMultiple).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { email: "avisos@bemol.com.br", name: "Central de Documentos" },
        to: ["gestor@bemol.com.br", "segundo@bemol.com.br"],
        subject: "Novo orçamento para aprovação — Fornecedor Teste",
        text: expect.stringContaining(
          "https://documentos.exemplo.com/documentos/orcamentos-internos?tab=aprovacao&orcamento=orcamento-123",
        ),
      }),
    );
  });

  it("escapa conteúdo variável no HTML e registra falha sem lançar erro", async () => {
    process.env.SENDGRID_API_KEY = "SG.test";
    process.env.FROM_EMAIL = "avisos@bemol.com.br";
    sendgrid.sendMultiple.mockRejectedValueOnce(new Error("SendGrid indisponível"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await enviarEmailOrcamentoParaAprovacao({
      ...inputBase,
      prestadorNome: "Fornecedor <script>",
    });

    expect(result).toEqual({
      status: "failed",
      recipientCount: 1,
      reason: "SendGrid indisponível",
    });
    const payload = sendgrid.sendMultiple.mock.calls[0][0];
    expect(payload.html).toContain("Fornecedor &lt;script&gt;");
    expect(payload.html).not.toContain("Fornecedor <script>");
    consoleError.mockRestore();
  });
});
