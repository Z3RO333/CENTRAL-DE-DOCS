import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDocumentosAccessOr } from "@/lib/documentosAccessFilters";
import { gerarEmbeddings } from "@/lib/embeddings";
import { callAzureOpenAiChat } from "@/lib/azureOpenAi";
import type { ConsultaInterpretada } from "@/lib/documentosInterpretacao";
import type { GerenteAccessRow } from "@/lib/apiAuth";

export const RECORTE_MAX_DOCUMENTOS = 2000;

export type DocumentoBuscado = {
  documentoId: string;
  rrfScore: number;
  trecho: string;
  pagina?: number | null;
  nTrechosRelevantes: number;
  justificativa?: string;
};

export type ResultadoBuscaConteudo = {
  documentos: DocumentoBuscado[];
  confianca: "alta" | "media" | "baixa";
  sugestaoRefinamento?: string;
  recorteExcedido: boolean;
  filtrosAplicados: Record<string, string>;
};

export type BuscaConteudoParams = {
  consulta: ConsultaInterpretada;
  lojaId?: string;
  equipamentoId?: string;
  userId: string;
  allowedPrestadores: string[];
  gerenteEntries: GerenteAccessRow[];
  canAccess: boolean;
  filterPrestadores: string[];
  filterLojas: string[];
};

async function construirAllowlist(
  params: BuscaConteudoParams,
  supabaseAdmin: SupabaseClient,
): Promise<{ ids: string[]; excedido: boolean }> {
  const {
    consulta,
    lojaId,
    equipamentoId,
    userId,
    allowedPrestadores,
    gerenteEntries,
    canAccess,
    filterPrestadores,
    filterLojas,
  } = params;

  const accessFilters = buildDocumentosAccessOr({
    canAccess,
    allowedPrestadores,
    gerenteEntries,
    userId,
    filterPrestadores,
    filterLojas,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // The Supabase query builder's chained methods lose their precise return types
  // when conditionally applied (e.g. .or(), .filter(), .eq() all return different
  // generic instantiations), forcing `any` here so the chain remains composable.
  let query: any = supabaseAdmin
    .from("formularios")
    .select("id")
    .limit(RECORTE_MAX_DOCUMENTOS + 1);

  if (accessFilters.length > 0) {
    query = query.or(accessFilters.join(","));
  }
  if (consulta.tipo) query = query.eq("tipo", consulta.tipo);
  if (lojaId) query = query.filter("dados->>loja_id", "eq", lojaId);
  if (equipamentoId) query = query.eq("equipamento_id", equipamentoId);
  if (consulta.ano && consulta.mes) {
    query = query.filter(
      "dados->>competencia",
      "ilike",
      `${consulta.mes}/${consulta.ano}%`,
    );
  } else if (consulta.ano) {
    query = query.filter(
      "dados->>competencia",
      "ilike",
      `%/${consulta.ano}`,
    );
  }

  // Ruling 2: when ordering by most recent, apply in Stage 1 so IDs arrive in
  // creation order and the RPC preserves that intent.
  if (consulta.ordenar === "mais_recente") {
    query = query.order("created_at", { ascending: false });
  }

  const { data, error } = (await query) as {
    data: { id: string }[] | null;
    error: Error | null;
  };
  if (error) throw error;

  const excedido = (data?.length ?? 0) > RECORTE_MAX_DOCUMENTOS;
  const ids = (data ?? []).slice(0, RECORTE_MAX_DOCUMENTOS).map((d) => d.id);
  return { ids, excedido };
}

async function rerankear(
  documentos: Omit<DocumentoBuscado, "justificativa">[],
  pergunta: string,
): Promise<DocumentoBuscado[]> {
  if (documentos.length === 0) return [];

  const top20 = documentos.slice(0, 20);
  const lista = top20
    .map((d, i) => `${i + 1}. [${d.documentoId}] ${d.trecho.slice(0, 300)}`)
    .join("\n");

  const promptRerank = `Pergunta: "${pergunta}"

Trechos recuperados (cada um com ID do documento):
${lista}

Ordene por relevância à pergunta. Retorne JSON (sem markdown):
[{"documentoId":"<id>","justificativa":"<1 frase curta>"}]
Inclua apenas trechos genuinamente úteis. Responda SOMENTE o JSON.`;

  let ordenados: { documentoId: string; justificativa: string }[] = [];
  try {
    const resposta = await callAzureOpenAiChat({
      messages: [{ role: "user" as const, content: promptRerank }],
      maxTokens: 1000,
    });
    const rawContent = resposta.content ?? "";
    const parsed = JSON.parse(rawContent) as unknown;
    if (Array.isArray(parsed)) {
      ordenados = parsed as typeof ordenados;
    }
  } catch {
    // Best-effort: reranking failure returns original order without justificativas
    return top20;
  }

  const mapaOriginal = new Map(top20.map((d) => [d.documentoId, d]));
  const result: DocumentoBuscado[] = [];
  for (const item of ordenados) {
    const doc = mapaOriginal.get(item.documentoId);
    if (doc) result.push({ ...doc, justificativa: item.justificativa });
  }
  // Append docs not mentioned by LLM (without justificativa)
  for (const doc of top20) {
    if (!result.find((r) => r.documentoId === doc.documentoId)) {
      result.push(doc);
    }
  }
  return result;
}

function calcularConfianca(
  documentos: DocumentoBuscado[],
  filtroNaoResolvido: boolean,
): "alta" | "media" | "baixa" {
  if (documentos.length === 0) return "baixa";
  if (filtroNaoResolvido) return "media";
  if (
    documentos.length >= 2 &&
    documentos[0].rrfScore > documentos[1].rrfScore * 1.5
  )
    return "alta";
  if (documentos.length === 1) return "alta";
  return "media";
}

export async function buscarDocumentosConteudo(
  params: BuscaConteudoParams,
  supabaseAdmin: SupabaseClient,
  perguntaOriginal: string,
): Promise<ResultadoBuscaConteudo> {
  const { consulta } = params;
  const filtrosAplicados: Record<string, string> = {};
  if (consulta.tipo) filtrosAplicados.tipo = consulta.tipo;
  if (consulta.assunto) filtrosAplicados.assunto = consulta.assunto;
  if (params.lojaId) filtrosAplicados.loja = params.lojaId;

  // Stage 1: build authorised document allowlist
  const { ids: documentoIds, excedido: recorteExcedido } =
    await construirAllowlist(params, supabaseAdmin);

  if (recorteExcedido) {
    return {
      documentos: [],
      confianca: "baixa",
      recorteExcedido: true,
      sugestaoRefinamento:
        "Muitos documentos encontrados. Tente adicionar um filtro de loja, equipamento ou período para refinar.",
      filtrosAplicados,
    };
  }

  if (documentoIds.length === 0) {
    return {
      documentos: [],
      confianca: "baixa",
      recorteExcedido: false,
      filtrosAplicados,
    };
  }

  // Ruling 1: expand query text with taxonomy synonyms when assunto is set
  let consultaTexto = consulta.consultaSemantica;
  if (consulta.assunto) {
    try {
      const { data: termoRow, error: termoErr } = await supabaseAdmin
        .from("taxonomia_termos")
        .select("id")
        .eq("termo", consulta.assunto!)
        .maybeSingle();
      if (termoErr) throw termoErr;
      if (termoRow?.id) {
        const { data: sinRows, error: sinErr } = await supabaseAdmin
          .from("taxonomia_sinonimos")
          .select("variacao")
          .eq("termo_id", termoRow.id);
        if (sinErr) throw sinErr;
        const variacoes = [consulta.assunto!, ...(sinRows ?? []).map((s: { variacao: string }) => s.variacao)];
        consultaTexto = variacoes.join(" ") + " " + consulta.consultaSemantica;
      }
    } catch {
      // Best-effort: taxonomy expansion failed, continue with original text
    }
  }

  // Stage 2: hybrid search via RPC
  const embeddings = await gerarEmbeddings([consulta.consultaSemantica]);
  const embedding = embeddings[0];

  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
    "buscar_chunks_hibrido",
    {
      p_documento_ids: documentoIds,
      p_embedding: `[${embedding.join(",")}]`,
      p_consulta_texto: consultaTexto,
      p_limite: 20,
    },
  );
  if (rpcError) throw rpcError;

  const raw = (rpcData ?? []) as Array<{
    documento_id: string;
    rrf_score: number;
    melhor_trecho: string;
    pagina: number | null;
    n_trechos_relevantes: number;
  }>;

  const semJustificativa = raw.map((r) => ({
    documentoId: r.documento_id,
    rrfScore: r.rrf_score,
    trecho: r.melhor_trecho,
    pagina: r.pagina,
    nTrechosRelevantes: r.n_trechos_relevantes,
  }));

  // Reranking (best-effort — failure does not cancel the search)
  const documentos = await rerankear(semJustificativa, perguntaOriginal);

  const filtroNaoResolvido =
    (!!consulta.lojaTermo && !params.lojaId) ||
    (!!consulta.equipamentoTermo && !params.equipamentoId);

  return {
    documentos,
    confianca: calcularConfianca(documentos, filtroNaoResolvido),
    recorteExcedido: false,
    sugestaoRefinamento: filtroNaoResolvido
      ? `Não consegui identificar "${consulta.lojaTermo ?? consulta.equipamentoTermo}" com segurança — verifique o nome e tente novamente.`
      : undefined,
    filtrosAplicados,
  };
}
