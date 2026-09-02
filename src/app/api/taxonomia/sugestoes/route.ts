import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    if (!actor.isAdmin) {
      throw new HttpError(403, "Revisao de taxonomia e restrita a administradores.");
    }

    const { data, error } = await supabaseAdmin
      .from("taxonomia_sugestoes")
      .select("id,variacao,termo_sugerido,documento_id,trecho,ocorrencias,created_at")
      .eq("status", "pendente")
      .order("ocorrencias", { ascending: false });
    if (error) {
      throw error;
    }

    return NextResponse.json({ sugestoes: data ?? [] });
  } catch (err) {
    console.error("Erro ao listar sugestoes de taxonomia:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Nao foi possivel listar as sugestoes.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
