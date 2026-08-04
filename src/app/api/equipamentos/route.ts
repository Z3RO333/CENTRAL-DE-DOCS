import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  ApiHttpError as HttpError,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";

const SELECT_COLUMNS =
  "id,loja_id,tipo_equipamento,identificacao,marca,modelo,numero_serie,potencia,localizacao,prestador_id,documento_tipo_obrigatorio,data_instalacao,data_ativacao,data_desativacao,status,atributos,origem_importacao,created_at,updated_at,frequencia";

const STATUS_VALIDOS = ["ativo", "inativo"] as const;
const FREQUENCIA_VALIDAS = ["mensal", "semestral", "anual"] as const;

type EquipamentoInput = {
  loja_id?: string;
  tipo_equipamento?: string;
  identificacao?: string | null;
  marca?: string | null;
  modelo?: string | null;
  numero_serie?: string | null;
  potencia?: string | null;
  localizacao?: string | null;
  prestador_id?: string | null;
  documento_tipo_obrigatorio?: string | null;
  data_instalacao?: string | null;
  data_ativacao?: string | null;
  data_desativacao?: string | null;
  status?: string;
  atributos?: Record<string, unknown>;
  frequencia?: string;
};

function sanitizeText(value: string | null | undefined): string | null {
  if (value === undefined) return null;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(403, "Voce nao possui permissao para consultar equipamentos.");
    }

    const { searchParams } = new URL(request.url);
    const lojaId = searchParams.get("lojaId")?.trim();

    let query = supabaseAdmin
      .from("equipamentos")
      .select(SELECT_COLUMNS)
      .order("tipo_equipamento", { ascending: true });

    if (lojaId) {
      query = query.eq("loja_id", lojaId);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    return NextResponse.json({ equipamentos: data ?? [] });
  } catch (err) {
    console.error("Erro ao buscar equipamentos:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel carregar os equipamentos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(403, "Voce nao possui permissao para cadastrar equipamentos.");
    }

    const body = (await request.json()) as EquipamentoInput;

    const lojaId = body.loja_id?.trim();
    const tipoEquipamento = sanitizeText(body.tipo_equipamento);

    if (!lojaId) {
      throw new HttpError(400, "Informe a loja do equipamento.");
    }
    if (!tipoEquipamento) {
      throw new HttpError(400, "Informe o tipo do equipamento.");
    }
    if (body.status !== undefined && !STATUS_VALIDOS.includes(body.status as never)) {
      throw new HttpError(400, "Status invalido.");
    }
    if (body.frequencia !== undefined && !FREQUENCIA_VALIDAS.includes(body.frequencia as never)) {
      throw new HttpError(400, "Frequencia invalida.");
    }

    const { data, error } = await supabaseAdmin
      .from("equipamentos")
      .insert({
        loja_id: lojaId,
        tipo_equipamento: tipoEquipamento,
        identificacao: sanitizeText(body.identificacao),
        marca: sanitizeText(body.marca),
        modelo: sanitizeText(body.modelo),
        numero_serie: sanitizeText(body.numero_serie),
        potencia: sanitizeText(body.potencia),
        localizacao: sanitizeText(body.localizacao),
        prestador_id: body.prestador_id?.trim() || null,
        documento_tipo_obrigatorio: sanitizeText(body.documento_tipo_obrigatorio),
        data_instalacao: body.data_instalacao || null,
        data_ativacao: body.data_ativacao || null,
        data_desativacao: body.data_desativacao || null,
        status: body.status ?? "ativo",
        atributos: body.atributos ?? {},
        frequencia: FREQUENCIA_VALIDAS.includes(body.frequencia as never)
          ? body.frequencia
          : "mensal",
        created_by: user.id,
      })
      .select(SELECT_COLUMNS)
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ equipamento: data });
  } catch (err) {
    console.error("Erro ao criar equipamento:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel cadastrar o equipamento.";
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
      throw new HttpError(403, "Voce nao possui permissao para atualizar equipamentos.");
    }

    const body = (await request.json()) as EquipamentoInput & { id?: string };
    const equipamentoId = body.id?.trim();
    if (!equipamentoId) {
      throw new HttpError(400, "Informe o equipamento.");
    }
    if (body.status !== undefined && !STATUS_VALIDOS.includes(body.status as never)) {
      throw new HttpError(400, "Status invalido.");
    }
    if (body.frequencia !== undefined && !FREQUENCIA_VALIDAS.includes(body.frequencia as never)) {
      throw new HttpError(400, "Frequencia invalida.");
    }

    const updatePayload: Record<string, unknown> = {};
    const camposTexto: Array<keyof EquipamentoInput> = [
      "tipo_equipamento",
      "identificacao",
      "marca",
      "modelo",
      "numero_serie",
      "potencia",
      "localizacao",
      "documento_tipo_obrigatorio",
    ];
    for (const campo of camposTexto) {
      if (Object.prototype.hasOwnProperty.call(body, campo)) {
        updatePayload[campo] = sanitizeText(body[campo] as string | null | undefined);
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "loja_id") && body.loja_id) {
      updatePayload.loja_id = body.loja_id.trim();
    }
    if (Object.prototype.hasOwnProperty.call(body, "prestador_id")) {
      updatePayload.prestador_id = body.prestador_id?.trim() || null;
    }
    for (const campo of ["data_instalacao", "data_ativacao", "data_desativacao"] as const) {
      if (Object.prototype.hasOwnProperty.call(body, campo)) {
        updatePayload[campo] = body[campo] || null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      updatePayload.status = body.status;
    }
    if (Object.prototype.hasOwnProperty.call(body, "atributos")) {
      updatePayload.atributos = body.atributos ?? {};
    }
    if (Object.prototype.hasOwnProperty.call(body, "frequencia")) {
      updatePayload.frequencia = body.frequencia;
    }

    if (Object.keys(updatePayload).length === 0) {
      throw new HttpError(400, "Informe ao menos um campo para atualizar.");
    }

    const { data, error } = await supabaseAdmin
      .from("equipamentos")
      .update(updatePayload)
      .eq("id", equipamentoId)
      .select(SELECT_COLUMNS)
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ equipamento: data });
  } catch (err) {
    console.error("Erro ao atualizar equipamento:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel atualizar o equipamento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
