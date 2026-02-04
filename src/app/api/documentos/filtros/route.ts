import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { normalizeIds, sanitizeId, safeParseDados } from "@/lib/documentosApiUtils";

type FormularioRow = {
  created_at: string;
  status: string | null;
  dados: Record<string, unknown> | string | null;
  prestador_id?: string | null;
  user_id: string;
};

type LojaOption = {
  id: string;
  nome: string;
  codigo: string | null;
};

type PrestadorOption = {
  id: string;
  nome: string;
  tipo_servico: string | null;
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

type GerenteAccessRow = {
  loja_id: string | null;
  prestador_id: string | null;
  can_view_all: boolean | null;
};

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

const parseDados = (raw: FormularioRow["dados"]) => safeParseDados(raw);

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();
    const allowedPrestadores = await getAuthorizedPrestadorIds(
      email,
      supabaseAdmin,
    );
    const gerenteEntries = await getGerenteAccessEntries(
      user.id,
      email,
      supabaseAdmin,
    );

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    const { searchParams } = new URL(request.url);
    const filterPrestadores = normalizeIds(
      searchParams
        .getAll("prestadorId")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const filterLojas = normalizeIds(
      searchParams
        .getAll("lojaId")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const filterUserId = searchParams.get("userId");

    const hasPrestadorAccess = allowedPrestadores.length > 0;
    const hasGerenteAccess = gerenteEntries.length > 0;
    const isSelfFilter = filterUserId && filterUserId === user.id;

    if (!canAccess && !hasPrestadorAccess && !hasGerenteAccess && !isSelfFilter) {
      throw new HttpError(
        403,
        "Voce nao possui permissao para acessar esses documentos.",
      );
    }

    let query = supabaseAdmin
      .from("formularios")
      .select("created_at,status,dados,user_id,prestador_id", { count: "exact" })
      .order("created_at", { ascending: false });

    if (filterUserId) {
      query = query.eq("user_id", filterUserId);
    }

    if (!canAccess) {
      const accessOr: string[] = [];

      if (hasPrestadorAccess) {
        const allowedPrestadorSet = new Set(allowedPrestadores);
        const prestadoresPermitidos =
          filterPrestadores.length > 0
            ? filterPrestadores.filter((id) => allowedPrestadorSet.has(id))
            : allowedPrestadores;

        if (filterPrestadores.length > 0 && prestadoresPermitidos.length === 0) {
          throw new HttpError(
            403,
            "Voce nao possui permissao para consultar prestadores.",
          );
        }

        if (prestadoresPermitidos.length === 1) {
          accessOr.push(`prestador_id.eq.${prestadoresPermitidos[0]}`);
        } else if (prestadoresPermitidos.length > 1) {
          accessOr.push(
            `prestador_id.in.(${prestadoresPermitidos.join(",")})`,
          );
        }
      }

      if (hasGerenteAccess) {
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

        const filterLojaSet = new Set(filterLojas);
        const filterPrestadorSet = new Set(filterPrestadores);

        const lojasAllList =
          filterLojas.length > 0
            ? Array.from(lojasAll).filter((id) => filterLojaSet.has(id))
            : Array.from(lojasAll);

        const lojasLimitedList =
          filterLojas.length > 0
            ? Array.from(lojasLimited.keys()).filter((id) =>
                filterLojaSet.has(id),
              )
            : Array.from(lojasLimited.keys());

        if (
          filterLojas.length > 0 &&
          lojasAllList.length === 0 &&
          lojasLimitedList.length === 0
        ) {
          throw new HttpError(
            403,
            "Voce nao possui permissao para acessar essa loja.",
          );
        }

        const buildCondition = (lojaId: string, prestadores?: string[]) => {
          if (prestadores && prestadores.length > 0) {
            if (prestadores.length === 1) {
              return `and(dados->>loja_id.eq.${lojaId},prestador_id.eq.${prestadores[0]})`;
            }
            return `and(dados->>loja_id.eq.${lojaId},prestador_id.in.(${prestadores.join(",")}))`;
          }
          return `dados->>loja_id.eq.${lojaId}`;
        };

        lojasAllList.forEach((lojaId) => {
          if (filterPrestadores.length > 0) {
            accessOr.push(buildCondition(lojaId, filterPrestadores));
          } else {
            accessOr.push(buildCondition(lojaId));
          }
        });

        lojasLimitedList.forEach((lojaId) => {
          const allowedPrestadores = Array.from(lojasLimited.get(lojaId) ?? []);
          const filteredPrestadores =
            filterPrestadores.length > 0
              ? allowedPrestadores.filter((id) => filterPrestadorSet.has(id))
              : allowedPrestadores;

          if (filteredPrestadores.length > 0) {
            accessOr.push(buildCondition(lojaId, filteredPrestadores));
          }
        });

        if (filterPrestadores.length > 0 && accessOr.length === 0) {
          throw new HttpError(
            403,
            "Voce nao possui permissao para acessar esses documentos.",
          );
        }
      }

      if (isSelfFilter) {
        accessOr.push(`user_id.eq.${user.id}`);
      }

      if (accessOr.length === 0) {
        throw new HttpError(
          403,
          "Voce nao possui permissao para acessar esses documentos.",
        );
      }

      query = query.or(accessOr.join(","));
    }

    const { data: firstPage, error, count } = await query.range(0, 999);
    if (error) {
      throw error;
    }

    const total = count ?? (firstPage?.length ?? 0);
    const rows: FormularioRow[] = (firstPage as FormularioRow[]) ?? [];

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

    const anos = new Set<string>();
    const statusSet = new Set<string>();
    const tipoLaudoSet = new Set<string>();

    rows.forEach((row) => {
      if (row.created_at) {
        const ano = new Date(row.created_at).getFullYear().toString();
        if (!Number.isNaN(Number(ano))) {
          anos.add(ano);
        }
      }
      if (row.status) {
        statusSet.add(row.status);
      }
      const dados = parseDados(row.dados);
      const tipoLaudo = dados?.tipo_laudo;
      if (typeof tipoLaudo === "string" && tipoLaudo.trim()) {
        tipoLaudoSet.add(tipoLaudo.trim());
      }
    });

    const anosDisponiveis = Array.from(anos).sort((a, b) => Number(b) - Number(a));
    const statusDisponiveis = Array.from(statusSet);
    const tipoLaudoDisponiveis = Array.from(tipoLaudoSet);

    let lojasDisponiveis: LojaOption[] = [];
    let prestadoresDisponiveis: PrestadorOption[] = [];

    if (canAccess) {
      const { data: lojasAll, error: lojasError } = await supabaseAdmin
        .from("lojas")
        .select("id,nome,codigo")
        .order("nome", { ascending: true });
      if (lojasError) {
        throw lojasError;
      }
      lojasDisponiveis = (lojasAll as LojaOption[]) ?? [];

      const { data: prestadoresAll, error: prestadoresError } = await supabaseAdmin
        .from("prestadores")
        .select("id,nome,tipo_servico")
        .order("nome", { ascending: true });
      if (prestadoresError) {
        throw prestadoresError;
      }
      prestadoresDisponiveis = (prestadoresAll as PrestadorOption[]) ?? [];
    } else {
      const lojaIds = new Set<string>();
      gerenteEntries.forEach((entry) => {
        if (entry.loja_id) {
          lojaIds.add(sanitizeId(entry.loja_id));
        }
      });
      if (lojaIds.size > 0) {
        const { data: lojasData, error: lojasError } = await supabaseAdmin
          .from("lojas")
          .select("id,nome,codigo")
          .in("id", Array.from(lojaIds))
          .order("nome", { ascending: true });
        if (lojasError) {
          throw lojasError;
        }
        lojasDisponiveis = (lojasData as LojaOption[]) ?? [];
      }

      const prestadorIds = new Set<string>();
      allowedPrestadores.forEach((id) => prestadorIds.add(sanitizeId(id)));
      gerenteEntries.forEach((entry) => {
        if (entry.prestador_id) {
          prestadorIds.add(sanitizeId(entry.prestador_id));
        }
      });
      if (prestadorIds.size > 0) {
        const { data: prestadoresData, error: prestadoresError } = await supabaseAdmin
          .from("prestadores")
          .select("id,nome,tipo_servico")
          .in("id", Array.from(prestadorIds))
          .order("nome", { ascending: true });
        if (prestadoresError) {
          throw prestadoresError;
        }
        prestadoresDisponiveis = (prestadoresData as PrestadorOption[]) ?? [];
      }
    }

    return NextResponse.json({
      anos: anosDisponiveis,
      status: statusDisponiveis,
      tipoLaudo: tipoLaudoDisponiveis,
      lojas: lojasDisponiveis,
      prestadores: prestadoresDisponiveis,
    });
  } catch (err) {
    console.error("Erro ao buscar filtros de documentos:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível carregar os filtros.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
