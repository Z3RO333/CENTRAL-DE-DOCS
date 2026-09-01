import type { AzureOpenAiTool } from "@/lib/azureOpenAi";
import {
  anoManaus,
  levantarPendencias,
  mascararEmail,
  type PendenciaCobranca,
} from "@/lib/cobrancasService";
import { isAprovadorInterno } from "@/lib/orcamentosInternos";
import type {
  AssistenteContext,
  AssistenteDominio,
  AssistenteInsightItem,
  AssistenteInsights,
  AssistenteResultItem,
  AssistenteSearchOutcome,
  AssistenteToolResult,
} from "@/lib/assistenteTypes";

const COBRANCAS_RESULT_LIMIT = 10;

const TOOLS: AzureOpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "consultar_pendencias_cobranca",
      description:
        "Consulta as pendencias de cobranca de documentacao por fornecedor e loja em um ano de referencia. So consulta e explica — nunca dispara cobranca.",
      parameters: {
        type: "object",
        properties: {
          ano: { type: "string", description: "Ano de referencia no formato AAAA (padrao: ano corrente)" },
        },
        required: [],
      },
    },
  },
];

async function podeAcessarCobrancas(ctx: AssistenteContext): Promise<boolean> {
  const cacheKey = "cobrancas:acesso";
  if (ctx.cache.has(cacheKey)) {
    return ctx.cache.get(cacheKey) as boolean;
  }
  const acesso = ctx.isAdmin || (await isAprovadorInterno(ctx.email, ctx.supabaseAdmin));
  ctx.cache.set(cacheKey, acesso);
  return acesso;
}

type GrupoPonderado = { label: string; total: number; emailsMascarados: string[] };

function agruparPorPrestador(rows: PendenciaCobranca[]): Map<string, GrupoPonderado> {
  const grupos = new Map<string, GrupoPonderado>();
  for (const row of rows) {
    const atual = grupos.get(row.prestador_id);
    if (atual) {
      atual.total += row.total_faltante;
      continue;
    }
    grupos.set(row.prestador_id, {
      label: row.prestador_nome,
      total: row.total_faltante,
      emailsMascarados: row.prestador_emails.map(mascararEmail),
    });
  }
  return grupos;
}

function agruparPorLoja(rows: PendenciaCobranca[]): Map<string, GrupoPonderado> {
  const grupos = new Map<string, GrupoPonderado>();
  for (const row of rows) {
    const atual = grupos.get(row.loja_id);
    if (atual) {
      atual.total += row.total_faltante;
      continue;
    }
    grupos.set(row.loja_id, { label: row.loja_nome, total: row.total_faltante, emailsMascarados: [] });
  }
  return grupos;
}

function buildWeightedInsight(
  grupos: Map<string, GrupoPonderado>,
  totalBase: number,
  limit = 5,
): AssistenteInsightItem[] {
  return Array.from(grupos.entries())
    .map(([key, grupo]) => ({
      key,
      label: grupo.label,
      total: grupo.total,
      percentual: totalBase > 0 ? Number(((grupo.total / totalBase) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function buildResultados(porPrestador: Map<string, GrupoPonderado>, rows: PendenciaCobranca[]): AssistenteResultItem[] {
  const lojasPorPrestador = new Map<string, number>();
  for (const row of rows) {
    lojasPorPrestador.set(row.prestador_id, (lojasPorPrestador.get(row.prestador_id) ?? 0) + 1);
  }
  return Array.from(porPrestador.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, COBRANCAS_RESULT_LIMIT)
    .map(([id, grupo]) => ({
      id,
      titulo: grupo.label,
      subtitulo: `${lojasPorPrestador.get(id) ?? 0} pendência(s) / ${grupo.total} faltante(s)`,
      url: "/documentos/cobrancas",
    }));
}

function buildObservacoes(input: {
  ano: number;
  totalPrestadores: number;
  totalFaltanteGeral: number;
}): string[] {
  if (input.totalFaltanteGeral === 0) {
    return [`Nenhuma pendência de cobrança encontrada para ${input.ano}.`];
  }
  return [
    `${input.totalPrestadores} fornecedor(es) com pendências em ${input.ano}, totalizando ${input.totalFaltanteGeral} documento(s) faltante(s).`,
  ];
}

async function executarConsultarPendencias(
  args: Record<string, unknown>,
  ctx: AssistenteContext,
): Promise<AssistenteToolResult> {
  const anoNum = typeof args.ano === "string" ? Number(args.ano) : undefined;
  const ano = anoNum !== undefined && Number.isFinite(anoNum) ? anoNum : undefined;
  const anoRef = ano ?? anoManaus();

  const rows = await levantarPendencias(ano, ctx.supabaseAdmin);

  const totalFaltanteGeral = rows.reduce((acc, r) => acc + r.total_faltante, 0);
  const totalPrestadores = new Set(rows.map((r) => r.prestador_id)).size;
  const porPrestador = agruparPorPrestador(rows);
  const porLoja = agruparPorLoja(rows);

  // `porStatus` é reaproveitado aqui para carregar a distribuição "por prestador":
  // cobranças não tem conceito de status, e o widget renderiza esse campo de forma
  // genérica (label + total), sem assumir que o nome do campo é literal.
  const insights: AssistenteInsights = {
    totais: [
      { key: "totalFornecedores", label: "Fornecedores", valor: totalPrestadores },
      { key: "totalLojasPendentes", label: "Lojas pendentes", valor: rows.length },
      { key: "totalFaltante", label: "Documentos faltantes", valor: totalFaltanteGeral },
    ],
    isTruncated: false,
    porStatus: buildWeightedInsight(porPrestador, totalFaltanteGeral, 5),
    porLoja: buildWeightedInsight(porLoja, totalFaltanteGeral, 5),
    tendenciaMensal: [],
    observacoes: buildObservacoes({ ano: anoRef, totalPrestadores, totalFaltanteGeral }),
  };

  const outcome: AssistenteSearchOutcome = {
    dominio: "cobrancas",
    filters: { ano: anoRef },
    filtrosUrl: "/documentos/cobrancas",
    summary: `Critérios usados: ano ${anoRef}.`,
    results: buildResultados(porPrestador, rows),
    total: rows.length,
    insights,
  };

  const resumoParaModelo = {
    ano: anoRef,
    totalFornecedores: totalPrestadores,
    totalLojasPendentes: rows.length,
    totalDocumentosFaltantes: totalFaltanteGeral,
    amostra: Array.from(porPrestador.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5)
      .map(([id, grupo]) => ({
        prestador_id: id,
        prestador_nome: grupo.label,
        total_faltante: grupo.total,
        emails_contato: grupo.emailsMascarados,
      })),
  };

  return { content: JSON.stringify(resumoParaModelo), outcome };
}

export const dominioCobrancas: AssistenteDominio = {
  id: "cobrancas",
  tools: TOOLS,
  podeAcessar: podeAcessarCobrancas,
  descricaoPrompt: () =>
    [
      "Para o domínio de cobranças, você tem a ferramenta consultar_pendencias_cobranca, que mostra pendências de documentação por fornecedor e loja em um ano de referência (padrão: ano corrente).",
      "Você NUNCA dispara cobrança nem envia e-mail — só consulta e explica o que já foi levantado. Se o usuário pedir para 'cobrar' ou 'notificar' um fornecedor, explique que essa ação deve ser feita pela tela de Cobranças.",
      "Nunca exponha e-mails completos de fornecedores — eles já vêm mascarados nos dados que a ferramenta devolve.",
    ].join(" "),
  executarTool: async (nome, args, ctx) => {
    if (nome === "consultar_pendencias_cobranca") {
      return executarConsultarPendencias(args, ctx);
    }
    return { content: JSON.stringify({ erro: `Ferramenta desconhecida: ${nome}` }) };
  },
};
