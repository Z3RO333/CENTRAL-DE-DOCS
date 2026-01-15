import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

type GerenteAccessInput = {
  lojaId: string;
  canViewAll?: boolean;
  prestadorIds?: string[];
};

type Payload = {
  email?: string;
  userId?: string;
  access?: GerenteAccessInput[];
};

const ADMIN_MODULES = ["admin", "documentos", "dashboards", "perfil"];

const sanitizeId = (value: string) => value.replace(/[^a-zA-Z0-9-]/g, "");

const normalizeIds = (values: string[]) =>
  Array.from(new Set(values.map((value) => sanitizeId(value.trim())).filter(Boolean)));

async function getAuthorizedAdmin(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY sao obrigatorios.",
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
    throw new Error("Sessao invalida.");
  }

  const supabaseAdmin = createSupabaseAdminClient();
  const requesterId = userData.user.id;
  const requesterEmail = userData.user.email?.toLowerCase().trim() ?? null;

  const { data: permissionById, error: permissionByIdError } =
    await supabaseAdmin
      .from("documentos_acesso")
      .select("id")
      .eq("user_id", requesterId)
      .eq("scope", "admin")
      .in("modulo", ADMIN_MODULES)
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
        .in("modulo", ADMIN_MODULES)
        .limit(1)
        .maybeSingle();

    if (permissionByEmailError) {
      throw permissionByEmailError;
    }
    hasPermission = Boolean(permissionByEmail);
  }

  if (!hasPermission) {
    throw new Error("Voce nao tem permissao para gerenciar gerentes.");
  }

  return supabaseAdmin;
}

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Requisicao nao autorizada." },
        { status: 401 },
      );
    }

    const token = authHeader.slice("Bearer ".length).trim();
    const supabaseAdmin = await getAuthorizedAdmin(token);

    const { searchParams } = new URL(request.url);
    const userId = sanitizeId(searchParams.get("userId")?.trim() ?? "");
    const email = searchParams.get("email")?.toLowerCase().trim() ?? "";

    let query = supabaseAdmin
      .from("documentos_acesso")
      .select("id,user_id,email,loja_id,prestador_id,can_view_all")
      .eq("scope", "gerente")
      .order("created_at", { ascending: false });

    if (userId && email) {
      query = query.or(`user_id.eq.${userId},email.eq.${email}`);
    } else if (userId) {
      query = query.eq("user_id", userId);
    } else if (email) {
      query = query.eq("email", email);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ entries: data ?? [] });
  } catch (err) {
    console.error("Erro ao listar gerentes:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Erro interno ao listar gerentes.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Requisicao nao autorizada." },
        { status: 401 },
      );
    }

    const token = authHeader.slice("Bearer ".length).trim();
    const supabaseAdmin = await getAuthorizedAdmin(token);

    const body = (await request.json()) as Payload;
    const normalizedEmail = body.email?.toLowerCase().trim() ?? "";
    const userId = body.userId?.trim() ?? "";

    if (!normalizedEmail && !userId) {
      return NextResponse.json(
        { error: "Informe o email ou o userId do gerente." },
        { status: 400 },
      );
    }

    if (userId) {
      const { error: deleteError } = await supabaseAdmin
        .from("documentos_acesso")
        .delete()
        .eq("scope", "gerente")
        .eq("user_id", userId);
      if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 400 });
      }
    }
    if (normalizedEmail) {
      const { error: deleteError } = await supabaseAdmin
        .from("documentos_acesso")
        .delete()
        .eq("scope", "gerente")
        .eq("email", normalizedEmail);
      if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 400 });
      }
    }

    const accessList = body.access ?? [];
    const rows = accessList.flatMap((access) => {
      const lojaId = sanitizeId(access.lojaId ?? "");
      if (!lojaId) {
        return [];
      }
      if (access.canViewAll) {
        return [
          {
            scope: "gerente",
            user_id: userId || null,
            email: normalizedEmail || null,
            loja_id: lojaId,
            prestador_id: null,
            can_view_all: true,
          },
        ];
      }

      const prestadores = normalizeIds(access.prestadorIds ?? []);
      return prestadores.map((prestadorId) => ({
        scope: "gerente",
        user_id: userId || null,
        email: normalizedEmail || null,
        loja_id: lojaId,
        prestador_id: prestadorId,
        can_view_all: false,
      }));
    });

    if (rows.length === 0) {
      return NextResponse.json({ entries: [] });
    }

    const { data, error } = await supabaseAdmin
      .from("documentos_acesso")
      .insert(rows)
      .select("id,user_id,email,loja_id,prestador_id,can_view_all");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ entries: data ?? [] });
  } catch (err) {
    console.error("Erro ao atualizar gerentes:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erro interno ao atualizar gerentes.",
      },
      { status: 500 },
    );
  }
}
