import sgMail from "@sendgrid/mail";
import fs from "fs";
import path from "path";

const MESES_PT = [
  "JANEIRO",
  "FEVEREIRO",
  "MARÇO",
  "ABRIL",
  "MAIO",
  "JUNHO",
  "JULHO",
  "AGOSTO",
  "SETEMBRO",
  "OUTUBRO",
  "NOVEMBRO",
  "DEZEMBRO",
];

export function formatarMeses(meses: number[]): string {
  return meses.map((m) => MESES_PT[m - 1]).join(", ");
}

export type PendenciaLoja = {
  loja_nome: string;
  meses_pendentes: number[];
  total_recebido: number;
  total_faltante: number;
};

function carregarLogoBase64(): string | null {
  try {
    const logoPath = path.join(process.cwd(), "public", "logo-manutencao.png");
    return fs.readFileSync(logoPath).toString("base64");
  } catch {
    return null;
  }
}

export async function enviarEmailCobranca(params: {
  prestador_nome: string;
  destinatarios: string[];
  ano_referencia: number;
  pendencias_por_loja: PendenciaLoja[];
}): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    throw new Error(
      "Configuração SendGrid incompleta. Verifique SENDGRID_API_KEY e FROM_EMAIL.",
    );
  }

  sgMail.setApiKey(apiKey);

  const { prestador_nome, destinatarios, ano_referencia, pendencias_por_loja } =
    params;

  const logoBase64 = carregarLogoBase64();
  const logoHtml = logoBase64
    ? `<img src="cid:logo_manutencao" alt="Manutenção Bemol" style="height:52px;display:block;" />`
    : `<span style="font-size:18px;font-weight:bold;color:#ffffff;">Manutenção Bemol</span>`;

  const detalhesHtml = pendencias_por_loja
    .map(
      (p) => `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;">${p.loja_nome}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#e67e22;">${formatarMeses(p.meses_pendentes)}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:center;color:#555;">12</td>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:center;color:#27ae60;font-weight:600;">${p.total_recebido}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:center;color:#c0392b;font-weight:700;">${p.total_faltante}</td>
      </tr>`,
    )
    .join("");

  const totalFaltante = pendencias_por_loja.reduce(
    (acc, p) => acc + p.total_faltante,
    0,
  );
  const totalLojas = pendencias_por_loja.length;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="background:#1a2b4a;border-radius:8px 8px 0 0;padding:24px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>${logoHtml}</td>
                  <td align="right" style="font-size:12px;color:#8fa3c0;vertical-align:bottom;">
                    Ano de referência: <strong style="color:#ffffff;">${ano_referencia}</strong>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TÍTULO -->
          <tr>
            <td style="background:#c0392b;padding:16px 32px;">
              <p style="margin:0;font-size:15px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">
                ⚠️ Pendência de Documentação Mensal — Geradores
              </p>
            </td>
          </tr>

          <!-- CORPO -->
          <tr>
            <td style="background:#ffffff;padding:32px;">

              <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;">Prezados,</p>
              <p style="margin:0 0 24px;font-size:15px;color:#333;line-height:1.6;">
                Identificamos pendências na documentação mensal obrigatória referente aos
                <strong>geradores das lojas/unidades</strong> atendidas por este fornecedor.
              </p>

              <!-- RESUMO -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#f8f9fa;border-radius:6px;padding:16px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:13px;color:#666;">Fornecedor</td>
                        <td style="font-size:13px;color:#666;text-align:right;">Lojas com pendência</td>
                      </tr>
                      <tr>
                        <td style="font-size:16px;font-weight:700;color:#1a2b4a;padding-top:4px;">${prestador_nome}</td>
                        <td style="font-size:16px;font-weight:700;color:#c0392b;text-align:right;padding-top:4px;">${totalLojas} loja${totalLojas > 1 ? "s" : ""} · ${totalFaltante} doc${totalFaltante > 1 ? "s" : ""} faltando</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- TABELA -->
              <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1a2b4a;text-transform:uppercase;letter-spacing:0.5px;">
                Pendências identificadas
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8e8;border-radius:6px;overflow:hidden;">
                <thead>
                  <tr style="background:#f0f4f8;">
                    <th style="padding:12px 16px;font-size:12px;font-weight:700;color:#555;text-align:left;text-transform:uppercase;letter-spacing:0.4px;">Loja / Unidade</th>
                    <th style="padding:12px 16px;font-size:12px;font-weight:700;color:#555;text-align:left;text-transform:uppercase;letter-spacing:0.4px;">Meses pendentes</th>
                    <th style="padding:12px 16px;font-size:12px;font-weight:700;color:#555;text-align:center;text-transform:uppercase;letter-spacing:0.4px;">Esperados</th>
                    <th style="padding:12px 16px;font-size:12px;font-weight:700;color:#555;text-align:center;text-transform:uppercase;letter-spacing:0.4px;">Recebidos</th>
                    <th style="padding:12px 16px;font-size:12px;font-weight:700;color:#555;text-align:center;text-transform:uppercase;letter-spacing:0.4px;">Faltantes</th>
                  </tr>
                </thead>
                <tbody>
                  ${detalhesHtml}
                </tbody>
              </table>

              <p style="margin:28px 0 16px;font-size:15px;color:#333;line-height:1.6;">
                Solicitamos a <strong>regularização imediata</strong> das pendências acima.
              </p>

              <!-- ALERTA -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#fff8e1;border-left:4px solid #f39c12;border-radius:0 6px 6px 0;padding:14px 18px;">
                    <p style="margin:0;font-size:14px;color:#7d5a00;line-height:1.6;">
                      <strong>Atenção:</strong> A ausência da documentação obrigatória poderá
                      impactar diretamente o <strong>processo de pagamento</strong> do fornecedor
                      até que todos os documentos exigidos sejam enviados e validados.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:28px 0 0;font-size:14px;color:#555;line-height:1.6;">
                Atenciosamente,<br/>
                <strong style="color:#1a2b4a;">Equipe de Manutenção</strong>
              </p>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#e8ecf0;border-radius:0 0 8px 8px;padding:16px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#888;">
                Este é um e-mail automático. Por favor, não responda diretamente a esta mensagem.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;

  const text =
    `Prezados,\n\n` +
    `Identificamos pendências na documentação mensal obrigatória referente aos geradores das lojas/unidades atendidas por este fornecedor.\n\n` +
    `Fornecedor: ${prestador_nome}\n` +
    `Ano de referência: ${ano_referencia}\n\n` +
    `Pendências identificadas:\n\n` +
    pendencias_por_loja
      .map(
        (p) =>
          `Loja/Unidade: ${p.loja_nome}\n` +
          `Meses pendentes: ${formatarMeses(p.meses_pendentes)}\n` +
          `Documentos esperados: 12\n` +
          `Documentos recebidos: ${p.total_recebido}\n` +
          `Documentos faltantes: ${p.total_faltante}`,
      )
      .join("\n\n") +
    `\n\nSolicitamos a regularização imediata das pendências acima.\n\n` +
    `Ressaltamos que a ausência da documentação obrigatória poderá impactar diretamente o processo de pagamento do fornecedor até que todos os documentos exigidos sejam enviados e validados.\n\n` +
    `Atenciosamente,\nEquipe de Manutenção`;

  const ccList = destinatarios.includes(fromEmail) ? undefined : fromEmail;

  const attachments = logoBase64
    ? [
        {
          content: logoBase64,
          filename: "logo-manutencao.png",
          type: "image/png",
          disposition: "inline" as const,
          content_id: "logo_manutencao",
        },
      ]
    : undefined;

  await sgMail.send({
    from: fromEmail,
    to: destinatarios,
    ...(ccList ? { cc: ccList } : {}),
    subject: `Pendência de Documentação Mensal — Geradores (${ano_referencia})`,
    text,
    html,
    ...(attachments ? { attachments } : {}),
  });
}
