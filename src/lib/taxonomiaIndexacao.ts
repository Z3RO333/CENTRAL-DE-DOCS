import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classificarTexto,
  construirIndiceTaxonomia,
  normalizarTermo,
  type TaxonomiaIndice,
} from "@/lib/taxonomiaClassificacao";

export async function carregarIndiceTaxonomia(
  supabaseAdmin: SupabaseClient,
): Promise<TaxonomiaIndice> {
  const { data: termos, error: erroTermos } = await supabaseAdmin
    .from("taxonomia_termos")
    .select("id,termo")
    .eq("ativo", true);
  if (erroTermos) {
    throw erroTermos;
  }

  const { data: sinonimos, error: erroSinonimos } = await supabaseAdmin
    .from("taxonomia_sinonimos")
    .select("termo_id,variacao");
  if (erroSinonimos) {
    throw erroSinonimos;
  }

  return construirIndiceTaxonomia(
    (termos ?? []) as { id: string; termo: string }[],
    (sinonimos ?? []) as { termo_id: string; variacao: string }[],
  );
}

async function registrarSugestaoSeNaoReconhecido(
  supabaseAdmin: SupabaseClient,
  params: {
    equipamentoTipo: string | null;
    documentoId: string;
    trecho: string | null;
    indice: TaxonomiaIndice;
  },
): Promise<void> {
  const bruto = params.equipamentoTipo?.trim();
  if (!bruto) {
    return;
  }
  const normalizado = normalizarTermo(bruto);
  if (!normalizado || params.indice.has(normalizado)) {
    return;
  }

  const { data: existente, error: erroBusca } = await supabaseAdmin
    .from("taxonomia_sugestoes")
    .select("id,ocorrencias,status")
    .eq("variacao", normalizado)
    .maybeSingle();
  if (erroBusca) {
    throw erroBusca;
  }

  if (existente) {
    if (existente.status !== "pendente") {
      return;
    }
    const { error: erroUpdate } = await supabaseAdmin
      .from("taxonomia_sugestoes")
      .update({ ocorrencias: existente.ocorrencias + 1 })
      .eq("id", existente.id);
    if (erroUpdate) {
      throw erroUpdate;
    }
    return;
  }

  const { error: erroInsert } = await supabaseAdmin.from("taxonomia_sugestoes").insert({
    variacao: normalizado,
    termo_sugerido: bruto,
    documento_id: params.documentoId,
    trecho: params.trecho,
    ocorrencias: 1,
  });
  if (erroInsert) {
    throw erroInsert;
  }
}

export type ClassificarDocumentoParams = {
  documentoId: string;
  texto: string | null;
  equipamentoTipo: string | null;
  equipamentoIdentificacao: string | null;
};

export type ResultadoClassificacao = {
  status: "classificado" | "pulado" | "erro";
  termos: string[];
  detalhe?: string;
};

/**
 * Classifica o texto do documento contra a taxonomia e grava documento_conteudo.termos.
 * Quando equipamentoTipo nao bate com nenhum termo conhecido, registra uma sugestao
 * (best-effort: falha ao registrar sugestao nao invalida a classificacao ja gravada).
 * Nunca lanca para o chamador.
 */
export async function classificarDocumento(
  supabaseAdmin: SupabaseClient,
  params: ClassificarDocumentoParams,
): Promise<ResultadoClassificacao> {
  const texto = params.texto?.trim() ?? "";
  if (!texto) {
    // Best-effort: advance the cursor so this document is not retried on every reclassification pass.
    const { error: errMarca } = await supabaseAdmin
      .from("documento_conteudo")
      .update({
        termos: [],
        termos_classificado_em: new Date().toISOString(),
      })
      .eq("documento_id", params.documentoId);
    if (errMarca) {
      console.error("[classificarDocumento] Falha ao marcar sem_texto:", errMarca);
    }
    return { status: "pulado", termos: [], detalhe: "sem_texto" };
  }

  try {
    const indice = await carregarIndiceTaxonomia(supabaseAdmin);
    const termos = classificarTexto(texto, indice);

    const { error: erroUpdate } = await supabaseAdmin
      .from("documento_conteudo")
      .update({ termos, termos_classificado_em: new Date().toISOString() })
      .eq("documento_id", params.documentoId);
    if (erroUpdate) {
      throw erroUpdate;
    }

    try {
      await registrarSugestaoSeNaoReconhecido(supabaseAdmin, {
        equipamentoTipo: params.equipamentoTipo,
        documentoId: params.documentoId,
        trecho: params.equipamentoIdentificacao,
        indice,
      });
    } catch (err) {
      // Best-effort: a classificacao (mais importante e ja gravada) nao pode
      // ser invalidada por uma falha ao registrar a sugestao.
      console.error("[classificarDocumento] Falha ao registrar sugestao:", err);
    }

    return { status: "classificado", termos };
  } catch (err) {
    const mensagem =
      err instanceof Error ? err.message : "Falha desconhecida na classificacao.";
    console.error("[classificarDocumento] Falha:", err);
    return { status: "erro", termos: [], detalhe: mensagem };
  }
}
