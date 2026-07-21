import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { logDocumentoAuditEvent } from "@/lib/documentosAudit";
import { isAprovadorInterno, normalizeText } from "@/lib/orcamentosInternos";
import type { NotaFiscalConservacaoRow } from "../route";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);

    const isAprovador = await isAprovadorInterno(actor.email, supabaseAdmin);
    if (!actor.isAdmin && !isAprovador) {
      throw new HttpError(403, "Acesso restrito.");
    }

    const body = (await request.json()) as { status?: string; motivo?: string };
    const status = normalizeText(body.status);
    const motivo = normalizeText(body.motivo) || null;

    if (status !== "concluida" && status !== "rejeitada") {
      throw new HttpError(400, "Status inválido para esta operação.");
    }
    if (status === "rejeitada" && !motivo) {
      throw new HttpError(400, "Informe o motivo da rejeição.");
    }

    const { data: notaAtual, error: notaAtualError } = await supabaseAdmin
      .from("notas_fiscais_conservacao")
      .select("id,status")
      .eq("id", id)
      .maybeSingle();
    if (notaAtualError) {
      throw notaAtualError;
    }
    if (!notaAtual) {
      throw new HttpError(404, "Nota fiscal não encontrada.");
    }

    const { data: nota, error: notaError } = await supabaseAdmin
      .from("notas_fiscais_conservacao")
      .update({ status, motivo_status: motivo })
      .eq("id", id)
      .select("*")
      .single();
    if (notaError || !nota) {
      throw notaError ?? new Error("Falha ao atualizar a nota fiscal.");
    }

    await logDocumentoAuditEvent({
      supabaseAdmin,
      documentoId: id,
      eventType: "nota_conservacao_status_alterado",
      actorId: actor.realUserId,
      actorEmail: actor.realEmail,
      metadata: {
        from: notaAtual.status,
        to: status,
        ...(motivo ? { motivo } : {}),
      },
    });

    return NextResponse.json({ nota: nota as NotaFiscalConservacaoRow });
  } catch (err) {
    console.error("Erro ao atualizar nota fiscal de conservação:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível atualizar a nota fiscal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
