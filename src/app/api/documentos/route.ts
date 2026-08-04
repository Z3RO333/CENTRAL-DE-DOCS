import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  buildDocumentosTextSearchOr,
  normalizeIds,
  resolveLimit,
  resumirAchadosCriticosPorDocumento,
  safeParseDados,
  sanitizeId,
} from "@/lib/documentosApiUtils";
import type { AchadoCriticoResumo } from "@/lib/documentosApiUtils";
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
import { getAprovadorEmails, normalizeEmail } from "@/lib/orcamentosInternos";

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
  status_analise_ia?: string | null;
  equipamento_id?: string | null;
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
  status_analise_ia: string | null;
  equipamento_id: string | null;
  achado_critico: AchadoCriticoResumo | null;
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
    status_analise_ia: item.status_analise_ia ?? null,
    equipamento_id: item.equipamento_id ?? null,
    achado_critico: null,
  }));
}

async function anexarAchadosCriticos(
  supabaseAdmin: SupabaseClient,
  registros: DocumentRecord[],
): Promise<DocumentRecord[]> {
  if (registros.length === 0) {
    return registros;
  }

  const ids = registros.map((registro) => registro.id);
  const { data, error } = await supabaseAdmin
    .from("documento_recomendacoes_criticas")
    .select("documento_id,problema,prioridade")
    .in("documento_id", ids)
    .in("prioridade", ["emergencial", "critica"]);

  if (error) {
    console.error("Erro ao buscar achados críticos:", error);
    return registros;
  }

  const resumoPorDocumento = resumirAchadosCriticosPorDocumento(
    (data ?? []) as Array<{
      documento_id: string;
      problema: string;
      prioridade: string;
    }>,
  );

  return registros.map((registro) => ({
    ...registro,
    achado_critico: resumoPorDocumento[registro.id] ?? null,
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

    const { searchParams } = new URL(request.url);
    const globalSearch = searchParams.get("globalSearch") === "true";
    const categoriaPrestadorFilter = searchParams.get("categoriaPrestador");
    let isAprovadorInternoConservacao = false;
    if (!actor.isAdmin && categoriaPrestadorFilter === "conservacao") {
      const actorEmail = normalizeEmail(email);
      const aprovadores = await getAprovadorEmails(supabaseAdmin);
      isAprovadorInternoConservacao =
        actorEmail !== null && aprovadores.has(actorEmail);
    }
    const canAccess = actor.isAdmin || isAprovadorInternoConservacao;
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
    const statusAnaliseIaFilter = searchParams.get("statusAnaliseIa");
    const anoFilter = searchParams.get("ano");
    const mesFilter = searchParams.get("mes");
    const identificacaoFilter = searchParams.get("identificacao")?.trim() ?? "";
    const somenteAssinados = searchParams.get("somenteAssinados") === "true";
    const somenteDisponiveisLote =
      searchParams.get("somenteDisponiveisLote") === "true";
    const offsetParam = Number(searchParams.get("offset"));
    const limit = resolveLimit(searchParams.get("limit"));
    const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;
    const userFilter =
      globalSearch &&
      !actor.isAdmin &&
      allowedPrestadores.length === 0 &&
      gerenteEntries.length === 0
        ? actor.userId
        : filterUserId;

    let query = supabaseAdmin
      .from("formularios")
      .select(
        "id,tipo,status,arquivo_path,arquivo_assinado_path,created_at,dados,assinado_por,user_id,prestador_id,status_analise_ia,equipamento_id",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });

    if (!globalSearch) {
      query = query.neq("tipo", "orcamentos_internos");
    }

    if (!globalSearch && tipoFilter !== "contratos") {
      query = query.neq("tipo", "contratos");
    }

    if (!globalSearch && tipoFilter !== "notas_fiscais_conservacao") {
      query = query.neq("tipo", "notas_fiscais_conservacao");
    }

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

    let idsComAchadoCritico: string[] | null = null;
    if (statusAnaliseIaFilter === "achado_critico") {
      const { data: achadosCriticos, error: achadosCriticosError } =
        await supabaseAdmin
          .from("documento_recomendacoes_criticas")
          .select("documento_id")
          .in("prioridade", ["emergencial", "critica"]);
      if (achadosCriticosError) {
        throw achadosCriticosError;
      }
      idsComAchadoCritico = Array.from(
        new Set(
          ((achadosCriticos ?? []) as { documento_id: string }[]).map(
            (item) => item.documento_id,
          ),
        ),
      );
    }

    if (categoriaPrestadorFilter === "conservacao") {
      query =
        conservacaoIds.length > 0
          ? query.in("prestador_id", conservacaoIds)
          : query.eq("prestador_id", "00000000-0000-0000-0000-000000000000");
      if (tipoFilter !== "notas_fiscais") {
        query = query.neq("tipo", "notas_fiscais");
      }
    } else if (!globalSearch && conservacaoIds.length > 0) {
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

    if (statusAnaliseIaFilter === "achado_critico") {
      query =
        idsComAchadoCritico && idsComAchadoCritico.length > 0
          ? query.in("id", idsComAchadoCritico)
          : query.eq("id", "00000000-0000-0000-0000-000000000000");
    } else if (statusAnaliseIaFilter && statusAnaliseIaFilter !== "todos") {
      query = query.eq("status_analise_ia", statusAnaliseIaFilter);
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

      const registrosComAchados = await anexarAchadosCriticos(
        supabaseAdmin,
        mapRows(filtrados.slice(offset, offset + limit)),
      );
      return NextResponse.json({
        registros: registrosComAchados,
        total: filtrados.length,
      });
    }

    const registrosComAchados = await anexarAchadosCriticos(
      supabaseAdmin,
      mapRows((data as FormularioRow[]) ?? []),
    );
    return NextResponse.json({
      registros: registrosComAchados,
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
      equipamentoId?: string | null;
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
    const hasEquipamentoUpdate = Object.prototype.hasOwnProperty.call(
      body,
      "equipamentoId",
    );
    const hasStatusUpdate = Object.prototype.hasOwnProperty.call(body, "status");

    if (
      !id ||
      (!hasDadosUpdates &&
        !hasLojaUpdate &&
        !hasPrestadorUpdate &&
        !hasEquipamentoUpdate &&
        !hasStatusUpdate)
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
      equipamento_id?: string | null;
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

      if (!hasEquipamentoUpdate) {
        updatePayload.equipamento_id = null;
      }
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

    if (hasEquipamentoUpdate) {
      const equipamentoId = sanitizeId((body.equipamentoId ?? "").trim());
      if (!equipamentoId) {
        updatePayload.equipamento_id = null;
      } else {
        const { data: equipamento, error: equipamentoError } = await supabaseAdmin
          .from("equipamentos")
          .select("id,loja_id")
          .eq("id", equipamentoId)
          .maybeSingle();
        if (equipamentoError) {
          throw equipamentoError;
        }
        if (!equipamento) {
          throw new HttpError(404, "Equipamento nao encontrado.");
        }

        const lojaIdParaValidar = hasLojaUpdate
          ? (updatePayload.dados.loja_id as string | undefined)
          : (safeParseDados(registro.dados)?.loja_id as string | undefined);

        if (lojaIdParaValidar && equipamento.loja_id !== lojaIdParaValidar) {
          throw new HttpError(400, "Equipamento nao pertence a loja do documento.");
        }

        updatePayload.equipamento_id = equipamento.id;
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
        "id,tipo,status,arquivo_path,arquivo_assinado_path,created_at,dados,assinado_por,user_id,prestador_id,status_analise_ia,equipamento_id",
      )
      .maybeSingle();
    if (updateError) {
      throw updateError;
    }

    const registroComAchado = updated
      ? (
          await anexarAchadosCriticos(
            supabaseAdmin,
            mapRows([updated as FormularioRow]),
          )
        )[0]
      : null;

    return NextResponse.json({
      registro: registroComAchado,
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


