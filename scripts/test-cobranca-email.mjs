import sgMail from "@sendgrid/mail";
import fs from "fs";
import path from "path";

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const MESES_PT = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
const fmt = (m) => m.map((x) => MESES_PT[x - 1]).join(", ");
const DOCS = ["Registro de laudos", "Notas fiscais", "Retenção trabalhista"];
const MESES_NOMES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const ano = 2026;
const mesLimite = new Date().getMonth(); // jan=0 → 0, jun=5 → 5 meses decorridos (jan-mai)
const periodoLabel = `Jan–${MESES_NOMES[mesLimite - 1]}/${ano}`;

const pend = [
  { loja_nome: "Loja 01 - Manaus", meses_pendentes: [1, 3], total_esperado: 4, total_recebido: 2, total_faltante: 2 },
  { loja_nome: "Loja 05 - Manaus", meses_pendentes: [2],    total_esperado: 4, total_recebido: 3, total_faltante: 1 },
];
const prestador = "Fornecedor Teste Ltda";
const logo = fs.readFileSync(path.join(process.cwd(), "public", "logo-manutencao.png")).toString("base64");
const portalUrl = process.env.NEXT_PUBLIC_SITE_URL || "";

const prazo = new Date();
prazo.setDate(prazo.getDate() + 7);
const prazoFmt = prazo.toLocaleDateString("pt-BR", { timeZone: "America/Manaus", day: "2-digit", month: "2-digit", year: "numeric" });
const docsHtml = DOCS.map((d) => `<li style="margin-bottom:4px;">${d}</li>`).join("");
const totalFalt = pend.reduce((a, p) => a + p.total_faltante, 0);
const totalLojas = pend.length;

const rows = pend.map((p) => `<tr>
  <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;">${p.loja_nome}</td>
  <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#e67e22;">${fmt(p.meses_pendentes)}</td>
  <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:center;font-weight:700;"><span style="color:#27ae60;">${p.total_recebido}</span><span style="color:#aaa;">/</span><span style="color:#555;">${mesLimite}</span></td>
  <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:center;color:#c0392b;font-weight:700;">${p.total_faltante}</td>
</tr>`).join("");

const cta = portalUrl
  ? `<table width="100%" style="margin-bottom:24px;"><tr><td align="center"><a href="${portalUrl}" target="_blank" style="display:inline-block;background:#1a2b4a;color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:6px;">Enviar documentação</a></td></tr></table>`
  : "";

const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 16px;"><tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">
  <tr><td style="background:#1a2b4a;border-radius:8px 8px 0 0;padding:24px 32px;">
    <table width="100%"><tr><td><img src="cid:logo_manutencao" style="height:52px;display:block;"/></td>
    <td align="right" style="font-size:12px;color:#8fa3c0;vertical-align:bottom;">Ano de referência: <strong style="color:#fff;">${ano}</strong></td></tr></table>
  </td></tr>
  <tr><td style="background:#c0392b;padding:16px 32px;"><p style="margin:0;font-size:15px;font-weight:700;color:#fff;">⚠️ Pendência de Documentação Mensal Obrigatória</p></td></tr>
  <tr><td style="background:#fff;padding:32px;">
    <p style="margin:0 0 16px;font-size:15px;color:#333;">Prezados,</p>
    <p style="margin:0 0 24px;font-size:15px;color:#333;line-height:1.6;">Identificamos pendências na documentação mensal obrigatória referente às <strong>lojas/unidades</strong> atendidas por este fornecedor.</p>
    <table width="100%" style="margin-bottom:28px;"><tr><td style="background:#f8f9fa;border-radius:6px;padding:16px 20px;">
      <table width="100%"><tr><td style="font-size:13px;color:#666;">Fornecedor</td><td style="font-size:13px;color:#666;text-align:right;">Lojas com pendência</td></tr>
      <tr><td style="font-size:16px;font-weight:700;color:#1a2b4a;padding-top:4px;">${prestador}</td>
      <td style="font-size:16px;font-weight:700;color:#c0392b;text-align:right;padding-top:4px;">${totalLojas} lojas · ${totalFalt} docs faltando · período ${periodoLabel}</td></tr></table>
    </td></tr></table>
    <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1a2b4a;text-transform:uppercase;">Pendências identificadas</p>
    <table width="100%" style="border:1px solid #e8e8e8;border-radius:6px;overflow:hidden;">
      <thead><tr style="background:#f0f4f8;">
        <th style="padding:12px 16px;font-size:12px;font-weight:700;color:#555;text-align:left;">Loja / Unidade</th>
        <th style="padding:12px 16px;font-size:12px;font-weight:700;color:#555;text-align:left;">Meses pendentes</th>
        <th style="padding:12px 16px;font-size:12px;font-weight:700;color:#555;text-align:center;">Recebidos (${periodoLabel})</th>
        <th style="padding:12px 16px;font-size:12px;font-weight:700;color:#555;text-align:center;">Faltantes</th>
      </tr></thead><tbody>${rows}</tbody></table>
    <p style="margin:28px 0 16px;font-size:15px;color:#333;">Solicitamos a <strong>regularização imediata</strong> das pendências acima.</p>
    <table width="100%" style="margin-bottom:20px;"><tr><td style="background:#f0f4f8;border-radius:6px;padding:16px 20px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#1a2b4a;text-transform:uppercase;">Documentos obrigatórios por mês</p>
      <ul style="margin:0;padding-left:20px;font-size:14px;color:#444;line-height:1.5;">${docsHtml}</ul>
    </td></tr></table>
    <p style="margin:0 0 20px;font-size:15px;color:#333;">Prazo para regularização: <strong style="color:#c0392b;">${prazoFmt}</strong>.</p>
    ${cta}
    <table width="100%"><tr><td style="background:#fff8e1;border-left:4px solid #f39c12;border-radius:0 6px 6px 0;padding:14px 18px;">
      <p style="margin:0;font-size:14px;color:#7d5a00;line-height:1.6;"><strong>Atenção:</strong> A ausência da documentação obrigatória poderá impactar diretamente o <strong>processo de pagamento</strong> do fornecedor até que todos os documentos exigidos sejam enviados e validados.</p>
    </td></tr></table>
    <p style="margin:28px 0 0;font-size:14px;color:#555;">Atenciosamente,<br/><strong style="color:#1a2b4a;">Equipe de Manutenção</strong></p>
  </td></tr>
  <tr><td style="background:#e8ecf0;border-radius:0 0 8px 8px;padding:16px 32px;text-align:center;"><p style="margin:0;font-size:11px;color:#888;">Este é um e-mail automático. Por favor, não responda diretamente a esta mensagem.</p></td></tr>
</table></td></tr></table></body></html>`;

sgMail
  .send({
    from: process.env.FROM_EMAIL,
    to: process.env.FROM_EMAIL,
    subject: "[TESTE] Pendência de Documentação Mensal Obrigatória (2026)",
    text: "Teste layout final.",
    html,
    attachments: [{ content: logo, filename: "logo-manutencao.png", type: "image/png", disposition: "inline", content_id: "logo_manutencao" }],
  })
  .then(() => console.log("Enviado!"))
  .catch((e) => console.error("Erro:", JSON.stringify(e.response?.body ?? e.message)));
