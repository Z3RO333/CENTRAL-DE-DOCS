import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

type FormularioRow = {
  id: string;
  tipo: string;
  status: string;
  arquivo_path: string;
  arquivo_assinado_path?: string | null;
  created_at: string;
  dados: Record<string, unknown> | string | null;
  assinado_por?: string | null;
  user_id: string;
  prestador_id?: string | null;
};

type DocumentRecord = {
  id: string;
  tipo: string;
  status: string;
  arquivo_path: string;
  arquivo_assinado_path: string | null;
  created_at: string;
  dados: Record<string, unknown> | null;
  assinado_por: string | null;
  user_id: string;
  prestador_id: string | null;
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

async function getAuthorizedPrestadorIds(
  email: string | null,
  supabaseAdmin = createSupabaseAdminClient(),
) {
  if (!email) {
    return [];
  }
  const { data, error } = await supabaseAdmin
    .from("prestadores")
    .select("id,usuarios")
    .contains("usuarios", [email]);
  if (error) {
    throw error;
  }
  return (
    data?.map((item) => ({
      id: item.id as string,
      usuarios: (item.usuarios as string[] | null) ?? [],
    })) ?? []
  )
    .filter((item) => item.usuarios.some((usuario) => usuario === email))
    .map((item) => item.id);
}

function mapRows(rows: FormularioRow[]): DocumentRecord[] {
  return rows.map((item) => ({
    id: item.id,
    tipo: item.tipo,
    status: item.status,
    arquivo_path: item.arquivo_path,
    arquivo_assinado_path: item.arquivo_assinado_path ?? null,
    created_at: item.created_at,
    dados:
      typeof item.dados === "string"
        ? (JSON.parse(item.dados) as Record<string, unknown>)
        : (item.dados as Record<string, unknown> | null),
    assinado_por: item.assinado_por ?? null,
    user_id: item.user_id,
    prestador_id: item.prestador_id ?? null,
  }));
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();
    const allowedPrestadores = await getAuthorizedPrestadorIds(
      email,
      supabaseAdmin,
    );

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    const { searchParams } = new URL(request.url);
    const filterUserId = searchParams.get("userId");
    const filterPrestadores = searchParams
      .getAll("prestadorId")
      .map((value) => value.trim())
      .filter(Boolean);
    let prestadoresPermitidos = filterPrestadores;
    let userFilter = filterUserId;

    if (!canAccess) {
      if (prestadoresPermitidos.length > 0) {
        prestadoresPermitidos = prestadoresPermitidos.filter((id) =>
          allowedPrestadores.includes(id),
        );
        if (prestadoresPermitidos.length === 0) {
          throw new HttpError(
            403,
            "Você não possui permissão para consultar documentos.",
          );
        }
      } else if (allowedPrestadores.length > 0) {
        prestadoresPermitidos = allowedPrestadores;
      } else {
        userFilter = user.id;
      }
    }

    let query = supabaseAdmin
      .from("formularios")
      .select(
        "id,tipo,status,arquivo_path,arquivo_assinado_path,created_at,dados,assinado_por,user_id,prestador_id",
      )
      .order("created_at", { ascending: false });

    if (userFilter) {
      query = query.eq("user_id", userFilter);
    }

    if (prestadoresPermitidos.length === 1) {
      query = query.eq("prestador_id", prestadoresPermitidos[0]);
    } else if (prestadoresPermitidos.length > 1) {
      query = query.in("prestador_id", prestadoresPermitidos);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    return NextResponse.json({
      registros: mapRows((data as FormularioRow[]) ?? []),
    });
  } catch (err) {
    console.error("Erro ao buscar documentos:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível carregar os documentos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();
    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    const allowedPrestadores = await getAuthorizedPrestadorIds(
      email,
      supabaseAdmin,
    );

    const { searchParams } = new URL(request.url);
    const ids = searchParams.getAll("id").map((value) => value.trim());
    const idsFromList = (searchParams.get("ids") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const idsToRemove = Array.from(
      new Set([...ids, ...idsFromList].filter(Boolean)),
    );

    if (idsToRemove.length === 0) {
      throw new HttpError(400, "Informe o id do documento.");
    }

    const { data: registros, error: recordError } = await supabaseAdmin
      .from("formularios")
      .select("id,user_id,prestador_id,arquivo_path,arquivo_assinado_path")
      .in("id", idsToRemove);
    if (recordError) {
      throw recordError;
    }
    if (!registros || registros.length !== idsToRemove.length) {
      throw new HttpError(404, "Documento não encontrado.");
    }

    if (!canAccess) {
      const isAuthorized = registros.every((registro) => {
        const prestadorId = registro.prestador_id as string | null;
        const hasPrestadorAccess =
          prestadorId && allowedPrestadores.includes(prestadorId);
        const isOwner = registro.user_id === user.id;
        return hasPrestadorAccess || isOwner;
      });
      if (!isAuthorized) {
        throw new HttpError(
          403,
          "Você não possui permissão para remover este documento.",
        );
      }
    }

    const { error: deleteError } = await supabaseAdmin
      .from("formularios")
      .delete()
      .in("id", idsToRemove);
    if (deleteError) {
      throw deleteError;
    }

    const arquivos = registros
      .flatMap((registro) => [
        registro.arquivo_path,
        registro.arquivo_assinado_path,
      ])
      .filter(Boolean) as string[];
    if (arquivos.length > 0) {
      const { error: storageError } = await supabaseAdmin.storage
        .from("formularios")
        .remove(arquivos);
      if (storageError) {
        console.error("Erro ao remover arquivos do storage:", storageError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Erro ao remover documento:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível remover o documento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
