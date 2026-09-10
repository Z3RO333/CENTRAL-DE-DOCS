import { callAzureOpenAiChat } from "@/lib/azureOpenAi";

export type ConsultaInterpretada = {
  consultaSemantica: string;
  tipo?: string;
  assunto?: string;
  lojaTermo?: string;
  equipamentoTermo?: string;
  ano?: string;
  mes?: string;
  ordenar: "relevancia" | "mais_recente";
  limite?: number;
};

function promptSistema(termosDisponiveis: string[]): string {
  return `Você é um extrator de filtros para busca de documentos de manutenção predial.

Analise a pergunta e extraia em JSON (sem markdown):
{
  "consultaSemantica": "<texto para busca semântica — capture a intenção completa>",
  "tipo": "<APENAS se tiver certeza: registro_laudos | notas_fiscais | ordens_servico — omitir se incerto>",
  "assunto": "<APENAS se for exatamente um destes termos: ${termosDisponiveis.join(" | ")} — omitir se nao tiver certeza>",
  "lojaTermo": "<nome ou apelido da loja se mencionado — omitir se incerto>",
  "equipamentoTermo": "<identificacao do equipamento se mencionado — omitir se incerto>",
  "ano": "<4 digitos — omitir se nao explicitado>",
  "mes": "<2 digitos 01-12 — omitir se nao explicitado>",
  "ordenar": "relevancia" | "mais_recente",
  "limite": "<numero de documentos solicitado; 1 para o mais recente ou o último; omitir sem quantidade>"
}

Regra critica: nao invente filtros. Um filtro errado zera os resultados.
Se nao tiver certeza, omita o campo e inclua o conceito em consultaSemantica.
Use "mais_recente" quando houver pedido explícito de recência, inclusive no singular ("qual o documento mais recente sobre gerador?"). Nesse caso singular, use limite 1. Não deduza recência apenas de um filtro de mês.
Responda SOMENTE o JSON.`;
}

export async function interpretarConsulta(
  pergunta: string,
  termosDisponiveis: string[],
): Promise<ConsultaInterpretada> {
  const singularRecente = /\bmais recente\b(?!s)|\bultim[oa]\b/.test(
    pergunta.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(),
  );
  const fallback: ConsultaInterpretada = {
    consultaSemantica: pergunta,
    ordenar: singularRecente ? "mais_recente" : "relevancia",
    ...(singularRecente ? { limite: 1 } : {}),
  };
  let resposta = "";
  try {
    const result = await callAzureOpenAiChat({
      messages: [
        { role: "system", content: promptSistema(termosDisponiveis) },
        { role: "user", content: pergunta },
      ],
      maxTokens: 500,
    });
    resposta = result.content ?? "";
  } catch {
    return fallback;
  }

  let parsed: Partial<ConsultaInterpretada> = {};
  try {
    parsed = JSON.parse(resposta) as Partial<ConsultaInterpretada>;
  } catch {
    parsed = {};
  }

  return {
    consultaSemantica: parsed.consultaSemantica?.trim() || pergunta,
    tipo: parsed.tipo,
    assunto: parsed.assunto,
    lojaTermo: parsed.lojaTermo,
    equipamentoTermo: parsed.equipamentoTermo,
    ano: parsed.ano,
    mes: parsed.mes,
    ordenar: singularRecente || parsed.ordenar === "mais_recente" ? "mais_recente" : "relevancia",
    limite: typeof parsed.limite === "number" && Number.isInteger(parsed.limite) && parsed.limite > 0
      ? Math.min(parsed.limite, 20)
      : fallback.limite,
  };
}
