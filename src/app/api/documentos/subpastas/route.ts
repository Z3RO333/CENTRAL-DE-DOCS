import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { normalizeIds, safeParseDados, sanitizeId } from "@/lib/documentosApiUtils";
import { resolveServicoOficial } from "@/lib/servicosVocab";

type FormularioRow = {
  created_at: string;
  tipo: string;
  dados: Record<string, unknown> | string | null;
  prestador_id: string | null;
  user_id: string;
};

type GerenteAccessRow = {
  loja_id: string | null;
  prestador_id: string | null;
  can_view_all: boolean | null;
};

type SubpastaNode = {
  key: string;
  nome: string;
  tipo: string;
  tipoLaudo: string | null;
  tipoLaudoValores: string[];
  totalDocumentos: number;
  ultimoEnvioAt: string | null;
  children: SubpastaNode[];
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

const TIPO_LABEL: Record<string, string> = {
  retencao_trabalhista: "Retencao Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
};

const readTipoLaudo = (dados: FormularioRow["dados"]) => {
  const parsed = safeParseDados(dados);
  const value = typeof parsed?.tipo_laudo === "string" ? parsed.tipo_laudo.trim() : "";
  return value || "";
};

const applyDateFilter = (
  query: any,
  anoFilter: string | null,
  mesFilter: string | null,
) => {
  if (!anoFilter || anoFilter === "todos") {
    return query;
  }
  const ano = Number(anoFilter);
  if (Number.isNaN(ano)) {
    return query;
  }
  if (mesFilter && mesFilter !== "todos") {
    const mes = Number(mesFilter);
    if (!Number.isNaN(mes) && mes >= 1 && mes <= 12) {
      const start = new Date(ano, mes - 1, 1);
      const end = new Date(ano, mes, 1);
      return query.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
    }
    return query;
  }
  const start = new Date(ano, 0, 1);
  const end = new Date(ano + 1, 0, 1);
  return query.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
};

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();
    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    const allowedPrestadores = await getAuthorizedPrestadorIds(email, supabaseAdmin);
    const gerenteEntries = await getGerenteAccessEntries(user.id, email, supabaseAdmin);

    const { searchParams } = new URL(request.url);
    const lojaId = sanitizeId((searchParams.get("lojaId") ?? "").trim());
    if (!lojaId) {
      throw new HttpError(400, "Informe uma loja valida.");
    }

    const filterUserId = sanitizeId((searchParams.get("userId") ?? "").trim());
    const filterPrestadores = normalizeIds(
      searchParams
        .getAll("prestadorId")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const anoFilter = searchParams.get("ano");
    const mesFilter = searchParams.get("mes");

    const hasPrestadorAccess = allowedPrestadores.length > 0;
    const hasGerenteAccess = gerenteEntries.length > 0;
    const isSelfFilter = filterUserId === user.id;

    if (!canAccess && !hasPrestadorAccess && !hasGerenteAccess && !isSelfFilter) {
      throw new HttpError(403, "Voce nao possui permissao para acessar esses documentos.");
    }

    let query = supabaseAdmin
      .from("formularios")
      .select("created_at,tipo,dados,user_id,prestador_id", { count: "exact" })
      .eq("dados->>loja_id", lojaId)
      .order("created_at", { ascending: false });

    if (filterUserId) {
      query = query.eq("user_id", filterUserId);
    }

    if (!canAccess) {
      const accessOr: string[] = [];

      if (hasPrestadorAccess) {
        const allowedSet = new Set(allowedPrestadores);
        const prestadoresPermitidos =
          filterPrestadores.length > 0
            ? filterPrestadores.filter((id) => allowedSet.has(id))
            : allowedPrestadores;
        if (filterPrestadores.length > 0 && prestadoresPermitidos.length === 0) {
          throw new HttpError(403, "Voce nao possui permissao para consultar prestadores.");
        }
        if (prestadoresPermitidos.length === 1) {
          accessOr.push(`prestador_id.eq.${prestadoresPermitidos[0]}`);
        } else if (prestadoresPermitidos.length > 1) {
          accessOr.push(`prestador_id.in.(${prestadoresPermitidos.join(",")})`);
        }
      }

      if (hasGerenteAccess) {
        const lojaEntries = gerenteEntries.filter(
          (entry) => sanitizeId(entry.loja_id ?? "") === lojaId,
        );
        const canViewAll = lojaEntries.some((entry) => Boolean(entry.can_view_all));
        if (canViewAll) {
          if (filterPrestadores.length > 0) {
            if (filterPrestadores.length === 1) {
              accessOr.push(`prestador_id.eq.${filterPrestadores[0]}`);
            } else {
              accessOr.push(`prestador_id.in.(${filterPrestadores.join(",")})`);
            }
          } else {
            accessOr.push(`dados->>loja_id.eq.${lojaId}`);
          }
        } else {
          const allowedByLoja = normalizeIds(
            lojaEntries
              .map((entry) => entry.prestador_id ?? "")
              .filter(Boolean),
          );
          const filteredAllowed =
            filterPrestadores.length > 0
              ? allowedByLoja.filter((id) => filterPrestadores.includes(id))
              : allowedByLoja;
          if (filteredAllowed.length > 0) {
            if (filteredAllowed.length === 1) {
              accessOr.push(`prestador_id.eq.${filteredAllowed[0]}`);
            } else {
              accessOr.push(`prestador_id.in.(${filteredAllowed.join(",")})`);
            }
          }
        }
      }

      if (isSelfFilter) {
        accessOr.push(`user_id.eq.${user.id}`);
      }

      if (accessOr.length === 0) {
        throw new HttpError(403, "Voce nao possui permissao para acessar esses documentos.");
      }

      query = query.or(accessOr.join(","));
    }

    if (canAccess && filterPrestadores.length > 0) {
      if (filterPrestadores.length === 1) {
        query = query.eq("prestador_id", filterPrestadores[0]);
      } else {
        query = query.in("prestador_id", filterPrestadores);
      }
    }

    query = applyDateFilter(query, anoFilter, mesFilter);

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

    const rootMap = new Map<string, SubpastaNode>();
    const childMap = new Map<string, SubpastaNode>();

    const touchStats = (item: SubpastaNode, createdAt: string) => {
      item.totalDocumentos += 1;
      if (!item.ultimoEnvioAt || createdAt > item.ultimoEnvioAt) {
        item.ultimoEnvioAt = createdAt;
      }
    };

    rows.forEach((row) => {
      const tipo = row.tipo;
      const rootKey = `tipo:${tipo}`;
      if (!rootMap.has(rootKey)) {
        rootMap.set(rootKey, {
          key: rootKey,
          nome: TIPO_LABEL[tipo] ?? tipo,
          tipo,
          tipoLaudo: null,
          tipoLaudoValores: [],
          totalDocumentos: 0,
          ultimoEnvioAt: null,
          children: [],
        });
      }
      const root = rootMap.get(rootKey)!;
      touchStats(root, row.created_at);

      if (tipo === "registro_laudos") {
        const tipoLaudoOriginal = readTipoLaudo(row.dados);
        const resolved =
          tipoLaudoOriginal.length > 0
            ? resolveServicoOficial(tipoLaudoOriginal)
            : { canonical: "Sem tipo de laudo" };
        const tipoLaudoCanonical = resolved.canonical || "Sem tipo de laudo";
        const childKey = `tipo:${tipo}|laudo:${tipoLaudoCanonical.toLowerCase()}`;
        if (!childMap.has(childKey)) {
          childMap.set(childKey, {
            key: childKey,
            nome: tipoLaudoCanonical,
            tipo,
            tipoLaudo: tipoLaudoCanonical,
            tipoLaudoValores: [],
            totalDocumentos: 0,
            ultimoEnvioAt: null,
            children: [],
          });
        }
        const child = childMap.get(childKey)!;
        const valueForFilter =
          tipoLaudoOriginal.length > 0 ? tipoLaudoOriginal : tipoLaudoCanonical;
        if (!child.tipoLaudoValores.includes(valueForFilter)) {
          child.tipoLaudoValores.push(valueForFilter);
        }
        touchStats(child, row.created_at);
      }
    });

    const registroRoot = Array.from(rootMap.values()).find(
      (item) => item.tipo === "registro_laudos",
    );
    if (registroRoot) {
      const laudos = Array.from(childMap.values()).sort((a, b) =>
        a.nome.localeCompare(b.nome, "pt-BR"),
      );
      registroRoot.children = laudos;
    }

    const orderedTipos = ["retencao_trabalhista", "registro_laudos", "notas_fiscais"];
    const roots = Array.from(rootMap.values()).sort((a, b) => {
      const ai = orderedTipos.indexOf(a.tipo);
      const bi = orderedTipos.indexOf(b.tipo);
      if (ai === -1 && bi === -1) {
        return a.nome.localeCompare(b.nome, "pt-BR");
      }
      if (ai === -1) {
        return 1;
      }
      if (bi === -1) {
        return -1;
      }
      return ai - bi;
    });

    return NextResponse.json({ subpastas: roots });
  } catch (err) {
    console.error("Erro ao listar subpastas:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Erro ao listar subpastas.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
