import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendgrid = vi.hoisted(() => ({ setApiKey: vi.fn(), send: vi.fn() }));
vi.mock("@sendgrid/mail", () => ({ default: sendgrid }));
import { enviarEmailNovaNotaFiscal } from "./notaFiscalNotificationService";

describe("enviarEmailNovaNotaFiscal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SENDGRID_API_KEY", "SG.test");
    vi.stubEnv("FROM_EMAIL", "Avisos@Bemol.com.br");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://documentos.exemplo.com/");
    sendgrid.send.mockResolvedValue([]);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("envia para a caixa de manutenção com os dados e link da nova nota", async () => {
    const result = await enviarEmailNovaNotaFiscal({
      id: "nf-123", prestadorNome: "Fornecedor Teste", lojaNome: "Centro",
      numeroNf: "42", numeroPedido: "100", competencia: "09/2026", valor: 1234.56,
    });
    expect(result).toEqual({ status: "sent" });
    expect(sendgrid.send).toHaveBeenCalledOnce();
    const message = sendgrid.send.mock.calls[0][0];
    expect(message).toMatchObject({
      from: { email: "avisos@bemol.com.br", name: "Central de Documentos" },
      to: "ordensmanutencao@bemol.com.br",
      subject: "Nova nota fiscal recebida — Fornecedor Teste",
    });
    for (const text of ["Número da NF: 42", "Pedido: 100", "Competência: 09/2026", "1.234,56",
      "https://documentos.exemplo.com/documentos?tipo=notas_fiscais&documento=nf-123"]) {
      expect(message.text).toContain(text);
    }
  });

  it("usa o destino de conservação e escapa conteúdo no HTML", async () => {
    await enviarEmailNovaNotaFiscal({ id: "nf-1", conservacao: true, prestadorNome: "<script>" });
    const message = sendgrid.send.mock.calls[0][0];
    expect(message.text).toContain("/documentos/conservacao/notas-fiscais");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).not.toContain("<script>");
    expect(message.text).toContain("Valor: Não informado");
  });

  it("ignora envio sem configuração", async () => {
    vi.stubEnv("SENDGRID_API_KEY", "");
    expect(await enviarEmailNovaNotaFiscal({ id: "nf-1" })).toEqual({ status: "skipped", reason: "not_configured" });
    expect(sendgrid.send).not.toHaveBeenCalled();
  });

  it("retorna a falha do provedor sem lançar erro", async () => {
    sendgrid.send.mockRejectedValueOnce(new Error("SendGrid indisponível"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await enviarEmailNovaNotaFiscal({ id: "nf-1" })).toEqual({ status: "failed", reason: "SendGrid indisponível" });
  });
});
