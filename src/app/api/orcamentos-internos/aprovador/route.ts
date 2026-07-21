import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { getAprovadorEmails, normalizeEmail } from "@/lib/orcamentosInternos";

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);

    if (actor.isAdmin) {
      return NextResponse.json({ isAprovador: true });
    }

    const email = normalizeEmail(actor.email);
    const aprovadores = await getAprovadorEmails(supabaseAdmin);
    const isAprovador = email !== null && aprovadores.has(email);

    return NextResponse.json({ isAprovador });
  } catch (err) {
    console.error("Erro ao verificar aprovador de orcamentos internos:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível verificar o acesso de aprovador.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
