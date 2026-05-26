import sgMail from "@sendgrid/mail";

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

  const detalhesHtml = pendencias_por_loja
    .map(
      (p) => `
    <tr>
      <td style="padding:8px 12px;border:1px solid #e0e0e0;">${p.loja_nome}</td>
      <td style="padding:8px 12px;border:1px solid #e0e0e0;">${formatarMeses(p.meses_pendentes)}</td>
      <td style="padding:8px 12px;border:1px solid #e0e0e0;text-align:center;">12</td>
      <td style="padding:8px 12px;border:1px solid #e0e0e0;text-align:center;">${p.total_recebido}</td>
      <td style="padding:8px 12px;border:1px solid #e0e0e0;text-align:center;color:#c0392b;font-weight:bold;">${p.total_faltante}</td>
    </tr>`,
    )
    .join("");

  const detalhesTxt = pendencias_por_loja
    .map(
      (p) =>
        `Loja/Unidade: ${p.loja_nome}\n` +
        `Meses pendentes: ${formatarMeses(p.meses_pendentes)}\n` +
        `Documentos esperados: 12\n` +
        `Documentos recebidos: ${p.total_recebido}\n` +
        `Documentos faltantes: ${p.total_faltante}`,
    )
    .join("\n\n");

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;color:#333;max-width:700px;margin:0 auto;padding:24px;">
  <p>Prezados,</p>
  <p>
    Identificamos pendências na documentação mensal obrigatória referente aos
    geradores das lojas/unidades atendidas por este fornecedor.
  </p>
  <p>Segue abaixo o detalhamento:</p>
  <p>
    <strong>Fornecedor:</strong> ${prestador_nome}<br/>
    <strong>Ano de referência:</strong> ${ano_referencia}
  </p>
  <h3 style="margin-top:24px;">Pendências identificadas:</h3>
  <table style="border-collapse:collapse;width:100%;font-size:14px;">
    <thead>
      <tr style="background:#f5f5f5;">
        <th style="padding:8px 12px;border:1px solid #e0e0e0;text-align:left;">Loja/Unidade</th>
        <th style="padding:8px 12px;border:1px solid #e0e0e0;text-align:left;">Meses pendentes</th>
        <th style="padding:8px 12px;border:1px solid #e0e0e0;">Esperados</th>
        <th style="padding:8px 12px;border:1px solid #e0e0e0;">Recebidos</th>
        <th style="padding:8px 12px;border:1px solid #e0e0e0;">Faltantes</th>
      </tr>
    </thead>
    <tbody>
      ${detalhesHtml}
    </tbody>
  </table>
  <p style="margin-top:24px;">
    Solicitamos a regularização dessas pendências com urgência.
  </p>
  <p style="background:#fff3cd;border-left:4px solid #f0a500;padding:12px 16px;border-radius:4px;">
    <strong>Atenção:</strong> A ausência da documentação obrigatória poderá impactar
    diretamente o processo de pagamento do fornecedor até que todos os documentos
    exigidos sejam enviados e validados.
  </p>
  <p>Atenciosamente,<br/><strong>Equipe de Manutenção</strong></p>
</body>
</html>`;

  const text =
    `Prezados,\n\n` +
    `Identificamos pendências na documentação mensal obrigatória referente aos geradores das lojas/unidades atendidas por este fornecedor.\n\n` +
    `Fornecedor: ${prestador_nome}\n` +
    `Ano de referência: ${ano_referencia}\n\n` +
    `Pendências identificadas:\n\n` +
    `${detalhesTxt}\n\n` +
    `Solicitamos a regularização dessas pendências com urgência.\n\n` +
    `Ressaltamos que a ausência da documentação obrigatória poderá impactar diretamente o processo de pagamento do fornecedor até que todos os documentos exigidos sejam enviados e validados.\n\n` +
    `Atenciosamente,\nEquipe de Manutenção`;

  await sgMail.send({
    from: fromEmail,
    to: destinatarios,
    cc: fromEmail,   // cópia para a caixa remetente confirmar o envio
    subject: `Pendência de Documentação Mensal — Geradores (${ano_referencia})`,
    text,
    html,
  });
}
