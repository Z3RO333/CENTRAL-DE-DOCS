import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { safeParseDados, sanitizeId } from "@/lib/documentosApiUtils";
import { resolveDateRange, toNullableArray } from "@/lib/documentosAggregateUtils";
import {
  ApiHttpError as HttpError,
  getActorFromRequest,
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";
import { fixMojibakeText } from "@/lib/textEncoding";

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

type LojaAggRow = {
  loja_id: string;
  total_documentos: number;
  ultimo_envio_at: string | null;
};

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
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    const email = actor.email;
    const canAccess = actor.isAdmin;
    const gerenteEntries = await getGerenteAccessEntries(
      actor.userId,
      email,
      supabaseAdmin,
    );
    // Em simulação por email (sem user_id), filtra a agregação pelos prestadores
    // permitidos da identidade simulada.
    const allowedPrestadores =
      !canAccess && !actor.userId
        ? await getAuthorizedPrestadorIds(email, supabaseAdmin)
        : [];
    const hasGerenteAccess = gerenteEntries.length > 0;

    const { searchParams } = new URL(request.url);
    const filterUserId = searchParams.get("userId")?.trim() ?? "";
    const anoFilter = searchParams.get("ano");
    const mesFilter = searchParams.get("mes");
    const filterPrestadores = Array.from(
      new Set(
        searchParams
          .getAll("prestadorId")
          .map((value) => sanitizeId(value.trim()))
          .filter(Boolean),
      ),
    );
    const { startAt, endAt } = resolveDateRange(anoFilter, mesFilter);

    // Simulação por email sem prestador permitido e sem gerência → sem acesso
    if (!canAccess && !actor.userId && allowedPrestadores.length === 0 && !hasGerenteAccess) {
      return NextResponse.json({ lojas: [] });
    }

    if (canAccess || !hasGerenteAccess) {
      const { data: aggregateData, error: aggregateError } =
        await supabaseAdmin.rpc("documentos_lojas_agg", {
          p_user_id: canAccess ? filterUserId || null : actor.userId || null,
          p_prestador_ids: toNullableArray(
            filterPrestadores.length > 0 ? filterPrestadores : allowedPrestadores,
          ),
          p_start_at: startAt,
          p_end_at: endAt,
        });
      if (aggregateError) {
        throw aggregateError;
      }

      const groupedRows = (aggregateData as LojaAggRow[] | null) ?? [];
      const lojaIds = groupedRows
        .map((row) => sanitizeId(row.loja_id))
        .filter(Boolean);
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

      const statsMap = new Map(groupedRows.map((row) => [row.loja_id, row]));
      const lojas = ((lojasData as LojaRow[] | null) ?? []).map((loja) => {
        const stats = statsMap.get(loja.id);
        return {
          lojaId: loja.id,
          lojaNome: fixMojibakeText(loja.nome),
          lojaCodigo: loja.codigo ? fixMojibakeText(loja.codigo) : null,
          totalDocumentos: Number(stats?.total_documentos ?? 0),
          ultimoEnvioAt: stats?.ultimo_envio_at ?? null,
        };
      });

      return NextResponse.json({ lojas });
    }

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
      // Em simulação por email (sem user_id), não há "próprios" a resolver.
      if (!actor.userId) {
        return NextResponse.json({ lojas: [] });
      }
      query = query.eq("user_id", actor.userId);
    }

    if (filterPrestadores.length === 1) {
      query = query.eq("prestador_id", filterPrestadores[0]);
    } else if (filterPrestadores.length > 1) {
      query = query.in("prestador_id", filterPrestadores);
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
          lojaNome: loja?.nome ? fixMojibakeText(loja.nome) : "Loja",
          lojaCodigo: loja?.codigo ? fixMojibakeText(loja.codigo) : null,
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
