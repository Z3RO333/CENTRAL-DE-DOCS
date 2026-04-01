import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { normalizeIds, sanitizeId, safeParseDados } from "@/lib/documentosApiUtils";
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

const parseDados = (raw: FormularioRow["dados"]) => safeParseDados(raw);

export async function GET(request: Request) {
  try {
    const user = await getSessionUserFromRequest(request);
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

    let query = supabaseAdmin
      .from("formularios")
      .select("created_at,status,dados,user_id,prestador_id", { count: "exact" })
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
        filterLojas,
      });
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
