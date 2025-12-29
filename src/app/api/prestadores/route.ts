import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

type PrestadorRow = {
  id: string;
  nome: string;
  cnpj: string;
  tipo_servico: string;
  usuarios: string[] | null;
  created_at: string;
  created_by: string | null;
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

async function hasDocumentosAccess(
  userId: string,
  email: string | null,
  supabaseAdmin = createSupabaseAdminClient(),
) {
  const { data, error } = await supabaseAdmin
    .from("documentos_acesso")
    .select("id")
    .eq("user_id", userId)
    .eq("modulo", "documentos")
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
    .eq("modulo", "documentos")
    .maybeSingle();

  if (emailError) {
    throw emailError;
  }

  return Boolean(emailData);
}

function normalizeEmails(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.toLowerCase().trim())
        .filter((value) => Boolean(value)),
    ),
  );
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(
        403,
        "Você não possui permissão para consultar prestadores.",
      );
    }

    const { searchParams } = new URL(request.url);
    const assignedOnly = searchParams.get("assignedOnly") === "true";

    if (assignedOnly && !email) {
      return NextResponse.json({ prestadores: [] });
    }

    let query = supabaseAdmin
      .from("prestadores")
      .select("id,nome,cnpj,tipo_servico,usuarios,created_at")
      .order("created_at", { ascending: false });

    if (assignedOnly && email) {
      query = query.contains("usuarios", [email]);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const prestadores =
      data?.map((item) => ({
        id: item.id as string,
        nome: item.nome as string,
        cnpj: item.cnpj as string,
        tipo_servico: item.tipo_servico as string,
        usuarios: (item.usuarios as string[] | null) ?? [],
        created_at: item.created_at as string,
      })) ?? [];

    return NextResponse.json({ prestadores });
  } catch (err) {
    console.error("Erro ao buscar prestadores:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível carregar os prestadores.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(
        403,
        "Você não possui permissão para cadastrar prestadores.",
      );
    }

    const body = (await request.json()) as {
      nome?: string;
      cnpj?: string;
      tipo_servico?: string;
      usuarios?: string[];
    };

    const nome = body.nome?.trim();
    const cnpj = body.cnpj?.trim();
    const tipoServico = body.tipo_servico?.trim();
    const usuarios = normalizeEmails(body.usuarios ?? []);

    if (!nome) {
      throw new HttpError(400, "Informe o nome do prestador.");
    }
    if (!tipoServico) {
      throw new HttpError(400, "Informe o tipo de serviço.");
    }
    if (!cnpj) {
      throw new HttpError(400, "Informe o CNPJ do prestador.");
    }
    if (usuarios.length === 0) {
      throw new HttpError(
        400,
        "Informe ao menos um e-mail autorizado para o prestador.",
      );
    }

    const { data, error } = await supabaseAdmin
      .from("prestadores")
      .insert({
        nome,
        cnpj,
        tipo_servico: tipoServico,
        usuarios,
        created_by: user.id,
      })
      .select("id,nome,cnpj,tipo_servico,usuarios,created_at")
      .single();

    if (error) {
      throw error;
    }

    const prestador: PrestadorRow = data as PrestadorRow;

    return NextResponse.json({
      prestador: {
        ...prestador,
        usuarios: prestador.usuarios ?? [],
      },
    });
  } catch (err) {
    console.error("Erro ao criar prestador:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível cadastrar o prestador.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(
        403,
        "Voce nao possui permissao para atualizar prestadores.",
      );
    }

    const body = (await request.json()) as {
      id?: string;
      emails?: string[];
      remove_emails?: string[];
    };

    const prestadorId = body.id?.trim();
    const novosEmails = normalizeEmails(body.emails ?? []);
    const removerEmails = normalizeEmails(body.remove_emails ?? []);

    if (!prestadorId) {
      throw new HttpError(400, "Informe o prestador.");
    }
    if (novosEmails.length === 0 && removerEmails.length === 0) {
      throw new HttpError(400, "Informe ao menos um e-mail.");
    }

    if (novosEmails.length > 0) {
      const { data: authUsers, error: authUsersError } = await supabaseAdmin
        .from("auth.users")
        .select("email")
        .in("email", novosEmails);

      if (authUsersError) {
        throw authUsersError;
      }

      const encontrados = new Set(
        (authUsers ?? [])
          .map((item) => (item.email as string | null) ?? "")
          .map((value) => value.toLowerCase().trim())
          .filter(Boolean),
      );
      const faltando = novosEmails.filter((emailItem) => !encontrados.has(emailItem));
      if (faltando.length > 0) {
        throw new HttpError(
          400,
          `E-mails nao cadastrados na aplicacao: ${faltando.join(", ")}`,
        );
      }
    }

    const { data: prestadorData, error: prestadorError } = await supabaseAdmin
      .from("prestadores")
      .select("id,nome,cnpj,tipo_servico,usuarios,created_at")
      .eq("id", prestadorId)
      .single();

    if (prestadorError) {
      throw prestadorError;
    }

    const existentes = (prestadorData?.usuarios as string[] | null) ?? [];
    const usuarios = normalizeEmails([...existentes, ...novosEmails]).filter(
      (value) => !removerEmails.includes(value),
    );

    const { data, error } = await supabaseAdmin
      .from("prestadores")
      .update({ usuarios })
      .eq("id", prestadorId)
      .select("id,nome,cnpj,tipo_servico,usuarios,created_at")
      .single();

    if (error) {
      throw error;
    }

    const prestador: PrestadorRow = data as PrestadorRow;

    return NextResponse.json({
      prestador: {
        ...prestador,
        usuarios: prestador.usuarios ?? [],
      },
    });
  } catch (err) {
    console.error("Erro ao atualizar prestador:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel atualizar o prestador.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(
        403,
        "Voce nao possui permissao para remover prestadores.",
      );
    }

    const { searchParams } = new URL(request.url);
    const prestadorId = searchParams.get("id")?.trim();
    if (!prestadorId) {
      throw new HttpError(400, "Informe o prestador.");
    }

    const { error } = await supabaseAdmin
      .from("prestadores")
      .delete()
      .eq("id", prestadorId);

    if (error) {
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Erro ao remover prestador:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel remover o prestador.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
