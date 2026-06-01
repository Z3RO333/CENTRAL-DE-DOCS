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
  total_esperado: number;
  total_recebido: number;
  total_faltante: number;
};

// Nomes curtos dos meses em português
const MESES_NOMES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

const DOCS_CARDS = [
  {
    titulo: "Retenção Trabalhista",
    icone: "📋",
    descricao: "FGTS · INSS · FOPAG · SINETRAM · Vale-transporte · PERDCOMP",
  },
  {
    titulo: "Registro de Laudos",
    icone: "🔧",
    descricao: "Laudos técnicos e registros de manutenção das unidades",
  },
];

// Cache da logo em escopo de módulo (lida do disco uma única vez)
let logoCache: string | null | undefined;
function carregarLogoBase64(): string | null {
  if (logoCache !== undefined) return logoCache;
  try {
    const logoPath = path.join(process.cwd(), "public", "logo-manutencao.png");
    logoCache = fs.readFileSync(logoPath).toString("base64");
  } catch {
    logoCache = null;
  }
  return logoCache;
}

export async function enviarEmailCobranca(params: {
  prestador_nome: string;
  destinatarios: string[];
  ano_referencia: number;
  mes_limite: number;
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

  const { prestador_nome, destinatarios, ano_referencia, mes_limite, pendencias_por_loja } =
    params;

  // "Jan–Mai/2026" — período de referência da cobrança
  const periodoLabel =
    mes_limite >= 1
      ? `Jan–${MESES_NOMES[mes_limite - 1]}/${ano_referencia}`
      : String(ano_referencia);

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
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:center;font-weight:700;">
          <span style="color:#27ae60;">${p.total_recebido}</span><span style="color:#aaa;">/</span><span style="color:#555;">${mes_limite}</span>
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:center;color:#c0392b;font-weight:700;">${p.total_faltante}</td>
      </tr>`,
    )
    .join("");

  const totalFaltante = pendencias_por_loja.reduce(
    (acc, p) => acc + p.total_faltante,
    0,
  );
  const totalLojas = pendencias_por_loja.length;

  // Prazo de regularização: 7 dias a partir de hoje
  const prazoData = new Date();
  prazoData.setDate(prazoData.getDate() + 7);
  const prazoFormatado = prazoData.toLocaleDateString("pt-BR", {
    timeZone: "America/Manaus",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const portalUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const docsCardsHtml = DOCS_CARDS.map(
    (d) => `
    <td width="50%" style="padding:0 8px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:#f3f6fb;border-left:4px solid #1a2b4a;border-radius:0 8px 8px 0;padding:16px 18px;">
            <p style="margin:0 0 4px;font-size:18px;">${d.icone}</p>
            <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1a2b4a;">${d.titulo}</p>
            <p style="margin:0;font-size:12px;color:#666;line-height:1.5;">${d.descricao}</p>
          </td>
        </tr>
      </table>
    </td>`,
  ).join("");
  const docsTxt = DOCS_CARDS.map((d) => `  - ${d.titulo}: ${d.descricao}`).join("\n");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
    <tr>
      <td>
        <table width="100%" cellpadding="0" cellspacing="0">

          <!-- HEADER -->
          <tr>
            <td style="background:#1a2b4a;padding:28px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>${logoHtml}</td>
                  <td align="right" style="font-size:12px;color:#8fa3c0;vertical-align:bottom;">
                    Período: <strong style="color:#ffffff;">${periodoLabel}</strong>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TÍTULO -->
          <tr>
            <td style="background:#c0392b;padding:18px 40px;">
              <p style="margin:0;font-size:16px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">
                ⚠️ Pendência de Documentação Mensal Obrigatória
              </p>
            </td>
          </tr>

          <!-- CORPO -->
          <tr>
            <td style="background:#ffffff;padding:36px 40px;">

              <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.7;">Prezados,</p>
              <p style="margin:0 0 28px;font-size:15px;color:#333;line-height:1.7;">
                Identificamos pendências na documentação mensal obrigatória referente às
                <strong>lojas/unidades</strong> atendidas por este fornecedor.
              </p>

              <!-- RESUMO -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#f3f6fb;border-radius:8px;padding:20px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Fornecedor</td>
                        <td style="font-size:12px;color:#888;text-align:right;text-transform:uppercase;letter-spacing:0.5px;">Resumo</td>
                      </tr>
                      <tr>
                        <td style="font-size:20px;font-weight:700;color:#1a2b4a;padding-top:6px;">${prestador_nome}</td>
                        <td style="text-align:right;padding-top:6px;">
                          <span style="font-size:18px;font-weight:700;color:#c0392b;">${totalFaltante}</span>
                          <span style="font-size:13px;color:#888;"> doc${totalFaltante > 1 ? "s" : ""} faltando em </span>
                          <span style="font-size:18px;font-weight:700;color:#1a2b4a;">${totalLojas}</span>
                          <span style="font-size:13px;color:#888;"> loja${totalLojas > 1 ? "s" : ""}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- TABELA DE PENDÊNCIAS -->
              <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#1a2b4a;text-transform:uppercase;letter-spacing:0.6px;">
                Pendências identificadas
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e6ee;border-radius:8px;overflow:hidden;">
                <thead>
                  <tr style="background:#f3f6fb;">
                    <th style="padding:13px 18px;font-size:11px;font-weight:700;color:#555;text-align:left;text-transform:uppercase;letter-spacing:0.5px;">Loja / Unidade</th>
                    <th style="padding:13px 18px;font-size:11px;font-weight:700;color:#555;text-align:left;text-transform:uppercase;letter-spacing:0.5px;">Meses pendentes</th>
                    <th style="padding:13px 18px;font-size:11px;font-weight:700;color:#555;text-align:center;text-transform:uppercase;letter-spacing:0.5px;">Recebidos<br/><span style="font-size:10px;color:#999;text-transform:none;">${periodoLabel}</span></th>
                    <th style="padding:13px 18px;font-size:11px;font-weight:700;color:#555;text-align:center;text-transform:uppercase;letter-spacing:0.5px;">Faltantes</th>
                  </tr>
                </thead>
                <tbody>
                  ${detalhesHtml}
                </tbody>
              </table>

              <p style="margin:28px 0 24px;font-size:15px;color:#333;line-height:1.7;">
                Solicitamos a <strong>regularização imediata</strong> das pendências acima.
              </p>

              <!-- DOCUMENTOS OBRIGATÓRIOS - CARDS -->
              <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#1a2b4a;text-transform:uppercase;letter-spacing:0.6px;">
                Documentos obrigatórios por mês
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 -8px 28px -8px;">
                <tr>
                  ${docsCardsHtml}
                </tr>
              </table>

              <!-- PRAZO -->
              <p style="margin:0 0 24px;font-size:15px;color:#333;line-height:1.7;">
                Prazo para regularização: <strong style="color:#c0392b;">${prazoFormatado}</strong>.
              </p>

              ${
                portalUrl
                  ? `<!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <a href="${portalUrl}" target="_blank"
                       style="display:inline-block;background:#1a2b4a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:16px 48px;border-radius:8px;letter-spacing:0.3px;">
                      Enviar documentação
                    </a>
                  </td>
                </tr>
              </table>`
                  : ""
              }

              <!-- ALERTA DE PAGAMENTO - DESTAQUE -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#7f1d1d;border-radius:8px;padding:24px 28px;">
                    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#fca5a5;text-transform:uppercase;letter-spacing:0.6px;">
                      🚨 Impacto no Pagamento
                    </p>
                    <p style="margin:0;font-size:16px;font-weight:700;color:#ffffff;line-height:1.7;">
                      A ausência da documentação obrigatória poderá <u>suspender o processo de pagamento</u> deste fornecedor até que todos os documentos exigidos sejam enviados e validados.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:14px;color:#555;line-height:1.6;">
                Atenciosamente,<br/>
                <strong style="color:#1a2b4a;">Equipe de Manutenção</strong>
              </p>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#e4e8ed;padding:16px 40px;text-align:center;">
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
    `Identificamos pendências na documentação mensal obrigatória referente às lojas/unidades atendidas por este fornecedor.\n\n` +
    `Fornecedor: ${prestador_nome}\n` +
    `Ano de referência: ${ano_referencia}\n\n` +
    `Pendências identificadas:\n\n` +
    pendencias_por_loja
      .map(
        (p) =>
          `Loja/Unidade: ${p.loja_nome}\n` +
          `Meses pendentes: ${formatarMeses(p.meses_pendentes)}\n` +
          `Recebidos (${periodoLabel}): ${p.total_recebido}/${mes_limite}\n` +
          `Documentos faltantes: ${p.total_faltante}`,
      )
      .join("\n\n") +
    `\n\nDocumentos obrigatórios por mês:\n${docsTxt}\n\n` +
    `Prazo para regularização: ${prazoFormatado}.\n` +
    (portalUrl ? `Envie a documentação em: ${portalUrl}\n` : "") +
    `\nSolicitamos a regularização imediata das pendências acima.\n\n` +
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
    subject: `Pendência de Documentação Mensal Obrigatória (${ano_referencia})`,
    text,
    html,
    ...(attachments ? { attachments } : {}),
  });
}
