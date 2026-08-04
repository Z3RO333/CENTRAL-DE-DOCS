import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  processarDocumentoComIa,
  verificarSegredoWebhook,
} from "@/lib/documentAnalysisPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WebhookPayload = {
  type?: string;
  table?: string;
  record?: { id?: string };
};

export async function POST(request: Request) {
  const autorizado = verificarSegredoWebhook(
    request.headers.get("authorization"),
    process.env.DOCUMENTOS_IA_WEBHOOK_SECRET,
  );
  if (!autorizado) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  try {
    const payload = (await request.json().catch(() => null)) as WebhookPayload | null;
    const documentoId = payload?.record?.id;
    if (!documentoId) {
      return NextResponse.json(
        { error: "Payload sem id do documento." },
        { status: 400 },
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const resultado = await processarDocumentoComIa(supabaseAdmin, documentoId);

    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    console.error("[documentos/ia/processar] Erro:", err);
    const message =
      err instanceof Error ? err.message : "Erro ao processar documento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
