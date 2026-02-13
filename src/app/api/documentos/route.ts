import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  normalizeIds,
  resolveLimit,
  safeParseDados,
  sanitizeId,
} from "@/lib/documentosApiUtils";

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

  const {
    data: emailData,
    error: emailError,
  } = await supabaseAdmin
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

function mapRows(rows: FormularioRow[]): DocumentRecord[] {
  return rows.map((item) => ({
    id: item.id,
    tipo: item.tipo,
    status: item.status,
    arquivo_path: item.arquivo_path,
    arquivo_assinado_path: item.arquivo_assinado_path ?? null,
    created_at: item.created_at,
    dados: safeParseDados(item.dados),
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
    const gerenteEntries = await getGerenteAccessEntries(
      user.id,
      email,
      supabaseAdmin,
    );

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    const { searchParams } = new URL(request.url);
    const filterUserId = searchParams.get("userId");
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
    const tipoFilter = searchParams.get("tipo");
    const tipoLaudoFilter = searchParams.get("tipoLaudo");
    const tipoLaudoFilters = Array.from(
      new Set(
        searchParams
          .getAll("tipoLaudo")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
    const statusFilter = searchParams.get("status");
    const anoFilter = searchParams.get("ano");
    const mesFilter = searchParams.get("mes");
    const identificacaoFilter = searchParams.get("identificacao")?.trim() ?? "";
    const somenteAssinados = searchParams.get("somenteAssinados") === "true";
    const somenteDisponiveisLote =
      searchParams.get("somenteDisponiveisLote") === "true";
    const offsetParam = Number(searchParams.get("offset"));
    const limit = resolveLimit(searchParams.get("limit"));
    const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;
    let userFilter = filterUserId;

    const hasPrestadorAccess = allowedPrestadores.length > 0;
    const hasGerenteAccess = gerenteEntries.length > 0;
    const isSelfFilter = userFilter && userFilter === user.id;

    if (!canAccess && !hasPrestadorAccess && !hasGerenteAccess && !isSelfFilter) {
      throw new HttpError(
        403,
        "Voce nao possui permissao para remover este documento.",
      );
    }

    let query = supabaseAdmin
      .from("formularios")
      .select(
        "id,tipo,status,arquivo_path,arquivo_assinado_path,created_at,dados,assinado_por,user_id,prestador_id",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });

    if (userFilter) {
      query = query.eq("user_id", userFilter);
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

    if (tipoFilter && tipoFilter !== "todos") {
      query = query.eq("tipo", tipoFilter);
    }

    if (tipoLaudoFilters.length > 1) {
      query = query.in("dados->>tipo_laudo", tipoLaudoFilters);
    } else if (tipoLaudoFilter && tipoLaudoFilter !== "todos") {
      query = query.eq("dados->>tipo_laudo", tipoLaudoFilter);
    }

    if (statusFilter && statusFilter !== "todos") {
      query = query.eq("status", statusFilter);
    }

    if (somenteAssinados) {
      query = query.eq("status", "assinado");
    }

    if (somenteDisponiveisLote) {
      query = query.eq("tipo", "registro_laudos").neq("status", "assinado");
    }

    if (filterLojas.length === 1) {
      query = query.eq("dados->>loja_id", filterLojas[0]);
    } else if (filterLojas.length > 1) {
      query = query.or(
        filterLojas.map((lojaId) => `dados->>loja_id.eq.${lojaId}`).join(","),
      );
    }

    if (anoFilter && anoFilter !== "todos") {
      const ano = Number(anoFilter);
      if (!Number.isNaN(ano)) {
        if (mesFilter && mesFilter !== "todos") {
          const mes = Number(mesFilter);
          if (!Number.isNaN(mes) && mes >= 1 && mes <= 12) {
            const start = new Date(ano, mes - 1, 1);
            const end = new Date(ano, mes, 1);
            query = query
              .gte("created_at", start.toISOString())
              .lt("created_at", end.toISOString());
          }
        } else {
          const start = new Date(ano, 0, 1);
          const end = new Date(ano + 1, 0, 1);
          query = query
            .gte("created_at", start.toISOString())
            .lt("created_at", end.toISOString());
        }
      }
    }

    if (identificacaoFilter) {
      const sanitized = identificacaoFilter.replace(/,/g, " ").trim();
      if (sanitized) {
        const pattern = `%${sanitized}%`;
        query = query.or(
          [
            `dados->>empresa.ilike.${pattern}`,
            `dados->>prestador.ilike.${pattern}`,
            `dados->>responsavel.ilike.${pattern}`,
            `dados->>numero_pedido.ilike.${pattern}`,
          ].join(","),
        );
      }
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      throw error;
    }

    return NextResponse.json({
      registros: mapRows((data as FormularioRow[]) ?? []),
      total: count ?? 0,
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
      throw new HttpError(
        403,
        "Voce nao possui permissao para remover este documento.",
      );
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

export async function PATCH(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();
    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);

    if (!canAccess) {
      throw new HttpError(403, "Ação restrita para administradores.");
    }

    const body = (await request.json()) as {
      id?: string;
      updates?: Record<string, unknown>;
      lojaId?: string | null;
      prestadorId?: string | null;
    };
    const id = body.id?.trim();
    const hasDadosUpdates =
      body.updates &&
      typeof body.updates === "object" &&
      Object.keys(body.updates).length > 0;
    const hasLojaUpdate = Object.prototype.hasOwnProperty.call(body, "lojaId");
    const hasPrestadorUpdate = Object.prototype.hasOwnProperty.call(
      body,
      "prestadorId",
    );

    if (!id || (!hasDadosUpdates && !hasLojaUpdate && !hasPrestadorUpdate)) {
      throw new HttpError(400, "Informe o id e os dados para atualizacao.");
    }

    const { data: registro, error: registroError } = await supabaseAdmin
      .from("formularios")
      .select("id,dados,prestador_id")
      .eq("id", id)
      .maybeSingle();
    if (registroError) {
      throw registroError;
    }
    if (!registro) {
      throw new HttpError(404, "Documento não encontrado.");
    }

    const dadosAtuais = safeParseDados(registro.dados) ?? {};
    const updates = hasDadosUpdates ? body.updates ?? {} : {};
    const dadosAtualizados = {
      ...dadosAtuais,
      ...updates,
      edited_by: email ?? user.id,
      edited_at: new Date().toISOString(),
    };
    const updatePayload: {
      dados: Record<string, unknown>;
      prestador_id?: string | null;
    } = {
      dados: dadosAtualizados,
    };

    if (hasLojaUpdate) {
      const lojaId = sanitizeId((body.lojaId ?? "").trim());
      if (!lojaId) {
        throw new HttpError(400, "Informe uma loja valida.");
      }

      const { data: loja, error: lojaError } = await supabaseAdmin
        .from("lojas")
        .select("id,nome")
        .eq("id", lojaId)
        .maybeSingle();
      if (lojaError) {
        throw lojaError;
      }
      if (!loja) {
        throw new HttpError(404, "Loja nao encontrada.");
      }

      updatePayload.dados.loja_id = loja.id;
      updatePayload.dados.loja_nome =
        typeof loja.nome === "string" ? loja.nome : "Loja";
    }

    if (hasPrestadorUpdate) {
      const prestadorId = sanitizeId((body.prestadorId ?? "").trim());
      if (!prestadorId) {
        updatePayload.prestador_id = null;
        delete updatePayload.dados.prestador;
      } else {
        const { data: prestador, error: prestadorError } = await supabaseAdmin
          .from("prestadores")
          .select("id,nome")
          .eq("id", prestadorId)
          .maybeSingle();
        if (prestadorError) {
          throw prestadorError;
        }
        if (!prestador) {
          throw new HttpError(404, "Prestador nao encontrado.");
        }
        updatePayload.prestador_id = prestador.id;
        updatePayload.dados.prestador =
          typeof prestador.nome === "string" ? prestador.nome : prestador.id;
      }
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("formularios")
      .update(updatePayload)
      .eq("id", id)
      .select(
        "id,tipo,status,arquivo_path,arquivo_assinado_path,created_at,dados,assinado_por,user_id,prestador_id",
      )
      .maybeSingle();
    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      registro: updated ? mapRows([updated as FormularioRow])[0] : null,
    });
  } catch (err) {
    console.error("Erro ao atualizar documento:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível atualizar o documento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


