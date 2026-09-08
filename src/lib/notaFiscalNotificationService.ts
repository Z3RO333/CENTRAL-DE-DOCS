import sgMail from "@sendgrid/mail";

export const NOTA_FISCAL_DESTINATARIO = "ordensmanutencao@bemol.com.br";

export type NotaFiscalNotification = {
  id: string;
  conservacao?: boolean;
  prestadorNome?: string | null;
  lojaNome?: string | null;
  numeroNf?: string | null;
  numeroPedido?: string | null;
  competencia?: string | null;
  valor?: number | string | null;
};

export type NotaFiscalNotificationResult =
  | { status: "sent" }
  | { status: "skipped"; reason: "not_configured" | "not_invoice" | "already_sent" }
  | { status: "failed"; reason: string };

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export async function enviarEmailNovaNotaFiscal(
  input: NotaFiscalNotification,
): Promise<NotaFiscalNotificationResult> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const fromEmail = process.env.FROM_EMAIL?.trim().toLowerCase();
  if (!apiKey || !fromEmail) return { status: "skipped", reason: "not_configured" };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  const documentUrl = siteUrl
    ? `${siteUrl}${input.conservacao
      ? "/documentos/conservacao/notas-fiscais"
      : `/documentos?tipo=notas_fiscais&documento=${encodeURIComponent(input.id)}`}`
    : null;
  const valor = input.valor === null || input.valor === undefined || input.valor === ""
    ? NaN : Number(input.valor);
  const fields = [
    ["Fornecedor", input.prestadorNome?.trim() || "Não informado"],
    ["Número da NF", input.numeroNf?.trim() || "Não informado"],
    ["Loja/unidade", input.lojaNome?.trim() || "Não informada"],
    ["Pedido", input.numeroPedido?.trim() || "Não informado"],
    ["Competência", input.competencia?.trim() || "Não informada"],
    ["Valor", Number.isFinite(valor)
      ? valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : "Não informado"],
  ];
  const text = [
    "Nova nota fiscal recebida na Central de Documentos.", "",
    ...fields.map(([label, value]) => `${label}: ${value}`), "",
    documentUrl ? `Consultar nota fiscal: ${documentUrl}` : "Acesse a Central de Documentos para consultar a nota fiscal.",
    "", "Este é um aviso automático.",
  ].join("\n");
  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f1f5f9;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;overflow:hidden;border-radius:16px;background:#ffffff;">
          <tr><td style="padding:24px 28px;background:#0f2747;color:#ffffff;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#bae6fd;">Central de Documentos</div>
            <div style="margin-top:8px;font-size:22px;font-weight:700;">Nova nota fiscal recebida</div>
          </td></tr>
          <tr><td style="padding:28px;">
            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">Uma nova nota fiscal está disponível para consulta.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;">
              ${fields.map(([label, value], index) => `<tr style="background:${index % 2 ? "#f8fafc" : "#ffffff"};"><td style="padding:10px 14px;color:#64748b;">${escapeHtml(label)}</td><td style="padding:10px 14px;text-align:right;font-weight:700;">${escapeHtml(value)}</td></tr>`).join("")}
            </table>
            ${documentUrl ? `<p style="margin:24px 0 0;text-align:center;"><a href="${escapeHtml(documentUrl)}" style="display:inline-block;border-radius:999px;background:#0284c7;padding:13px 24px;color:#ffffff;text-decoration:none;font-weight:700;">Consultar nota fiscal</a></p>` : ""}
          </td></tr>
          <tr><td style="padding:16px 28px;background:#f8fafc;color:#64748b;font-size:12px;text-align:center;">Este é um aviso automático.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  try {
    sgMail.setApiKey(apiKey);
    await sgMail.send({
      from: { email: fromEmail, name: "Central de Documentos" },
      to: NOTA_FISCAL_DESTINATARIO,
      subject: `Nova nota fiscal recebida — ${input.prestadorNome || "Fornecedor"}`,
      text,
      html,
    });
    return { status: "sent" };
  } catch (error) {
    console.error("Falha ao enviar aviso de nova nota fiscal:", error);
    return { status: "failed", reason: error instanceof Error ? error.message : "Falha no SendGrid" };
  }
}
