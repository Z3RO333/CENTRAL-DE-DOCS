import { NextResponse } from "next/server";
import { buildDocumentosAccessOr } from "@/lib/documentosAccessFilters";
import { normalizeIds, sanitizeId } from "@/lib/documentosApiUtils";
import {
  ApiHttpError as HttpError,
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

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
  ano: string | null;
  mes: string | null;
  totalDocumentos: number;
  ultimoEnvioAt: string | null;
  children: SubpastaNode[];
};

type DateFilterQuery<T> = {
  gte: (column: string, value: string) => T;
  lt: (column: string, value: string) => T;
};

const PAGE_SIZE = 1000;

const TIPO_LABEL: Record<string, string> = {
  retencao_trabalhista: "Retencao Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
};

const MESES: Record<string, string> = {
  "01": "Janeiro",
  "02": "Fevereiro",
  "03": "Marco",
  "04": "Abril",
  "05": "Maio",
  "06": "Junho",
  "07": "Julho",
  "08": "Agosto",
  "09": "Setembro",
  "10": "Outubro",
  "11": "Novembro",
  "12": "Dezembro",
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
      return query
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString());
    }
    return query;
  }
  const start = new Date(ano, 0, 1);
  const end = new Date(ano + 1, 0, 1);
  return query
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
};

const touchStats = (node: SubpastaNode, createdAt: string) => {
  node.totalDocumentos += 1;
  if (!node.ultimoEnvioAt || createdAt > node.ultimoEnvioAt) {
    node.ultimoEnvioAt = createdAt;
  }
};

const createNode = (input: {
  key: string;
  nome: string;
  tipo: string;
  ano?: string | null;
  mes?: string | null;
}): SubpastaNode => ({
  key: input.key,
  nome: input.nome,
  tipo: input.tipo,
  tipoLaudo: null,
  tipoLaudoValores: [],
  ano: input.ano ?? null,
  mes: input.mes ?? null,
  totalDocumentos: 0,
  ultimoEnvioAt: null,
  children: [],
});

function buildExplorerFromRows(rows: FormularioRow[]): SubpastaNode[] {
  const tipoMap = new Map<string, SubpastaNode>();
  const monthMap = new Map<string, SubpastaNode>();

  rows.forEach((row) => {
    const tipo = row.tipo;
    const tipoKey = `tipo:${tipo}`;
    if (!tipoMap.has(tipoKey)) {
      tipoMap.set(
        tipoKey,
        createNode({
          key: tipoKey,
          nome: TIPO_LABEL[tipo] ?? tipo,
          tipo,
        }),
      );
    }

    const tipoNode = tipoMap.get(tipoKey)!;
    touchStats(tipoNode, row.created_at);

    const createdAt = new Date(row.created_at);
    if (Number.isNaN(createdAt.getTime())) {
      return;
    }

    const ano = String(createdAt.getFullYear());
    const mes = String(createdAt.getMonth() + 1).padStart(2, "0");
    const monthKey = `${tipoKey}|periodo:${ano}-${mes}`;
    if (!monthMap.has(monthKey)) {
      const monthNode = createNode({
        key: monthKey,
        nome: `${MESES[mes] ?? mes}/${ano}`,
        tipo,
        ano,
        mes,
      });
      monthMap.set(monthKey, monthNode);
      tipoNode.children.push(monthNode);
    }
    touchStats(monthMap.get(monthKey)!, row.created_at);
  });

  const orderedTipos = ["retencao_trabalhista", "registro_laudos", "notas_fiscais"];
  return Array.from(tipoMap.values())
    .map((node) => ({
      ...node,
      children: node.children.sort((a, b) => {
        const dateA = `${a.ano ?? "0000"}-${a.mes ?? "00"}`;
        const dateB = `${b.ano ?? "0000"}-${b.mes ?? "00"}`;
        return dateB.localeCompare(dateA);
      }),
    }))
    .sort((a, b) => {
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
    const gerenteEntries = await getGerenteAccessEntries(
      user.id,
      email,
      supabaseAdmin,
    );

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

    let query = supabaseAdmin
      .from("formularios")
      .select("created_at,tipo,dados,user_id,prestador_id", { count: "exact" })
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
        filterUserId: filterUserId || user.id,
        filterPrestadores,
        filterLojas: [lojaId],
      });
      query = query.or(accessOr.join(","));
    } else if (filterPrestadores.length > 0) {
      if (filterPrestadores.length === 1) {
        query = query.eq("prestador_id", filterPrestadores[0]);
      } else {
        query = query.in("prestador_id", filterPrestadores);
      }
    }

    query = applyDateFilter(query, anoFilter, mesFilter);

    const { data: firstPage, error, count } = await query.range(
      0,
      PAGE_SIZE - 1,
    );
    if (error) {
      throw error;
    }

    const rows = ((firstPage as FormularioRow[]) ?? []) as FormularioRow[];
    const total = count ?? rows.length;
    for (let offset = rows.length; offset < total; offset += PAGE_SIZE) {
      const { data: batch, error: batchError } = await query.range(
        offset,
        Math.min(offset + PAGE_SIZE - 1, total - 1),
      );
      if (batchError) {
        throw batchError;
      }
      rows.push(...(((batch as FormularioRow[]) ?? []) as FormularioRow[]));
    }

    return NextResponse.json({ subpastas: buildExplorerFromRows(rows) });
  } catch (err) {
    console.error("Erro ao listar explorador de loja:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Erro ao listar explorador de loja.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
