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
  "ordenar": "relevancia" | "mais_recente"
}

Regra critica: nao invente filtros. Um filtro errado zera os resultados.
Se nao tiver certeza, omita o campo e inclua o conceito em consultaSemantica.
Use "mais_recente" apenas para perguntas de listagem ("liste os últimos", "mostre todos de março").
Responda SOMENTE o JSON.`;
}

export async function interpretarConsulta(
  pergunta: string,
  termosDisponiveis: string[],
): Promise<ConsultaInterpretada> {
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
    return { consultaSemantica: pergunta, ordenar: "relevancia" };
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
    ordenar: parsed.ordenar === "mais_recente" ? "mais_recente" : "relevancia",
  };
}
