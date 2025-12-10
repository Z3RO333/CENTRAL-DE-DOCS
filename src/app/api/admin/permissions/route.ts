import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import type { PermissionModule } from "@/hooks/useDocumentPermissions";

type Payload =
  | {
      action: "grant";
      email: string;
      module: PermissionModule;
      userId?: string;
    }
  | {
      action: "revoke";
      permissionId: string;
    };

const MODULE_WHITELIST: PermissionModule[] = [
  "documentos",
  "dashboards",
  "perfil",
];

async function getAuthorizedAdmin(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY são obrigatórios.",
    );
  }

  const supabaseSessionClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: userData, error: sessionError } =
    await supabaseSessionClient.auth.getUser(accessToken);

  if (sessionError || !userData?.user) {
    throw new Error("Sessão inválida.");
  }

  const supabaseAdmin = createSupabaseAdminClient();
  const requesterId = userData.user.id;
  const requesterEmail = userData.user.email?.toLowerCase().trim() ?? null;

  const { data: permissionById, error: permissionByIdError } =
    await supabaseAdmin
      .from("documentos_acesso")
      .select("id")
      .eq("user_id", requesterId)
      .eq("modulo", "documentos")
      .maybeSingle();

  if (permissionByIdError) {
    throw permissionByIdError;
  }

  let hasPermission = Boolean(permissionById);
  if (!hasPermission && requesterEmail) {
    const { data: permissionByEmail, error: permissionByEmailError } =
      await supabaseAdmin
        .from("documentos_acesso")
        .select("id")
        .eq("email", requesterEmail)
        .eq("modulo", "documentos")
        .maybeSingle();

    if (permissionByEmailError) {
      throw permissionByEmailError;
    }
    hasPermission = Boolean(permissionByEmail);
  }

  if (!hasPermission) {
    throw new Error("Você não tem permissão para gerenciar acessos.");
  }

  return supabaseAdmin;
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Requisição não autorizada." },
        { status: 401 },
      );
    }

    const token = authHeader.slice("Bearer ".length).trim();
    const body = (await request.json()) as Payload;

    if (!body?.action) {
      return NextResponse.json(
        { error: "Ação inválida." },
        { status: 400 },
      );
    }

    const supabaseAdmin = await getAuthorizedAdmin(token);

    if (body.action === "grant") {
      const normalizedEmail = body.email?.toLowerCase().trim();
      if (!normalizedEmail) {
        return NextResponse.json(
          { error: "Informe o e-mail do usuário." },
          { status: 400 },
        );
      }

      if (!MODULE_WHITELIST.includes(body.module)) {
        return NextResponse.json(
          { error: "Módulo inválido." },
          { status: 400 },
        );
      }

      let resolvedUserId = body.userId?.trim() || null;
      if (!resolvedUserId) {
        const { data: existingUser, error: lookupError } =
          await supabaseAdmin.auth.admin.getUserByEmail(normalizedEmail);
        if (lookupError) {
          return NextResponse.json(
            { error: lookupError.message },
            { status: 400 },
          );
        }
        resolvedUserId = existingUser?.user?.id ?? null;
      }

      if (!resolvedUserId) {
        return NextResponse.json(
          {
            error:
              "UsuÇ­rio nÇœo encontrado no Supabase. Informe o ID ou solicite que o usuÇ­rio faÇõa login pelo menos uma vez.",
          },
          { status: 400 },
        );
      }

      const payload = {
        email: normalizedEmail,
        modulo: body.module,
        user_id: resolvedUserId,
      };

      const { data, error: insertError } = await supabaseAdmin
        .from("documentos_acesso")
        .insert(payload)
        .select("id,user_id,email,modulo,created_at")
        .single();

      if (insertError) {
        return NextResponse.json(
          { error: insertError.message },
          { status: 400 },
        );
      }

      return NextResponse.json({ permission: data });
    }

    if (!body.permissionId) {
      return NextResponse.json(
        { error: "Informe o permissionId para remover." },
        { status: 400 },
      );
    }

    const { error: deleteError } = await supabaseAdmin
      .from("documentos_acesso")
      .delete()
      .eq("id", body.permissionId);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Erro na API de permissões:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erro interno ao atualizar permissões.",
      },
      { status: 500 },
    );
  }
}
