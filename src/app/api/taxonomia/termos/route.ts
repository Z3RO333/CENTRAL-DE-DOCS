import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    if (!actor.isAdmin) {
      throw new HttpError(403, "Consulta de taxonomia e restrita a administradores.");
    }

    const { data, error } = await supabaseAdmin
      .from("taxonomia_termos")
      .select("id,termo,categoria,tipo")
      .eq("ativo", true)
      .order("categoria", { ascending: true });
    if (error) {
      throw error;
    }

    return NextResponse.json({ termos: data ?? [] });
  } catch (err) {
    console.error("Erro ao listar termos de taxonomia:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Nao foi possivel listar os termos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
