import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { safeParseDados, sanitizeId } from "@/lib/documentosApiUtils";
import {
  ApiHttpError as HttpError,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";
import {
  baixarEAnalisarArquivo,
  registrarAnaliseIa,
} from "@/lib/documentAnalysisPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FormularioRow = {
  id: string;
  tipo: string;
  dados: Record<string, unknown> | string | null;
  arquivo_path: string | null;
  arquivo_assinado_path: string | null;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();
    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);

    if (!canAccess) {
      throw new HttpError(403, "Apenas administradores podem analisar documentos por IA.");
    }

    const { id: rawId } = await context.params;
    const id = sanitizeId(rawId ?? "");
    if (!id) {
      throw new HttpError(400, "Informe um documento valido.");
    }

    const { data: registro, error: registroError } = await supabaseAdmin
      .from("formularios")
      .select("id,tipo,dados,arquivo_path,arquivo_assinado_path")
      .eq("id", id)
      .maybeSingle();

    if (registroError) {
      throw registroError;
    }
    if (!registro) {
      throw new HttpError(404, "Documento nao encontrado.");
    }

    const row = registro as FormularioRow;
    const path = row.arquivo_assinado_path ?? row.arquivo_path;
    if (!path) {
      throw new HttpError(400, "Documento sem arquivo para analise.");
    }

    const { provider, model, resultado } = await baixarEAnalisarArquivo(supabaseAdmin, {
      path,
      tipoDocumento: row.tipo,
      dadosAtuais: safeParseDados(row.dados),
    });

    const analise = await registrarAnaliseIa(supabaseAdmin, {
      documentoId: row.id,
      provider,
      model,
      resultado,
    });

    const { error: statusUpdateError } = await supabaseAdmin
      .from("formularios")
      .update({ status_analise_ia: "concluida" })
      .eq("id", row.id);

    if (statusUpdateError) {
      console.error("[documentos/analisar] Falha ao atualizar status_analise_ia:", statusUpdateError);
    }

    return NextResponse.json({ analise });
  } catch (err) {
    console.error("[documentos/analisar] Erro:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && err.message.startsWith("Tipo de arquivo nao suportado:")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel analisar o documento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
