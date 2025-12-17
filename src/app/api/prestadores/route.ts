import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

const PRESTADORES_BUCKET =
  process.env.NEXT_PUBLIC_PRESTADORES_BUCKET ?? "prestadores-config";
const PRESTADORES_FILE_KEY = "prestadores.json";

type StoredPrestador = {
  id: string;
  nome: string;
  cnpj: string;
  tipo_servico: string;
  usuarios: string[];
  created_at: string;
  created_by: string;
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

async function ensureBucket(client: SupabaseClient) {
  const { data } = await client.storage.getBucket(PRESTADORES_BUCKET);
  if (data) {
    return;
  }

  const { error } = await client.storage.createBucket(PRESTADORES_BUCKET, {
    public: false,
  });

  if (error && !error.message?.toLowerCase().includes("exists")) {
    throw error;
  }
}

async function readPrestadores(client: SupabaseClient) {
  await ensureBucket(client);
  const { data, error } = await client.storage
    .from(PRESTADORES_BUCKET)
    .download(PRESTADORES_FILE_KEY);

  if (error) {
    const statusCode =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error as any).statusCode ?? (error as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === "404" || error.message?.includes("Not Found")) {
      return [] as StoredPrestador[];
    }
    throw error;
  }

  if (!data) {
    return [];
  }

  const arrayBuffer = await data.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(arrayBuffer).toString("utf-8"),
    ) as StoredPrestador[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => ({
      id: item.id,
      nome: item.nome,
      cnpj: item.cnpj,
      tipo_servico: item.tipo_servico,
      usuarios: Array.isArray(item.usuarios)
        ? item.usuarios
            .map((email) =>
              typeof email === "string" ? email.toLowerCase().trim() : "",
            )
            .filter(Boolean)
        : [],
      created_at: item.created_at,
      created_by: item.created_by,
    }));
  } catch {
    return [];
  }
}

async function writePrestadores(
  client: SupabaseClient,
  prestadores: StoredPrestador[],
) {
  await ensureBucket(client);
  const payload = Buffer.from(
    JSON.stringify(prestadores, null, 2),
    "utf-8",
  );
  const { error } = await client.storage
    .from(PRESTADORES_BUCKET)
    .upload(PRESTADORES_FILE_KEY, payload, {
      contentType: "application/json",
      upsert: true,
    });

  if (error) {
    throw error;
  }
}

async function hasDocumentosAccess(
  client: SupabaseClient,
  userId: string,
  email: string | null,
) {
  const { data, error } = await client
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
  } = await client
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
    const adminClient = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(adminClient, user.id, email);
    if (!canAccess) {
      throw new HttpError(
        403,
        "Você não possui permissão para consultar prestadores.",
      );
    }

    const { searchParams } = new URL(request.url);
    const assignedOnly = searchParams.get("assignedOnly") === "true";

    const prestadores = await readPrestadores(adminClient);
    const filtered =
      assignedOnly && email
        ? prestadores.filter((item) => item.usuarios.includes(email))
        : prestadores;

    return NextResponse.json({ prestadores: filtered });
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
    const adminClient = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(adminClient, user.id, email);
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

    const existing = await readPrestadores(adminClient);
    const novoPrestador: StoredPrestador = {
      id: randomUUID(),
      nome,
      cnpj,
      tipo_servico: tipoServico,
      usuarios,
      created_at: new Date().toISOString(),
      created_by: user.id,
    };

    await writePrestadores(adminClient, [novoPrestador, ...existing]);

    return NextResponse.json({ prestador: novoPrestador });
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
