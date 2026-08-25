import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  ApiHttpError as HttpError,
  getActorFromRequest,
} from "@/lib/apiAuth";
import { getAprovadorEmails, normalizeEmail } from "@/lib/orcamentosInternos";

type ColaboradorOption = {
  id: string;
  email: string;
  name: string | null;
};

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);

    const aprovadores = await getAprovadorEmails(supabaseAdmin);
    const actorEmail = normalizeEmail(actor.email);
    const isGestor = Boolean(actorEmail && aprovadores.has(actorEmail));
    if (!isGestor) {
      throw new HttpError(
        403,
        "Somente gestores podem enviar orçamentos em nome de outro administrador.",
      );
    }

    const { data: acessos, error: acessosError } = await supabaseAdmin
      .from("documentos_acesso")
      .select("user_id,email")
      .eq("scope", "admin");
    if (acessosError) {
      throw acessosError;
    }

    const porUserId = new Map<string, string>();
    for (const row of acessos ?? []) {
      const userId = row.user_id as string | null;
      const email = normalizeEmail(row.email as string | null);
      if (!userId || !email) {
        continue;
      }
      porUserId.set(userId, email);
    }

    const nomesPorUserId = new Map<string, string | null>();
    const perPage = 200;
    let page = 1;
    while (porUserId.size > nomesPorUserId.size) {
      const { data: paged, error: listError } =
        await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (listError) {
        throw listError;
      }
      const currentUsers = paged?.users ?? [];
      if (currentUsers.length === 0) {
        break;
      }
      for (const user of currentUsers) {
        if (!porUserId.has(user.id)) {
          continue;
        }
        const name =
          (user.user_metadata?.name as string | undefined) ??
          (user.user_metadata?.full_name as string | undefined) ??
          null;
        nomesPorUserId.set(user.id, name);
      }
      if (currentUsers.length < perPage) {
        break;
      }
      page += 1;
    }

    const colaboradores: ColaboradorOption[] = Array.from(porUserId.entries())
      .map(([id, email]) => ({
        id,
        email,
        name: nomesPorUserId.get(id) ?? null,
      }))
      .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));

    return NextResponse.json({ colaboradores });
  } catch (err) {
    console.error("Erro ao listar administradores para envio de orçamento:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível listar administradores.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
