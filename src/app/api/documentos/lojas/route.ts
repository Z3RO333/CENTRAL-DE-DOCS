import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { safeParseDados, sanitizeId } from "@/lib/documentosApiUtils";

type FormularioRow = {
  created_at: string;
  dados: Record<string, unknown> | string | null;
  prestador_id: string | null;
  user_id: string;
};

type LojaRow = {
  id: string;
  nome: string;
  codigo: string | null;
};

type GerenteAccessRow = {
  loja_id: string | null;
  prestador_id: string | null;
  can_view_all: boolean | null;
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
    throw new HttpError(401, "Requisicao nao autorizada.");
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
    throw new HttpError(401, "Sessao invalida ou expirada.");
  }

  return data.user;
}

async function hasDocumentosAccess(
  userId: string,
  email: string | null,
  supabaseAdmin = createSupabaseAdminClient(),
) {
  const adminModules = ["admin", "documentos", "dashboards", "perfil"];
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

async function getGerenteAccessEntries(
  userId: string,
  email: string | null,
  supabaseAdmin = createSupabaseAdminClient(),
) {
  const entries: GerenteAccessRow[] = [];

  const { data: byId, error: byIdError } = await supabaseAdmin
    .from("documentos_acesso")
    .select("loja_id,prestador_id,can_view_all")
    .eq("scope", "gerente")
    .eq("user_id", userId);

  if (byIdError) {
    throw byIdError;
  }

  if (byId) {
    entries.push(...(byId as GerenteAccessRow[]));
  }

  if (email) {
    const { data: byEmail, error: byEmailError } = await supabaseAdmin
      .from("documentos_acesso")
      .select("loja_id,prestador_id,can_view_all")
      .eq("scope", "gerente")
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

function getLojaIdFromDados(
  dados: Record<string, unknown> | string | null,
): string | null {
  const parsed = safeParseDados(dados);
  const lojaId = typeof parsed?.loja_id === "string" ? parsed.loja_id.trim() : "";
  if (!lojaId) {
    return null;
  }
  const sanitized = sanitizeId(lojaId);
  return sanitized || null;
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();
    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    const gerenteEntries = await getGerenteAccessEntries(
      user.id,
      email,
      supabaseAdmin,
    );
    const hasGerenteAccess = gerenteEntries.length > 0;

    const { searchParams } = new URL(request.url);
    const filterUserId = searchParams.get("userId")?.trim() ?? "";
    const filterPrestadores = Array.from(
      new Set(
        searchParams
          .getAll("prestadorId")
          .map((value) => sanitizeId(value.trim()))
          .filter(Boolean),
      ),
    );

    let query = supabaseAdmin
      .from("formularios")
      .select("created_at,dados,user_id,prestador_id", { count: "exact" })
      .order("created_at", { ascending: false });

    if (canAccess) {
      if (filterUserId) {
        query = query.eq("user_id", filterUserId);
      }
    } else if (hasGerenteAccess) {
      const accessOr: string[] = [];
      const lojasAll = new Set<string>();
      const lojasLimited = new Map<string, Set<string>>();

      gerenteEntries.forEach((entry) => {
        const lojaId = entry.loja_id ? sanitizeId(entry.loja_id) : "";
        if (!lojaId) {
          return;
        }
        if (entry.can_view_all) {
          lojasAll.add(lojaId);
          lojasLimited.delete(lojaId);
          return;
        }
        if (!entry.prestador_id) {
          return;
        }
        if (lojasAll.has(lojaId)) {
          return;
        }
        const set = lojasLimited.get(lojaId) ?? new Set<string>();
        set.add(sanitizeId(entry.prestador_id));
        lojasLimited.set(lojaId, set);
      });

      lojasAll.forEach((lojaId) => {
        accessOr.push(`dados->>loja_id.eq.${lojaId}`);
      });

      lojasLimited.forEach((prestadores, lojaId) => {
        const allowedPrestadores = Array.from(prestadores);
        if (allowedPrestadores.length === 1) {
          accessOr.push(
            `and(dados->>loja_id.eq.${lojaId},prestador_id.eq.${allowedPrestadores[0]})`,
          );
        } else if (allowedPrestadores.length > 1) {
          accessOr.push(
            `and(dados->>loja_id.eq.${lojaId},prestador_id.in.(${allowedPrestadores.join(",")}))`,
          );
        }
      });

      if (accessOr.length === 0) {
        return NextResponse.json({ lojas: [] });
      }

      query = query.or(accessOr.join(","));
    } else {
      // Regra do colaborador: somente lojas em que ele proprio enviou documentos.
      query = query.eq("user_id", user.id);
    }

    if (filterPrestadores.length === 1) {
      query = query.eq("prestador_id", filterPrestadores[0]);
    } else if (filterPrestadores.length > 1) {
      query = query.in("prestador_id", filterPrestadores);
    }

    const { data: firstBatch, error, count } = await query.range(0, 999);
    if (error) {
      throw error;
    }

    const rows: FormularioRow[] = (firstBatch as FormularioRow[]) ?? [];
    const total = count ?? rows.length;
    for (let offset = rows.length; offset < total; offset += 1000) {
      const { data: batch, error: batchError } = await query.range(
        offset,
        Math.min(offset + 999, total - 1),
      );
      if (batchError) {
        throw batchError;
      }
      rows.push(...((batch as FormularioRow[]) ?? []));
    }

    const grouped = new Map<
      string,
      { total: number; lastCreatedAt: string | null }
    >();

    rows.forEach((row) => {
      const lojaId = getLojaIdFromDados(row.dados);
      if (!lojaId) {
        return;
      }
      const current = grouped.get(lojaId) ?? { total: 0, lastCreatedAt: null };
      current.total += 1;
      if (!current.lastCreatedAt || row.created_at > current.lastCreatedAt) {
        current.lastCreatedAt = row.created_at;
      }
      grouped.set(lojaId, current);
    });

    const lojaIds = Array.from(grouped.keys());
    if (lojaIds.length === 0) {
      return NextResponse.json({ lojas: [] });
    }

    const { data: lojasData, error: lojasError } = await supabaseAdmin
      .from("lojas")
      .select("id,nome,codigo")
      .in("id", lojaIds)
      .order("nome", { ascending: true });

    if (lojasError) {
      throw lojasError;
    }

    const lojasMap = new Map<string, LojaRow>();
    (lojasData as LojaRow[] | null)?.forEach((item) => {
      lojasMap.set(item.id, item);
    });

    const lojas = lojaIds
      .map((lojaId) => {
        const loja = lojasMap.get(lojaId);
        const stats = grouped.get(lojaId)!;
        return {
          lojaId,
          lojaNome: loja?.nome ?? "Loja",
          lojaCodigo: loja?.codigo ?? null,
          totalDocumentos: stats.total,
          ultimoEnvioAt: stats.lastCreatedAt,
        };
      })
      .sort((a, b) => a.lojaNome.localeCompare(b.lojaNome, "pt-BR"));

    return NextResponse.json({ lojas });
  } catch (err) {
    console.error("Erro ao listar pastas por loja:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Erro ao listar pastas por loja.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
