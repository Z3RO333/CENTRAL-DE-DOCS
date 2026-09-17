import sgMail from "@sendgrid/mail";

export type OrcamentoApprovalNotification = {
  id: string;
  destinatarios: Iterable<string>;
  solicitanteEmail?: string | null;
  prestadorNome: string;
  lojaNome?: string | null;
  numeroOrcamento?: string | null;
  descricao?: string | null;
  valorTotal?: number | string | null;
  reenviado?: boolean;
};

export type OrcamentoAprovadoNotification = {
  id: string;
  solicitanteEmail?: string | null;
  prestadorNome: string;
  lojaNome?: string | null;
  numeroOrcamento?: string | null;
  descricao?: string | null;
  valorTotal?: number | string | null;
  aprovadoPorNome?: string | null;
  aprovadoPorEmail?: string | null;
};

export type OrcamentoNotificationResult =
  | { status: "sent"; recipientCount: number }
  | { status: "skipped"; recipientCount: 0; reason: "not_configured" | "no_recipients" }
  | { status: "failed"; recipientCount: number; reason: string };

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatCurrency(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "Não informado";
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return "Não informado";
  return numericValue.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function buildOrcamentoUrl(id: string, tab: "aprovacao" | "meus" = "aprovacao") {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (!siteUrl) return null;
  return `${siteUrl}/documentos/orcamentos-internos?tab=${tab}&orcamento=${encodeURIComponent(id)}`;
}

function buildApprovalUrl(id: string) {
  return buildOrcamentoUrl(id, "aprovacao");
}

export async function enviarEmailOrcamentoParaAprovacao(
  input: OrcamentoApprovalNotification,
): Promise<OrcamentoNotificationResult> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const fromEmail = normalizeEmail(process.env.FROM_EMAIL);
  if (!apiKey || !fromEmail) {
    return { status: "skipped", recipientCount: 0, reason: "not_configured" };
  }

  const solicitante = normalizeEmail(input.solicitanteEmail);
  const destinatarios = Array.from(input.destinatarios)
    .map(normalizeEmail)
    .filter((email): email is string => Boolean(email) && email !== solicitante);
  const destinatariosUnicos = [...new Set(destinatarios)];
  if (destinatariosUnicos.length === 0) {
    return { status: "skipped", recipientCount: 0, reason: "no_recipients" };
  }

  const approvalUrl = buildApprovalUrl(input.id);
  const actionLabel = input.reenviado ? "reenviado" : "enviado";
  const subjectPrefix = input.reenviado ? "Orçamento reenviado" : "Novo orçamento";
  const numero = input.numeroOrcamento?.trim() || "Sem número";
  const loja = input.lojaNome?.trim() || "Não informada";
  const descricao = input.descricao?.trim() || "Não informada";
  const valor = formatCurrency(input.valorTotal);
  const safePrestador = escapeHtml(input.prestadorNome || "Não informado");
  const safeNumero = escapeHtml(numero);
  const safeLoja = escapeHtml(loja);
  const safeDescricao = escapeHtml(descricao);
  const safeValor = escapeHtml(valor);

  const text = [
    `${subjectPrefix} aguardando aprovação.`,
    "",
    `Fornecedor: ${input.prestadorNome || "Não informado"}`,
    `Número do orçamento: ${numero}`,
    `Loja/unidade: ${loja}`,
    `Valor total: ${valor}`,
    `Descrição: ${descricao}`,
    "",
    approvalUrl
      ? `Abrir fila de aprovação: ${approvalUrl}`
      : "Acesse a Central de Documentos para analisar.",
    "",
    "Este é um aviso automático.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f1f5f9;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;overflow:hidden;border-radius:16px;background:#ffffff;box-shadow:0 10px 30px rgba(15,23,42,.08);">
          <tr><td style="padding:24px 28px;background:#0f2747;color:#ffffff;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#bae6fd;">Central de Documentos</div>
            <div style="margin-top:8px;font-size:22px;font-weight:700;">Orçamento ${actionLabel} para aprovação</div>
          </td></tr>
          <tr><td style="padding:28px;">
            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">Há um orçamento aguardando a análise dos gestores.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;">
              <tr><td style="padding:10px 14px;color:#64748b;">Fornecedor</td><td style="padding:10px 14px;text-align:right;font-weight:700;">${safePrestador}</td></tr>
              <tr style="background:#f8fafc;"><td style="padding:10px 14px;color:#64748b;">Número</td><td style="padding:10px 14px;text-align:right;font-weight:700;">${safeNumero}</td></tr>
              <tr><td style="padding:10px 14px;color:#64748b;">Loja/unidade</td><td style="padding:10px 14px;text-align:right;font-weight:700;">${safeLoja}</td></tr>
              <tr style="background:#f8fafc;"><td style="padding:10px 14px;color:#64748b;">Valor</td><td style="padding:10px 14px;text-align:right;font-weight:700;">${safeValor}</td></tr>
              <tr><td style="padding:10px 14px;color:#64748b;vertical-align:top;">Descrição</td><td style="padding:10px 14px;text-align:right;">${safeDescricao}</td></tr>
            </table>
            ${
              approvalUrl
                ? `<p style="margin:24px 0 0;text-align:center;"><a href="${escapeHtml(approvalUrl)}" style="display:inline-block;border-radius:999px;background:#0284c7;padding:13px 24px;color:#ffffff;text-decoration:none;font-weight:700;">Analisar orçamento</a></p>`
                : ""
            }
          </td></tr>
          <tr><td style="padding:16px 28px;background:#f8fafc;color:#64748b;font-size:12px;text-align:center;">Este é um aviso automático.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  try {
    sgMail.setApiKey(apiKey);
    await sgMail.sendMultiple({
      from: { email: fromEmail, name: "Central de Documentos" },
      to: destinatariosUnicos,
      subject: `${subjectPrefix} para aprovação — ${input.prestadorNome || "Fornecedor"}`,
      text,
      html,
    });
    return { status: "sent", recipientCount: destinatariosUnicos.length };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Falha desconhecida no SendGrid";
    console.error("Falha ao enviar aviso de orçamento aos aprovadores:", error);
    return { status: "failed", recipientCount: destinatariosUnicos.length, reason };
  }
}

/**
 * Avisa por e-mail quem enviou (anexou) o orçamento assim que ele é
 * aprovado e assinado.
 */
export async function enviarEmailOrcamentoAprovado(
  input: OrcamentoAprovadoNotification,
): Promise<OrcamentoNotificationResult> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const fromEmail = normalizeEmail(process.env.FROM_EMAIL);
  if (!apiKey || !fromEmail) {
    return { status: "skipped", recipientCount: 0, reason: "not_configured" };
  }

  const destinatario = normalizeEmail(input.solicitanteEmail);
  if (!destinatario) {
    return { status: "skipped", recipientCount: 0, reason: "no_recipients" };
  }

  const orcamentoUrl = buildOrcamentoUrl(input.id, "meus");
  const numero = input.numeroOrcamento?.trim() || "Sem número";
  const loja = input.lojaNome?.trim() || "Não informada";
  const descricao = input.descricao?.trim() || "Não informada";
  const valor = formatCurrency(input.valorTotal);
  const aprovadoPor =
    input.aprovadoPorNome?.trim() || input.aprovadoPorEmail?.trim() || "um gestor";
  const safePrestador = escapeHtml(input.prestadorNome || "Não informado");
  const safeNumero = escapeHtml(numero);
  const safeLoja = escapeHtml(loja);
  const safeDescricao = escapeHtml(descricao);
  const safeValor = escapeHtml(valor);
  const safeAprovadoPor = escapeHtml(aprovadoPor);

  const text = [
    `Seu orçamento foi aprovado e assinado por ${aprovadoPor}.`,
    "",
    `Fornecedor: ${input.prestadorNome || "Não informado"}`,
    `Número do orçamento: ${numero}`,
    `Loja/unidade: ${loja}`,
    `Valor total: ${valor}`,
    `Descrição: ${descricao}`,
    "",
    orcamentoUrl
      ? `Ver orçamento: ${orcamentoUrl}`
      : "Acesse a Central de Documentos para consultar.",
    "",
    "Este é um aviso automático.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f1f5f9;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;overflow:hidden;border-radius:16px;background:#ffffff;box-shadow:0 10px 30px rgba(15,23,42,.08);">
          <tr><td style="padding:24px 28px;background:#065f46;color:#ffffff;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#a7f3d0;">Central de Documentos</div>
            <div style="margin-top:8px;font-size:22px;font-weight:700;">Orçamento aprovado e assinado</div>
          </td></tr>
          <tr><td style="padding:28px;">
            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">Seu orçamento foi aprovado e assinado por <strong>${safeAprovadoPor}</strong>.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;">
              <tr><td style="padding:10px 14px;color:#64748b;">Fornecedor</td><td style="padding:10px 14px;text-align:right;font-weight:700;">${safePrestador}</td></tr>
              <tr style="background:#f8fafc;"><td style="padding:10px 14px;color:#64748b;">Número</td><td style="padding:10px 14px;text-align:right;font-weight:700;">${safeNumero}</td></tr>
              <tr><td style="padding:10px 14px;color:#64748b;">Loja/unidade</td><td style="padding:10px 14px;text-align:right;font-weight:700;">${safeLoja}</td></tr>
              <tr style="background:#f8fafc;"><td style="padding:10px 14px;color:#64748b;">Valor</td><td style="padding:10px 14px;text-align:right;font-weight:700;">${safeValor}</td></tr>
              <tr><td style="padding:10px 14px;color:#64748b;vertical-align:top;">Descrição</td><td style="padding:10px 14px;text-align:right;">${safeDescricao}</td></tr>
            </table>
            ${
              orcamentoUrl
                ? `<p style="margin:24px 0 0;text-align:center;"><a href="${escapeHtml(orcamentoUrl)}" style="display:inline-block;border-radius:999px;background:#059669;padding:13px 24px;color:#ffffff;text-decoration:none;font-weight:700;">Ver orçamento</a></p>`
                : ""
            }
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
      to: destinatario,
      subject: `Orçamento aprovado — ${input.prestadorNome || "Fornecedor"}`,
      text,
      html,
    });
    return { status: "sent", recipientCount: 1 };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Falha desconhecida no SendGrid";
    console.error("Falha ao enviar aviso de orçamento aprovado ao solicitante:", error);
    return { status: "failed", recipientCount: 0, reason };
  }
}
