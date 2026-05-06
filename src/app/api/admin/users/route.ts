import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

type SafeUser = {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  phone: string | null;
};

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized request." },
        { status: 401 },
      );
    }

    const accessToken = authHeader.slice("Bearer ".length).trim();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        {
          error:
            "Configuração incompleta. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        },
        { status: 500 },
      );
    }

    const supabaseSessionClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: userData,
      error: sessionError,
    } = await supabaseSessionClient.auth.getUser(accessToken);

    if (sessionError || !userData?.user) {
      return NextResponse.json({ error: "Invalid session." }, { status: 401 });
    }

    const requesterId = userData.user.id;
    const requesterEmail = userData.user.email?.toLowerCase().trim() ?? null;

    const adminModules = ["admin", "documentos", "dashboards", "perfil"];
    const { data: permissionById, error: permissionByIdError } =
      await supabaseAdmin
        .from("documentos_acesso")
        .select("id")
        .eq("user_id", requesterId)
        .eq("scope", "admin")
        .in("modulo", adminModules)
        .limit(1)
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
          .eq("scope", "admin")
          .in("modulo", adminModules)
          .limit(1)
          .maybeSingle();

      if (permissionByEmailError) {
        throw permissionByEmailError;
      }
      hasPermission = Boolean(permissionByEmail);
    }

    if (!hasPermission) {
      return NextResponse.json(
        { error: "Você não possui permissão para listar usuários." },
        { status: 403 },
      );
    }

    const allUsers: SafeUser[] = [];
    const perPage = 200;
    let page = 1;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const {
        data: paged,
        error: listError,
      } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });

      if (listError) {
        throw listError;
      }

      const currentUsers = paged?.users ?? [];
      if (currentUsers.length === 0) {
        break;
      }

      allUsers.push(
        ...currentUsers.map((user) => ({
          id: user.id,
          email: user.email ?? null,
          name:
            (user.user_metadata?.name as string | undefined) ??
            (user.user_metadata?.full_name as string | undefined) ??
            null,
          created_at: user.created_at ?? "",
          last_sign_in_at: user.last_sign_in_at ?? null,
          phone: user.phone ?? null,
        })),
      );

      if (currentUsers.length < perPage) {
        break;
      }
      page += 1;
    }

    allUsers.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return NextResponse.json({ users: allUsers });
  } catch (err) {
    console.error("Erro ao listar usuarios:", err);
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message?: unknown }).message)
        : "Erro interno ao listar usuarios.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
