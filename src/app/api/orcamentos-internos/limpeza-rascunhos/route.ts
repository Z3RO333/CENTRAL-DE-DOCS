import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { autorizarRequisicaoCron } from "@/lib/cronAuth";
import { limparRascunhosAbandonados } from "@/lib/rascunhosLimpeza";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HORAS_LIMITE_PADRAO = 24;

export async function POST(request: Request) {
  if (!autorizarRequisicaoCron(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") === "true";

    const supabaseAdmin = createSupabaseAdminClient();
    const resultado = await limparRascunhosAbandonados(supabaseAdmin, {
      horasLimite: HORAS_LIMITE_PADRAO,
      dryRun,
    });

    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    console.error("[orcamentos-internos/limpeza-rascunhos] Erro:", err);
    const message =
      err instanceof Error ? err.message : "Erro ao limpar rascunhos abandonados.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
