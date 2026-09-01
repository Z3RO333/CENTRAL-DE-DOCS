import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { getConversaMensagens, limparConversa } from "@/lib/assistenteConversas";

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    if (!actor.userId) {
      throw new HttpError(400, "Assistente indisponível durante simulação de usuário.");
    }
    const mensagens = await getConversaMensagens(actor.userId, supabaseAdmin);
    return NextResponse.json({ mensagens });
  } catch (err) {
    console.error("Erro ao carregar historico do assistente:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Não foi possível carregar o histórico.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    if (!actor.userId) {
      throw new HttpError(400, "Assistente indisponível durante simulação de usuário.");
    }
    await limparConversa(actor.userId, supabaseAdmin);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Erro ao limpar historico do assistente:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Não foi possível limpar o histórico.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
