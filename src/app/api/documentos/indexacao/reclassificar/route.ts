import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { classificarDocumento } from "@/lib/taxonomiaIndexacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE_PADRAO = 200;
const LIMITE_MAX = 500;

type DocumentoConteudoRow = { documento_id: string; texto: string };

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    if (!actor.isAdmin) {
      throw new HttpError(403, "Reclassificacao de taxonomia e restrita a administradores.");
    }

    const body = (await request.json().catch(() => ({}))) as { limite?: number };
    const limiteBruto = Number(body.limite);
    const limite = Number.isFinite(limiteBruto)
      ? Math.min(Math.max(Math.trunc(limiteBruto), 1), LIMITE_MAX)
      : LIMITE_PADRAO;

    // Sem custo externo (so texto ja persistido + matching local), entao o
    // filtro "ainda nao classificado" e o unico cursor necessario: cada
    // chamada processa o proximo lote e marca termos_classificado_em, sem
    // precisar computar uma janela como o backfill de OCR da Fase 1.
    const { data, error } = await supabaseAdmin
      .from("documento_conteudo")
      .select("documento_id,texto")
      .is("termos_classificado_em", null)
      .not("indexado_em", "is", null)
      .order("documento_id", { ascending: true })
      .limit(limite);
    if (error) {
      throw error;
    }

    const pendentes = (data as DocumentoConteudoRow[] | null) ?? [];

    let processados = 0;
    let classificados = 0;
    let pulados = 0;
    let erros = 0;

    for (const row of pendentes) {
      try {
        const resultado = await classificarDocumento(supabaseAdmin, {
          documentoId: row.documento_id,
          texto: row.texto,
          equipamentoTipo: null,
          equipamentoIdentificacao: null,
        });
        if (resultado.status === "classificado") classificados += 1;
        else if (resultado.status === "pulado") pulados += 1;
        else erros += 1;
      } catch (docErr) {
        console.error(`Erro ao classificar documento ${row.documento_id}:`, docErr);
        erros += 1;
      }
      processados += 1;
    }

    return NextResponse.json({
      processados,
      classificados,
      pulados,
      erros,
      concluido: pendentes.length === 0,
    });
  } catch (err) {
    console.error("Erro na reclassificacao de taxonomia:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel reclassificar os documentos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
