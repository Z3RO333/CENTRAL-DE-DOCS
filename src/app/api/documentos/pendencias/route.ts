import { NextResponse } from "next/server";
import { buildDocumentosAccessOr } from "@/lib/documentosAccessFilters";
import { safeParseDados } from "@/lib/documentosApiUtils";
import {
  ApiHttpError as HttpError,
  getActorFromRequest,
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
} from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { fixMojibakeText, normalizeDisplayData } from "@/lib/textEncoding";

type Row = {
  id: string;
  tipo: string;
  status: string;
  arquivo_path: string | null;
  arquivo_assinado_path: string | null;
  created_at: string;
  dados: Record<string, unknown> | string | null;
  prestador_id: string | null;
  user_id: string;
};

type PendenciaItem = {
  id: string;
  tipo: string;
  status: string;
  created_at: string;
  nome: string;
  lojaNome: string | null;
  prestadorNome: string | null;
  numeroNf: string | null;
  numeroPedido: string | null;
  diasEmAnalise: number | null;
};

const TIPO_ASSINAVEL = "registro_laudos";
const PAGE_SIZE = 1000;
const DIAS_EM_ANALISE_LIMITE = 7;

const getCampoTexto = (
  dados: Record<string, unknown> | null,
  campos: string[],
) => {
  if (!dados) {
    return null;
  }
  for (const campo of campos) {
    const value = dados[campo];
    if (typeof value === "string" && value.trim()) {
      return fixMojibakeText(value.trim());
    }
  }
  return null;
};

const getDocumentoNome = (row: Row, dados: Record<string, unknown> | null) => {
  const anexos = dados?.anexos;
  if (Array.isArray(anexos) && anexos.length > 0) {
    const primeiro = anexos[0] as { nome?: unknown } | null;
    if (primeiro?.nome && typeof primeiro.nome === "string") {
      return fixMojibakeText(primeiro.nome);
    }
  }
  const path = row.arquivo_assinado_path ?? row.arquivo_path;
  return path ? fixMojibakeText(path.split("/").pop() ?? path) : row.id;
};

const normalizeStatus = (row: Row) =>
  row.tipo !== TIPO_ASSINAVEL && row.status === "pendente"
    ? "em_analise"
    : row.status;

const buildItem = (row: Row, now: Date): PendenciaItem => {
  const dados = normalizeDisplayData(safeParseDados(row.dados)) as Record<
    string,
    unknown
  > | null;
  const createdAt = new Date(row.created_at);
  const diasEmAnalise = Number.isNaN(createdAt.getTime())
    ? null
    : Math.max(
        0,
        Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)),
      );

  return {
    id: row.id,
    tipo: row.tipo,
    status: normalizeStatus(row),
    created_at: row.created_at,
    nome: getDocumentoNome(row, dados),
    lojaNome: getCampoTexto(dados, ["loja_nome"]),
    prestadorNome: getCampoTexto(dados, ["prestador"]),
    numeroNf: getCampoTexto(dados, ["numero_nf"]),
    numeroPedido: getCampoTexto(dados, ["numero_pedido"]),
    diasEmAnalise,
  };
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
      .select(
        "id,tipo,status,arquivo_path,arquivo_assinado_path,created_at,dados,prestador_id,user_id",
        { count: "exact" },
      )
      .neq("tipo", "orcamentos_internos")
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
    const groups = {
      pendentesAssinatura: [] as PendenciaItem[],
      emAnaliseMuitosDias: [] as PendenciaItem[],
      semLoja: [] as PendenciaItem[],
      semPrestador: [] as PendenciaItem[],
      arquivoIndisponivel: [] as PendenciaItem[],
      disponiveisAssinaturaLote: [] as PendenciaItem[],
    };

    rows.forEach((row) => {
      const dados = normalizeDisplayData(safeParseDados(row.dados)) as Record<
        string,
        unknown
      > | null;
      const item = buildItem(row, now);
      const status = normalizeStatus(row);
      const lojaId =
        typeof dados?.loja_id === "string" ? dados.loja_id.trim() : "";
      const hasArquivo = Boolean(row.arquivo_path || row.arquivo_assinado_path);

      if (row.tipo === TIPO_ASSINAVEL && status !== "assinado") {
        groups.pendentesAssinatura.push(item);
      }
      if (
        status === "em_analise" &&
        (item.diasEmAnalise ?? 0) >= DIAS_EM_ANALISE_LIMITE
      ) {
        groups.emAnaliseMuitosDias.push(item);
      }
      if (!lojaId) {
        groups.semLoja.push(item);
      }
      if (!row.prestador_id) {
        groups.semPrestador.push(item);
      }
      if (!hasArquivo) {
        groups.arquivoIndisponivel.push(item);
      }
      if (row.tipo === TIPO_ASSINAVEL && status !== "assinado" && hasArquivo) {
        groups.disponiveisAssinaturaLote.push(item);
      }
    });

    const payload = Object.fromEntries(
      Object.entries(groups).map(([key, items]) => [
        key,
        {
          total: items.length,
          items: items.slice(0, 30),
          ids: items.map((item) => item.id),
        },
      ]),
    );

    return NextResponse.json({ grupos: payload });
  } catch (err) {
    console.error("Erro ao carregar pendencias de documentos:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel carregar as pendencias.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
