import { NextResponse } from "next/server";
import { buildDocumentosAccessOr } from "@/lib/documentosAccessFilters";
import { safeParseDados } from "@/lib/documentosApiUtils";
import {
  ApiHttpError as HttpError,
  getActorFromRequest,
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

type Row = {
  id: string;
  tipo: string;
  status: string;
  created_at: string;
  dados: Record<string, unknown> | string | null;
  prestador_id: string | null;
  user_id: string;
};

const TIPO_ASSINAVEL = "registro_laudos";
const PAGE_SIZE = 1000;

const normalizeStatus = (row: Row) =>
  row.tipo !== TIPO_ASSINAVEL && row.status === "pendente"
    ? "em_analise"
    : row.status;

const hasLojaVinculada = (row: Row) => {
  const dados = safeParseDados(row.dados);
  const lojaId = typeof dados?.loja_id === "string" ? dados.loja_id.trim() : "";
  return Boolean(lojaId);
};

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    const email = actor.email;
    const allowedPrestadores = await getAuthorizedPrestadorIds(email, supabaseAdmin);
    const gerenteEntries = await getGerenteAccessEntries(
      actor.userId,
      email,
      supabaseAdmin,
    );
    const canAccess = actor.isAdmin;

    let query = supabaseAdmin
      .from("formularios")
      .select("id,tipo,status,created_at,dados,prestador_id,user_id", {
        count: "exact",
      })
      .order("created_at", { ascending: false });

    if (!canAccess) {
      const accessOr = buildDocumentosAccessOr({
        canAccess,
        allowedPrestadores,
        gerenteEntries,
        userId: actor.userId,
        filterUserId: actor.userId,
        filterPrestadores: [],
        filterLojas: [],
      });
      query = query.or(accessOr.join(","));
    }

    const { data: firstPage, error, count } = await query.range(
      0,
      PAGE_SIZE - 1,
    );
    if (error) {
      throw error;
    }

    const rows = ((firstPage as Row[]) ?? []) as Row[];
    const total = count ?? rows.length;
    for (let offset = rows.length; offset < total; offset += PAGE_SIZE) {
      const { data: batch, error: batchError } = await query.range(
        offset,
        Math.min(offset + PAGE_SIZE - 1, total - 1),
      );
      if (batchError) {
        throw batchError;
      }
      rows.push(...(((batch as Row[]) ?? []) as Row[]));
    }

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const kpis = rows.reduce(
      (acc, row) => {
        const status = normalizeStatus(row);
        const createdAt = new Date(row.created_at);
        acc.totalDocumentos += 1;
        if (status === "pendente") {
          acc.pendentes += 1;
        }
        if (status === "em_analise") {
          acc.emAnalise += 1;
        }
        if (status === "assinado") {
          acc.assinados += 1;
        }
        if (!hasLojaVinculada(row)) {
          acc.semLoja += 1;
        }
        if (!row.prestador_id) {
          acc.semPrestador += 1;
        }
        if (!Number.isNaN(createdAt.getTime())) {
          if (createdAt >= todayStart && createdAt <= todayEnd) {
            acc.enviadosHoje += 1;
          }
          if (createdAt >= monthStart && createdAt < nextMonthStart) {
            acc.enviadosNoMes += 1;
          }
        }
        if (row.tipo === TIPO_ASSINAVEL && status !== "assinado") {
          acc.aguardandoAssinatura += 1;
        }
        return acc;
      },
      {
        totalDocumentos: 0,
        pendentes: 0,
        emAnalise: 0,
        assinados: 0,
        semLoja: 0,
        semPrestador: 0,
        enviadosHoje: 0,
        enviadosNoMes: 0,
        aguardandoAssinatura: 0,
      },
    );

    return NextResponse.json({ kpis });
  } catch (err) {
    console.error("Erro ao carregar KPIs de documentos:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel carregar os KPIs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
