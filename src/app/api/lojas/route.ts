import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

type LojaRow = {
  id: string;
  nome: string;
  codigo?: string | null;
  usuarios?: string[] | null;
  created_at: string;
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function getSessionUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new HttpError(401, "Requisição não autorizada.");
  }

  const accessToken = authHeader.slice("Bearer ".length).trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Configuração incompleta. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const supabaseSession = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabaseSession.auth.getUser(accessToken);
  if (error || !data?.user) {
    throw new HttpError(401, "Sessão inválida ou expirada.");
  }

  return data.user;
}

async function hasAdminAccess(
  userId: string,
  email: string | null,
  supabaseAdmin = createSupabaseAdminClient(),
) {
  const adminModules = ["admin", "documentos", "dashboards", "perfil"];
  const { data, error } = await supabaseAdmin
    .from("documentos_acesso")
    .select("id")
    .eq("user_id", userId)
    .in("modulo", adminModules)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return true;
  }

  if (!email) {
    return false;
  }

  const {
    data: emailData,
    error: emailError,
  } = await supabaseAdmin
    .from("documentos_acesso")
    .select("id")
    .eq("email", email)
    .in("modulo", adminModules)
    .limit(1)
    .maybeSingle();

  if (emailError) {
    throw emailError;
  }

  return Boolean(emailData);
}

function normalizeEmails(values: string[]) {
  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasAdminAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(403, "Você não possui permissão para gerenciar lojas.");
    }

    const { data, error } = await supabaseAdmin
      .from("lojas")
      .select("id,nome,codigo,usuarios,created_at")
      .order("nome", { ascending: true });

    if (error) {
      throw error;
    }

    const lojas =
      data?.map((item) => ({
        id: item.id as string,
        nome: item.nome as string,
        codigo: (item.codigo as string | null) ?? null,
        usuarios: (item.usuarios as string[] | null) ?? [],
        created_at: item.created_at as string,
      })) ?? [];

    return NextResponse.json({ lojas });
  } catch (err) {
    console.error("Erro ao listar lojas:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Erro ao listar lojas.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasAdminAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(403, "Você não possui permissão para criar lojas.");
    }

    const body = (await request.json()) as {
      nome?: string;
      codigo?: string | null;
      usuarios?: string[];
    };

    const nome = body.nome?.trim();
    if (!nome) {
      throw new HttpError(400, "Informe o nome da loja.");
    }

    const usuarios = normalizeEmails(body.usuarios ?? []);
    const codigo = body.codigo?.trim() || null;

    const { data, error } = await supabaseAdmin
      .from("lojas")
      .insert({
        nome,
        codigo,
        usuarios,
      })
      .select("id,nome,codigo,usuarios,created_at")
      .single();

    if (error || !data) {
      throw error ?? new Error("Falha ao criar a loja.");
    }

    return NextResponse.json({
      loja: {
        id: data.id as string,
        nome: data.nome as string,
        codigo: (data.codigo as string | null) ?? null,
        usuarios: (data.usuarios as string[] | null) ?? [],
        created_at: data.created_at as string,
      },
    });
  } catch (err) {
    console.error("Erro ao criar loja:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Erro ao criar loja.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasAdminAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(403, "Você não possui permissão para atualizar lojas.");
    }

    const body = (await request.json()) as {
      id?: string;
      nome?: string;
      codigo?: string | null;
      usuarios?: string[];
    };

    if (!body.id) {
      throw new HttpError(400, "Informe a loja para atualizar.");
    }

    const updates: Record<string, unknown> = {};
    if (typeof body.nome === "string" && body.nome.trim()) {
      updates.nome = body.nome.trim();
    }
    if (typeof body.codigo === "string") {
      updates.codigo = body.codigo.trim() || null;
    }
    if (Array.isArray(body.usuarios)) {
      updates.usuarios = normalizeEmails(body.usuarios);
    }

    if (Object.keys(updates).length === 0) {
      throw new HttpError(400, "Nenhuma alteração informada.");
    }

    const { data, error } = await supabaseAdmin
      .from("lojas")
      .update(updates)
      .eq("id", body.id)
      .select("id,nome,codigo,usuarios,created_at")
      .single();

    if (error || !data) {
      throw error ?? new Error("Falha ao atualizar a loja.");
    }

    return NextResponse.json({
      loja: {
        id: data.id as string,
        nome: data.nome as string,
        codigo: (data.codigo as string | null) ?? null,
        usuarios: (data.usuarios as string[] | null) ?? [],
        created_at: data.created_at as string,
      },
    });
  } catch (err) {
    console.error("Erro ao atualizar loja:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Erro ao atualizar loja.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasAdminAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(403, "Você não possui permissão para remover lojas.");
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      throw new HttpError(400, "Informe a loja para remover.");
    }

    const { error } = await supabaseAdmin.from("lojas").delete().eq("id", id);
    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Erro ao remover loja:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Erro ao remover loja.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
