import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  ApiHttpError as HttpError,
  getActorFromRequest,
} from "@/lib/apiAuth";
import { assertInternalActor, normalizeEmail } from "@/lib/orcamentosInternos";
import { formatPersonName } from "@/lib/displayName";

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
      .from("documentos_acesso")
      .select("user_id,email,scope,modulo")
      .in("scope", ["admin", "gerente"]);
    if (error) {
      throw error;
    }

    const byEmail = new Map<string, GestorOption>();
    for (const row of data ?? []) {
      const email = normalizeEmail(row.email as string | null);
      const userId =
        typeof row.user_id === "string" && row.user_id ? row.user_id : null;
      if (!email && !userId) {
        continue;
      }

      let resolvedEmail = email;
      let name: string | null = null;
      if (userId) {
        const userResult = await supabaseAdmin.auth.admin.getUserById(userId);
        const user = userResult.data.user;
        resolvedEmail = normalizeEmail(user?.email ?? email);
        name = formatPersonName({
          name: (user?.user_metadata?.name as string | undefined) ?? null,
          fullName:
            (user?.user_metadata?.full_name as string | undefined) ?? null,
          email: resolvedEmail,
        });
      }

      if (!resolvedEmail) {
        continue;
      }

      const role = row.scope === "admin" ? "admin" : "gerente";
      const previous = byEmail.get(resolvedEmail);
      byEmail.set(resolvedEmail, {
        id: previous?.id ?? userId,
        email: resolvedEmail,
        name: previous?.name ?? name,
        role: previous?.role === "admin" ? "admin" : role,
      });
    }

    const gestores = Array.from(byEmail.values()).sort((a, b) => {
      if (a.role !== b.role) {
        return a.role === "admin" ? -1 : 1;
      }
      return (a.name ?? a.email).localeCompare(b.name ?? b.email);
    });

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
