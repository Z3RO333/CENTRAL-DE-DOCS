import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { normalizeIds, safeParseDados, sanitizeId } from "@/lib/documentosApiUtils";
import { resolveDateRange, toNullableArray } from "@/lib/documentosAggregateUtils";
import { resolveServicoOficial } from "@/lib/servicosVocab";
import { buildDocumentosAccessOr } from "@/lib/documentosAccessFilters";
import {
  ApiHttpError as HttpError,
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";

type FormularioRow = {
  created_at: string;
  tipo: string;
  dados: Record<string, unknown> | string | null;
  prestador_id: string | null;
  user_id: string;
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

type DateFilterQuery<T> = {
  gte: (column: string, value: string) => T;
  lt: (column: string, value: string) => T;
};

type SubpastaAggRow = {
  tipo: string;
  tipo_laudo: string | null;
  total_documentos: number;
  ultimo_envio_at: string | null;
};

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

const applyDateFilter = <T extends DateFilterQuery<T>>(
  query: T,
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

function buildSubpastasFromAgg(rows: SubpastaAggRow[]): SubpastaNode[] {
  const rootMap = new Map<string, SubpastaNode>();
  const childMap = new Map<string, SubpastaNode>();

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
    root.totalDocumentos += Number(row.total_documentos);
    if (
      row.ultimo_envio_at &&
      (!root.ultimoEnvioAt || row.ultimo_envio_at > root.ultimoEnvioAt)
    ) {
      root.ultimoEnvioAt = row.ultimo_envio_at;
    }

    if (tipo !== "registro_laudos") {
      return;
    }

    const tipoLaudoOriginal = row.tipo_laudo?.trim() ?? "";
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
    child.totalDocumentos += Number(row.total_documentos);
    if (
      row.ultimo_envio_at &&
      (!child.ultimoEnvioAt || row.ultimo_envio_at > child.ultimoEnvioAt)
    ) {
      child.ultimoEnvioAt = row.ultimo_envio_at;
    }
  });

  const registroRoot = Array.from(rootMap.values()).find(
    (item) => item.tipo === "registro_laudos",
  );
  if (registroRoot) {
    registroRoot.children = Array.from(childMap.values()).sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR"),
    );
  }

  const orderedTipos = ["retencao_trabalhista", "registro_laudos", "notas_fiscais"];
  return Array.from(rootMap.values()).sort((a, b) => {
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
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUserFromRequest(request);
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
    const { startAt, endAt } = resolveDateRange(anoFilter, mesFilter);

    if (canAccess) {
      const { data: aggregateData, error: aggregateError } =
        await supabaseAdmin.rpc("documentos_subpastas_agg", {
          p_loja_id: lojaId,
          p_user_id: filterUserId || null,
          p_prestador_ids: toNullableArray(filterPrestadores),
          p_start_at: startAt,
          p_end_at: endAt,
        });
      if (aggregateError) {
        throw aggregateError;
      }

      return NextResponse.json({
        subpastas: buildSubpastasFromAgg(
          (aggregateData as SubpastaAggRow[] | null) ?? [],
        ),
      });
    }

    let query = supabaseAdmin
      .from("formularios")
      .select("created_at,tipo,dados,user_id,prestador_id")
      .eq("dados->>loja_id", lojaId)
      .order("created_at", { ascending: false });

    if (filterUserId) {
      query = query.eq("user_id", filterUserId);
    }

    if (!canAccess) {
      const accessOr = buildDocumentosAccessOr({
        canAccess,
        allowedPrestadores,
        gerenteEntries,
        userId: user.id,
        filterUserId,
        filterPrestadores,
        filterLojas: [lojaId],
      });
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

    const rows: FormularioRow[] = [];
    let offset = 0;
    while (true) {
      const { data: batch, error } = await query.range(offset, offset + 999);
      if (error) {
        throw error;
      }
      const current = (batch as FormularioRow[]) ?? [];
      rows.push(...current);
      if (current.length < 1000) {
        break;
      }
      offset += 1000;
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
