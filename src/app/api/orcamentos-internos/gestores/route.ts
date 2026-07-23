import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  ApiHttpError as HttpError,
  getActorFromRequest,
} from "@/lib/apiAuth";
import { assertInternalActor, normalizeEmail } from "@/lib/orcamentosInternos";

type GestorOption = {
  id: string | null;
  email: string;
  name: string | null;
  role: "admin" | "gerente";
};

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    await assertInternalActor({ actor, supabaseAdmin });

    const { data, error } = await supabaseAdmin
      .from("orcamentos_internos_aprovadores")
      .select("email,nome")
      .order("nome", { ascending: true });
    if (error) {
      throw error;
    }

    const gestores: GestorOption[] = [];
    for (const row of data ?? []) {
      const email = normalizeEmail(row.email as string | null);
      if (!email) {
        continue;
      }
      gestores.push({
        id: null,
        email,
        name: typeof row.nome === "string" ? row.nome : null,
        role: "gerente",
      });
    }

    return NextResponse.json({ gestores });
  } catch (err) {
    console.error("Erro ao listar gestores de orçamentos:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Não foi possível listar gestores.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
