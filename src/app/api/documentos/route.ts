import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  buildDocumentosTextSearchOr,
  normalizeIds,
  resolveLimit,
  safeParseDados,
  sanitizeId,
} from "@/lib/documentosApiUtils";
import { getCompetenciaFromDados } from "@/lib/competencia";
import { buildDocumentosAccessOr } from "@/lib/documentosAccessFilters";
import {
  ApiHttpError as HttpError,
  getActorFromRequest,
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";
import { normalizeDisplayData } from "@/lib/textEncoding";

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

const PAGE_SIZE = 1000;

function getPeriodoDocumento(row: FormularioRow): { ano: string; mes: string } | null {
  const competencia = getCompetenciaFromDados(safeParseDados(row.dados));
  if (competencia) {
    return { ano: competencia.ano, mes: competencia.mes };
  }

  const createdAt = new Date(row.created_at);
  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  return {
    ano: String(createdAt.getFullYear()),
    mes: String(createdAt.getMonth() + 1).padStart(2, "0"),
  };
}

function matchesPeriodo(
  row: FormularioRow,
  anoFilter: string | null,
  mesFilter: string | null,
) {
  if (!anoFilter || anoFilter === "todos") {
    return true;
  }

  const periodo = getPeriodoDocumento(row);
  if (!periodo || periodo.ano !== anoFilter) {
    return false;
  }

  if (!mesFilter || mesFilter === "todos") {
    return true;
  }

  return periodo.mes === mesFilter.padStart(2, "0");
}

function mapRows(rows: FormularioRow[]): DocumentRecord[] {
  return rows.map((item) => ({
    id: item.id,
    tipo: item.tipo,
    status: item.status,
    arquivo_path: item.arquivo_path,
    arquivo_assinado_path: item.arquivo_assinado_path ?? null,
    created_at: item.created_at,
    dados: normalizeDisplayData(safeParseDados(item.dados)) as Record<
      string,
      unknown
    > | null,
    assinado_por: item.assinado_por ?? null,
    user_id: item.user_id,
    prestador_id: item.prestador_id ?? null,
  }));
}

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    const email = actor.email;
    const allowedPrestadores = await getAuthorizedPrestadorIds(
      email,
      supabaseAdmin,
    );
    const gerenteEntries = await getGerenteAccessEntries(
      actor.userId,
      email,
      supabaseAdmin,
    );

    const canAccess = actor.isAdmin;
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
    const userFilter = filterUserId;

    let query = supabaseAdmin
      .from("formularios")
      .select(
        "id,tipo,status,arquivo_path,arquivo_assinado_path,created_at,dados,assinado_por,user_id,prestador_id",
        { count: "exact" },
      )
      .neq("tipo", "orcamentos_internos")
      .order("created_at", { ascending: false });

    if (tipoFilter !== "contratos") {
      query = query.neq("tipo", "contratos");
    }

    const categoriaPrestadorFilter = searchParams.get("categoriaPrestador");
    const {
      data: prestadoresConservacao,
      error: prestadoresConservacaoError,
    } = await supabaseAdmin
      .from("prestadores")
      .select("id")
      .eq("categoria", "conservacao");
    if (prestadoresConservacaoError) {
      throw prestadoresConservacaoError;
    }
    const conservacaoIds = ((prestadoresConservacao ?? []) as { id: string }[]).map(
      (item) => item.id,
    );

    if (categoriaPrestadorFilter === "conservacao") {
      query =
        conservacaoIds.length > 0
          ? query.in("prestador_id", conservacaoIds)
          : query.eq("prestador_id", "00000000-0000-0000-0000-000000000000");
    } else if (conservacaoIds.length > 0) {
      query = query.or(
        `prestador_id.is.null,prestador_id.not.in.(${conservacaoIds.join(",")})`,
      );
    }

    if (userFilter) {
      query = query.eq("user_id", userFilter);
    }

    if (!canAccess) {
      const accessOr = buildDocumentosAccessOr({
        canAccess,
        allowedPrestadores,
        gerenteEntries,
        userId: actor.userId,
        filterUserId: userFilter,
        filterPrestadores,
        filterLojas,
      });
      query = query.or(accessOr.join(","));
    }

    if (filterPrestadores.length === 1) {
      query = query.eq("prestador_id", filterPrestadores[0]);
    } else if (filterPrestadores.length > 1) {
      query = query.in("prestador_id", filterPrestadores);
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

    const filtrarPeriodoEmMemoria = Boolean(
      anoFilter && anoFilter !== "todos",
    );

    if (identificacaoFilter) {
      const textSearchOr = buildDocumentosTextSearchOr(identificacaoFilter);
      if (textSearchOr) {
        query = query.or(textSearchOr.join(","));
      }
    }

    if (!filtrarPeriodoEmMemoria) {
      query = query.range(offset, offset + limit - 1);
    }

    const { data, error, count } = filtrarPeriodoEmMemoria
      ? await query.range(0, PAGE_SIZE - 1)
      : await query;
    if (error) {
      throw error;
    }

    if (filtrarPeriodoEmMemoria) {
      const rows = ((data as FormularioRow[]) ?? []) as FormularioRow[];
      const totalRaw = count ?? rows.length;

      for (let nextOffset = rows.length; nextOffset < totalRaw; nextOffset += PAGE_SIZE) {
        const { data: batch, error: batchError } = await query.range(
          nextOffset,
          Math.min(nextOffset + PAGE_SIZE - 1, totalRaw - 1),
        );
        if (batchError) {
          throw batchError;
        }
        rows.push(...(((batch as FormularioRow[]) ?? []) as FormularioRow[]));
      }

      const filtrados = rows.filter((row) =>
        matchesPeriodo(row, anoFilter, mesFilter),
      );

      return NextResponse.json({
        registros: mapRows(filtrados.slice(offset, offset + limit)),
        total: filtrados.length,
      });
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
    const user = await getSessionUserFromRequest(request);
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
    const user = await getSessionUserFromRequest(request);
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
      status?: string;
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
    const hasStatusUpdate = Object.prototype.hasOwnProperty.call(body, "status");

    if (
      !id ||
      (!hasDadosUpdates && !hasLojaUpdate && !hasPrestadorUpdate && !hasStatusUpdate)
    ) {
      throw new HttpError(400, "Informe o id e os dados para atualizacao.");
    }

    const { data: registro, error: registroError } = await supabaseAdmin
      .from("formularios")
      .select("id,tipo,status,dados,prestador_id")
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
      status?: string;
      assinado_por?: string | null;
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

    if (hasStatusUpdate) {
      const nextStatus =
        typeof body.status === "string" ? body.status.trim() : "";
      if (nextStatus !== "revisado") {
        throw new HttpError(
          400,
          "Status inválido para esta operação.",
        );
      }
      if (registro.tipo === "registro_laudos") {
        throw new HttpError(
          400,
          "Documentos assináveis devem ser tratados pelo fluxo de assinatura.",
        );
      }
      if (registro.status === "assinado") {
        throw new HttpError(400, "Documento já assinado não pode ser revisado.");
      }
      updatePayload.status = nextStatus;
      updatePayload.assinado_por = null;
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


