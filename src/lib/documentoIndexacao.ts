import type { SupabaseClient } from "@supabase/supabase-js";
import { dividirEmChunks } from "@/lib/documentoChunking";
import { gerarEmbeddings } from "@/lib/embeddings";

export type OrigemConteudo = "ocr" | "pdf_texto" | "nao_aplicavel";

export type MetadadosIndexacao = {
  lojaId: string | null;
  tipo: string | null;
  competencia: string | null;
  equipamentoId: string | null;
  prestadorId: string | null;
  documentoCreatedAt: string | null;
};

export type IndexarConteudoParams = {
  documentoId: string;
  texto: string | null;
  origem: OrigemConteudo;
  paginas: number | null;
  arquivoHash: string | null;
  metadados: MetadadosIndexacao;
};

export type ResultadoIndexacao = {
  status: "indexado" | "pulado" | "erro";
  chunks: number;
  detalhe?: string;
};

/** pgvector aceita o vetor no formato textual "[1,2,3]". */
const paraVetorPg = (embedding: number[]) => JSON.stringify(embedding);

async function registrarErro(
  supabaseAdmin: SupabaseClient,
  documentoId: string,
  mensagem: string,
) {
  try {
    await supabaseAdmin
      .from("documento_conteudo")
      .update({ erro: mensagem, updated_at: new Date().toISOString() })
      .eq("documento_id", documentoId);
  } catch (err) {
    console.error("[indexarConteudoDocumento] Falha ao registrar erro:", err);
  }
}

/**
 * Persiste o texto do documento, divide em trechos e grava os embeddings.
 * Nunca lanca: a indexacao e aditiva e nao pode derrubar upload nem analise.
 */
export async function indexarConteudoDocumento(
  supabaseAdmin: SupabaseClient,
  params: IndexarConteudoParams,
): Promise<ResultadoIndexacao> {
  const agora = new Date().toISOString();
  const texto = params.texto?.trim() ?? "";

  try {
    if (!texto) {
      await supabaseAdmin.from("documento_conteudo").upsert({
        documento_id: params.documentoId,
        texto: "",
        origem: "nao_aplicavel",
        paginas: params.paginas,
        arquivo_hash: params.arquivoHash,
        caracteres: 0,
        indexado_em: null,
        erro: "Sem texto extraido para indexar.",
        updated_at: agora,
      });
      return { status: "pulado", chunks: 0, detalhe: "sem_texto" };
    }

    const { data: existente } = await supabaseAdmin
      .from("documento_conteudo")
      .select("arquivo_hash,indexado_em")
      .eq("documento_id", params.documentoId)
      .maybeSingle();

    const jaIndexado = Boolean(
      existente?.indexado_em &&
        params.arquivoHash &&
        existente?.arquivo_hash === params.arquivoHash,
    );
    if (jaIndexado) {
      return { status: "pulado", chunks: 0, detalhe: "hash_igual" };
    }

    await supabaseAdmin.from("documento_conteudo").upsert({
      documento_id: params.documentoId,
      texto,
      origem: params.origem,
      paginas: params.paginas,
      arquivo_hash: params.arquivoHash,
      caracteres: texto.length,
      indexado_em: null,
      erro: null,
      updated_at: agora,
    });

    const chunks = dividirEmChunks(texto);
    if (chunks.length === 0) {
      await registrarErro(
        supabaseAdmin,
        params.documentoId,
        "Texto extraido nao gerou nenhum trecho indexavel.",
      );
      return { status: "pulado", chunks: 0, detalhe: "sem_chunks" };
    }

    const embeddings = await gerarEmbeddings(chunks.map((chunk) => chunk.texto));

    await supabaseAdmin
      .from("documento_chunks")
      .delete()
      .eq("documento_id", params.documentoId);

    await supabaseAdmin.from("documento_chunks").insert(
      chunks.map((chunk, indice) => ({
        documento_id: params.documentoId,
        ordem: chunk.ordem,
        pagina: chunk.pagina,
        texto: chunk.texto,
        embedding: paraVetorPg(embeddings[indice] ?? []),
        loja_id: params.metadados.lojaId,
        tipo: params.metadados.tipo,
        competencia: params.metadados.competencia,
        equipamento_id: params.metadados.equipamentoId,
        prestador_id: params.metadados.prestadorId,
        documento_created_at: params.metadados.documentoCreatedAt,
      })),
    );

    await supabaseAdmin
      .from("documento_conteudo")
      .update({ indexado_em: new Date().toISOString(), erro: null })
      .eq("documento_id", params.documentoId);

    return { status: "indexado", chunks: chunks.length };
  } catch (err) {
    const mensagem =
      err instanceof Error ? err.message : "Falha desconhecida na indexacao.";
    console.error("[indexarConteudoDocumento] Falha:", err);
    await registrarErro(supabaseAdmin, params.documentoId, mensagem);
    return { status: "erro", chunks: 0, detalhe: mensagem };
  }
}
