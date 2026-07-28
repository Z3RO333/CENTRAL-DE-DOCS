import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiHttpError, getSessionUserFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { detectDocumentFile } from "@/lib/fileValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MAX_MB = 15;

function getMaxBytes() {
  const configured = Number(process.env.MAX_DOCUMENT_UPLOAD_MB);
  const mb = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_MB;
  return Math.floor(mb * 1024 * 1024);
}

function sanitizeCategory(value: FormDataEntryValue | null) {
  const category = typeof value === "string" ? value.trim() : "documentos";
  const sanitized = category
    .replace(/[^a-zA-Z0-9/_-]/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/^\/+|\/+$/g, "")
    .slice(0, 100);
  return sanitized || "documentos";
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUserFromRequest(request);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ApiHttpError(400, "Selecione um arquivo para enviar.");
    }
    if (file.size <= 0) {
      throw new ApiHttpError(400, "O arquivo está vazio.");
    }
    const maxBytes = getMaxBytes();
    if (file.size > maxBytes) {
      throw new ApiHttpError(
        413,
        `O arquivo excede o limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectDocumentFile(bytes);
    if (!detected) {
      throw new ApiHttpError(415, "Formato inválido. Envie PDF, PNG ou JPEG.");
    }

    const declaredType = file.type.toLowerCase().trim();
    const compatibleTypes = new Set([
      detected.mime,
      ...(detected.mime === "image/jpeg" ? ["image/jpg"] : []),
      "application/octet-stream",
      "",
    ]);
    if (!compatibleTypes.has(declaredType)) {
      throw new ApiHttpError(415, "O conteúdo do arquivo não corresponde ao formato informado.");
    }

    const category = sanitizeCategory(formData.get("category"));
    const path = `${user.id}/${category}/${Date.now()}-${randomUUID()}.${detected.extension}`;
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin.storage
      .from("formularios")
      .upload(path, bytes, {
        contentType: detected.mime,
        upsert: false,
        cacheControl: "3600",
      });
    if (error || !data) throw error ?? new Error("Falha ao gravar o arquivo.");

    return NextResponse.json(
      {
        upload: {
          path: data.path ?? path,
          name: file.name,
          type: detected.mime,
          size: file.size,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Erro no upload validado de documento:", error);
    return NextResponse.json(
      { error: "Não foi possível enviar o arquivo. Tente novamente." },
      { status: 500 },
    );
  }
}
