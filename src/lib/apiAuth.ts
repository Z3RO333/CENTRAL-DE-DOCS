import { createClient, type User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

export type GerenteAccessRow = {
  loja_id: string | null;
  prestador_id: string | null;
  can_view_all: boolean | null;
};

export class ApiHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getSessionUserFromRequest(request: Request): Promise<User> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiHttpError(401, "Requisicao nao autorizada.");
  }

  const accessToken = authHeader.slice("Bearer ".length).trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Configuracao incompleta. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.",
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
    throw new ApiHttpError(401, "Sessao invalida ou expirada.");
  }

  return data.user;
}

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie");
  if (!raw) return null;
  const match = raw
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  if (!match) return null;
  const value = match.slice(name.length + 1).trim();
  try {
    return decodeURIComponent(value) || null;
  } catch {
    return value || null;
  }
}

export type Actor = {
  /** id efetivo (vazio quando simulando por email) */
  userId: string;
  /** email efetivo (real ou simulado) */
  email: string | null;
  /** é admin na identidade efetiva */
  isAdmin: boolean;
  /** usuário real autenticado (sempre o Gustavo, mesmo simulando) */
  realUserId: string;
  realEmail: string | null;
  realIsAdmin: boolean;
  isSimulating: boolean;
};

/**
 * Resolve a identidade efetiva da requisição. Autentica o usuário real e,
 * se ele for admin E houver o cookie `simular_email`, retorna a identidade
 * SIMULADA (apenas leitura/visualização). Só admin pode simular.
 */
export async function getActorFromRequest(
  request: Request,
  supabaseAdmin = createSupabaseAdminClient(),
): Promise<Actor> {
  const realUser = await getSessionUserFromRequest(request);
  const realEmail = realUser.email?.toLowerCase().trim() ?? null;
  const realIsAdmin = await hasDocumentosAccess(realUser.id, realEmail, supabaseAdmin);

  const simEmailRaw = readCookie(request, "simular_email");
  const simEmail = simEmailRaw?.toLowerCase().trim() || null;

  if (realIsAdmin && simEmail && simEmail !== realEmail) {
    // identidade simulada é resolvida só por email (toda filtragem já é por email)
    const simIsAdmin = await hasDocumentosAccess("", simEmail, supabaseAdmin);
    return {
      userId: "",
      email: simEmail,
      isAdmin: simIsAdmin,
      realUserId: realUser.id,
      realEmail,
      realIsAdmin,
      isSimulating: true,
    };
  }

  return {
    userId: realUser.id,
    email: realEmail,
    isAdmin: realIsAdmin,
    realUserId: realUser.id,
    realEmail,
    realIsAdmin,
    isSimulating: false,
  };
}

export async function hasDocumentosAccess(
  userId: string,
  email: string | null,
  supabaseAdmin = createSupabaseAdminClient(),
) {
  const adminModules = ["admin", "documentos", "dashboards", "perfil"];

  // userId pode vir vazio (simulação por email) → pula a query por uuid.
  if (userId) {
    const { data, error } = await supabaseAdmin
      .from("documentos_acesso")
      .select("id")
      .eq("user_id", userId)
      .eq("scope", "admin")
      .in("modulo", adminModules)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      return true;
    }
  }

  if (!email) {
    return false;
  }

  const { data: emailData, error: emailError } = await supabaseAdmin
    .from("documentos_acesso")
    .select("id")
    .eq("email", email)
    .eq("scope", "admin")
    .in("modulo", adminModules)
    .limit(1)
    .maybeSingle();

  if (emailError) {
    throw emailError;
  }

  return Boolean(emailData);
}

export async function getAuthorizedPrestadorIds(
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

// Escopos cujo acesso é "loja-scoped" (vê documentos de lojas específicas,
// estrutura loja_id/prestador_id/can_view_all): gerente E fornecedor.
// Fornecedor sempre usa can_view_all=true (independe de prestador) — a mesma
// estrutura é reaproveitada para não duplicar a lógica de filtragem.
const LOJA_SCOPED_SCOPES = ["gerente", "fornecedor"] as const;

export async function getGerenteAccessEntries(
  userId: string,
  email: string | null,
  supabaseAdmin = createSupabaseAdminClient(),
) {
  const entries: GerenteAccessRow[] = [];

  // userId pode vir vazio em simulação (filtragem só por email) — evita query
  // com uuid inválido.
  if (userId) {
    const { data: byId, error: byIdError } = await supabaseAdmin
      .from("documentos_acesso")
      .select("loja_id,prestador_id,can_view_all")
      .in("scope", LOJA_SCOPED_SCOPES)
      .eq("user_id", userId);

    if (byIdError) {
      throw byIdError;
    }

    if (byId) {
      entries.push(...(byId as GerenteAccessRow[]));
    }
  }

  if (email) {
    const { data: byEmail, error: byEmailError } = await supabaseAdmin
      .from("documentos_acesso")
      .select("loja_id,prestador_id,can_view_all")
      .in("scope", LOJA_SCOPED_SCOPES)
      .eq("email", email);

    if (byEmailError) {
      throw byEmailError;
    }

    if (byEmail) {
      entries.push(...(byEmail as GerenteAccessRow[]));
    }
  }

  const unique = new Map<string, GerenteAccessRow>();
  entries.forEach((entry) => {
    const key = `${entry.loja_id ?? ""}:${entry.prestador_id ?? ""}:${entry.can_view_all ? "1" : "0"}`;
    unique.set(key, entry);
  });
  return Array.from(unique.values());
}
