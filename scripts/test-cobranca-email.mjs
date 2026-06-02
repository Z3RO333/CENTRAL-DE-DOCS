import sgMail from "@sendgrid/mail";
import fs from "fs";
import path from "path";

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const MESES_PT = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
const fmt = (m) => m.map((x) => MESES_PT[x - 1]).join(", ");
const DOCS_CARDS = [
  { titulo: "Retenção Trabalhista", icone: "📋", descricao: "FGTS · INSS · FOPAG · SINETRAM · Vale-transporte · PERDCOMP" },
  { titulo: "Registro de Laudos",   icone: "🔧", descricao: "Laudos técnicos e registros de manutenção das unidades" },
];
const MESES_NOMES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const ano = 2026;
const mesLimite = new Date().getMonth(); // jan=0 → 0, jun=5 → 5 meses decorridos (jan-mai)
const periodoLabel = `Jan–${MESES_NOMES[mesLimite - 1]}/${ano}`;

const pend = [
  {
    loja_nome: "Loja 01 - Manaus",
    meses_pendentes: [1, 3],
    meses_pendentes_laudos: [1, 3],
    meses_pendentes_retencao: [3],
    total_esperado: 5, total_recebido: 2, total_faltante: 3,
  },
  {
    loja_nome: "Loja 05 - Manaus",
    meses_pendentes: [2],
    meses_pendentes_laudos: [],
    meses_pendentes_retencao: [2],
    total_esperado: 4, total_recebido: 3, total_faltante: 1,
  },
  {
    loja_nome: "CD Tarumã",
    meses_pendentes: [1, 2],
    meses_pendentes_laudos: [1, 2],
    meses_pendentes_retencao: [],
    total_esperado: 4, total_recebido: 2, total_faltante: 2,
  },
];
const prestador = "Fornecedor Teste Ltda";
const logo = fs.readFileSync(path.join(process.cwd(), "public", "logo-manutencao.png")).toString("base64");
const portalUrl = process.env.NEXT_PUBLIC_SITE_URL || "";

const prazo = new Date();
prazo.setDate(prazo.getDate() + 7);
const prazoFmt = prazo.toLocaleDateString("pt-BR", { timeZone: "America/Manaus", day: "2-digit", month: "2-digit", year: "numeric" });
const totalFalt = pend.reduce((a, p) => a + p.total_faltante, 0);
const totalLojas = pend.length;

const rows = pend.map((p) => {
  const temTipos = p.meses_pendentes_laudos.length > 0 || p.meses_pendentes_retencao.length > 0;
  let pendenciaCell = "";
  if (temTipos) {
    const linhas = [];
    if (p.meses_pendentes_laudos.length > 0)
      linhas.push(`<span style="display:block;margin-bottom:4px;">🔧 <strong>Laudos:</strong> ${fmt(p.meses_pendentes_laudos)}</span>`);
    if (p.meses_pendentes_retencao.length > 0)
      linhas.push(`<span style="display:block;">📋 <strong>Retenção:</strong> ${fmt(p.meses_pendentes_retencao)}</span>`);
    pendenciaCell = linhas.join("");
  } else {
    pendenciaCell = fmt(p.meses_pendentes);
  }
  return `<tr>
  <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;font-weight:600;">${p.loja_nome}</td>
  <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#e67e22;">${pendenciaCell}</td>
  <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:center;font-weight:700;"><span style="color:#27ae60;">${p.total_recebido}</span><span style="color:#aaa;">/</span><span style="color:#555;">${p.total_esperado}</span></td>
  <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:center;color:#c0392b;font-weight:700;">${p.total_faltante}</td>
</tr>`;
}).join("");

const cta = portalUrl
  ? `<table width="100%" style="margin-bottom:28px;"><tr><td align="center"><a href="${portalUrl}" target="_blank" style="display:inline-block;background:#1a2b4a;color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:16px 48px;border-radius:8px;letter-spacing:0.3px;">Enviar documentação</a></td></tr></table>`
  : "";

const docsCardsHtml = DOCS_CARDS.map(d => `
  <td width="50%" style="padding:0 8px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="background:#f3f6fb;border-left:4px solid #1a2b4a;border-radius:0 8px 8px 0;padding:16px 18px;">
        <p style="margin:0 0 4px;font-size:18px;">${d.icone}</p>
        <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1a2b4a;">${d.titulo}</p>
        <p style="margin:0;font-size:12px;color:#666;line-height:1.5;">${d.descricao}</p>
      </td>
    </tr></table>
  </td>`).join("");

const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td>
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="background:#1a2b4a;padding:28px 40px;">
    <table width="100%"><tr><td><img src="cid:logo_manutencao" style="height:52px;display:block;"/></td>
    <td align="right" style="font-size:12px;color:#8fa3c0;vertical-align:bottom;">Período: <strong style="color:#fff;">${periodoLabel}</strong></td></tr></table>
  </td></tr>
  <tr><td style="background:#c0392b;padding:18px 40px;"><p style="margin:0;font-size:16px;font-weight:700;color:#fff;">⚠️ Pendência de Documentação Mensal Obrigatória</p></td></tr>
  <tr><td style="background:#fff;padding:36px 40px;">
    <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.7;">Prezados,</p>
    <p style="margin:0 0 28px;font-size:15px;color:#333;line-height:1.7;">Identificamos pendências na documentação mensal obrigatória referente às <strong>lojas/unidades</strong> atendidas por este fornecedor.</p>
    <table width="100%" style="margin-bottom:32px;"><tr><td style="background:#f3f6fb;border-radius:8px;padding:20px 24px;">
      <table width="100%">
        <tr><td style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">Fornecedor</td><td style="font-size:12px;color:#888;text-align:right;text-transform:uppercase;letter-spacing:0.5px;">Resumo</td></tr>
        <tr><td style="font-size:20px;font-weight:700;color:#1a2b4a;padding-top:6px;">${prestador}</td>
        <td style="text-align:right;padding-top:6px;"><span style="font-size:18px;font-weight:700;color:#c0392b;">${totalFalt}</span><span style="font-size:13px;color:#888;"> docs faltando em </span><span style="font-size:18px;font-weight:700;color:#1a2b4a;">${totalLojas}</span><span style="font-size:13px;color:#888;"> lojas</span></td></tr>
      </table>
    </td></tr></table>
    <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#1a2b4a;text-transform:uppercase;letter-spacing:0.6px;">Pendências identificadas</p>
    <table width="100%" style="border:1px solid #e0e6ee;border-radius:8px;overflow:hidden;">
      <thead><tr style="background:#f3f6fb;">
        <th style="padding:13px 18px;font-size:11px;font-weight:700;color:#555;text-align:left;text-transform:uppercase;letter-spacing:0.5px;">Loja / Unidade</th>
        <th style="padding:13px 18px;font-size:11px;font-weight:700;color:#555;text-align:left;text-transform:uppercase;letter-spacing:0.5px;">Meses pendentes</th>
        <th style="padding:13px 18px;font-size:11px;font-weight:700;color:#555;text-align:center;text-transform:uppercase;letter-spacing:0.5px;">Recebidos<br/><span style="font-size:10px;color:#999;text-transform:none;">${periodoLabel}</span></th>
        <th style="padding:13px 18px;font-size:11px;font-weight:700;color:#555;text-align:center;text-transform:uppercase;letter-spacing:0.5px;">Faltantes</th>
      </tr></thead><tbody>${rows}</tbody></table>
    <p style="margin:28px 0 24px;font-size:15px;color:#333;line-height:1.7;">Solicitamos a <strong>regularização imediata</strong> das pendências acima.</p>
    <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#1a2b4a;text-transform:uppercase;letter-spacing:0.6px;">Documentos obrigatórios por mês</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 -8px 28px -8px;"><tr>${docsCardsHtml}</tr></table>
    <p style="margin:0 0 24px;font-size:15px;color:#333;line-height:1.7;">Prazo para regularização: <strong style="color:#c0392b;">${prazoFmt}</strong>.</p>
    ${cta}
    <table width="100%" style="margin-bottom:28px;"><tr>
      <td style="background:#7f1d1d;border-radius:8px;padding:24px 28px;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#fca5a5;text-transform:uppercase;letter-spacing:0.6px;">🚨 Impacto no Pagamento</p>
        <p style="margin:0;font-size:16px;font-weight:700;color:#ffffff;line-height:1.7;">A ausência da documentação obrigatória poderá <u>suspender o processo de pagamento</u> deste fornecedor até que todos os documentos exigidos sejam enviados e validados.</p>
      </td>
    </tr></table>
    <p style="margin:0;font-size:14px;color:#555;line-height:1.6;">Atenciosamente,<br/><strong style="color:#1a2b4a;">Equipe de Manutenção</strong></p>
  </td></tr>
  <tr><td style="background:#e4e8ed;padding:16px 40px;text-align:center;"><p style="margin:0;font-size:11px;color:#888;">Este é um e-mail automático. Por favor, não responda diretamente a esta mensagem.</p></td></tr>
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
