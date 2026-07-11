import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { safeParseDados, sanitizeId } from "@/lib/documentosApiUtils";
import {
  ApiHttpError as HttpError,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";
import { analisarDocumentoComOpenAi } from "@/lib/openAiDocumentAnalysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FormularioRow = {
  id: string;
  tipo: string;
  dados: Record<string, unknown> | string | null;
  arquivo_path: string | null;
  arquivo_assinado_path: string | null;
};

function resolveMimeType(path: string, fallback?: string | null) {
  if (fallback?.trim()) {
    return fallback;
  }

  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function resolveFileName(path: string) {
  return path.split("/").pop() || "documento.pdf";
}

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

    const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
      .from("formularios")
      .download(path);

    if (downloadError || !fileBlob) {
      throw downloadError ?? new Error("Nao foi possivel baixar o arquivo.");
    }

    const mimeType = resolveMimeType(path, fileBlob.type);
    if (
      mimeType !== "application/pdf" &&
      mimeType !== "image/png" &&
      mimeType !== "image/jpeg"
    ) {
      throw new HttpError(400, `Tipo de arquivo nao suportado: ${mimeType}.`);
    }

    const { provider, model, resultado } = await analisarDocumentoComOpenAi({
      fileName: resolveFileName(path),
      mimeType,
      bytes: await fileBlob.arrayBuffer(),
      dadosAtuais: safeParseDados(row.dados),
      tipoDocumento: row.tipo,
    });

    const { data: analise, error: insertError } = await supabaseAdmin
      .from("documentos_analises_ia")
      .insert({
        documento_id: row.id,
        provider,
        model,
        status: "concluida",
        resultado,
      })
      .select("id,documento_id,provider,model,status,resultado,erro,created_at")
      .single();

    if (insertError) {
      throw insertError;
    }

    return NextResponse.json({ analise });
  } catch (err) {
    console.error("[documentos/analisar] Erro:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel analisar o documento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
