import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  ApiHttpError as HttpError,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";

type VinculoRow = {
  id: string;
  regra_id: string;
  documento_id: string;
  tipo_vinculo: "auto" | "manual";
  created_at: string;
};

export async function GET(request: Request) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(
        403,
        "Voce nao possui permissao para consultar vinculos.",
      );
    }

    const { searchParams } = new URL(request.url);
    const regraId = searchParams.get("regraId");
    const documentoId = searchParams.get("documentoId");
    const prestadorId = searchParams.get("prestadorId");

    let regraIds: string[] | null = null;
    if (prestadorId) {
      const { data, error } = await supabaseAdmin
        .from("prestador_regras")
        .select("id")
        .eq("prestador_id", prestadorId);
      if (error) {
        throw error;
      }
      regraIds = (data ?? []).map((item) => item.id as string);
      if (regraIds.length === 0) {
        return NextResponse.json({ vinculos: [] });
      }
    }

    let query = supabaseAdmin
      .from("documento_regra_vinculos")
      .select("id,regra_id,documento_id,tipo_vinculo,created_at")
      .order("created_at", { ascending: false });

    if (regraId) {
      query = query.eq("regra_id", regraId);
    }
    if (documentoId) {
      query = query.eq("documento_id", documentoId);
    }
    if (regraIds) {
      query = query.in("regra_id", regraIds);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const vinculos =
      data?.map((item) => ({
        id: item.id as string,
        regra_id: item.regra_id as string,
        documento_id: item.documento_id as string,
        tipo_vinculo: item.tipo_vinculo as "auto" | "manual",
        created_at: item.created_at as string,
      })) ?? [];

    return NextResponse.json({ vinculos });
  } catch (err) {
    console.error("Erro ao buscar vinculos:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel carregar os vinculos.";
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
      throw new HttpError(
        403,
        "Voce nao possui permissao para criar vinculos.",
      );
    }

    const body = (await request.json()) as {
      regra_id?: string;
      documento_id?: string;
      tipo_vinculo?: "auto" | "manual";
    };

    const regraId = body.regra_id?.trim();
    const documentoId = body.documento_id?.trim();
    const tipoVinculo = body.tipo_vinculo ?? "manual";

    if (!regraId || !documentoId) {
      throw new HttpError(400, "Informe regra e documento.");
    }

    const { data: regraData, error: regraError } = await supabaseAdmin
      .from("prestador_regras")
      .select("id,modo_conflito")
      .eq("id", regraId)
      .maybeSingle();

    if (regraError) {
      throw regraError;
    }
    if (!regraData) {
      throw new HttpError(404, "Regra nao encontrada.");
    }

    const modoConflito =
      (regraData.modo_conflito as "multi" | "single" | null) ?? "multi";

    const { data: existingLinks, error: existingError } = await supabaseAdmin
      .from("documento_regra_vinculos")
      .select("id,regra_id,tipo_vinculo")
      .eq("documento_id", documentoId);

    if (existingError) {
      throw existingError;
    }

    if (modoConflito === "single" && (existingLinks?.length ?? 0) > 0) {
      throw new HttpError(
        409,
        "Este documento ja esta vinculado a outra regra.",
      );
    }

    const alreadyForRule = existingLinks?.find(
      (item) => item.regra_id === regraId,
    );
    if (alreadyForRule) {
      return NextResponse.json({
        vinculo: {
          id: alreadyForRule.id as string,
          regra_id: regraId,
          documento_id: documentoId,
          tipo_vinculo: alreadyForRule.tipo_vinculo as "auto" | "manual",
        },
      });
    }

    if (tipoVinculo === "manual") {
      await supabaseAdmin
        .from("documento_regra_vinculos")
        .delete()
        .eq("documento_id", documentoId)
        .eq("tipo_vinculo", "auto");
    }

    const { data, error } = await supabaseAdmin
      .from("documento_regra_vinculos")
      .insert({
        regra_id: regraId,
        documento_id: documentoId,
        tipo_vinculo: tipoVinculo,
        created_by: user.id,
      })
      .select("id,regra_id,documento_id,tipo_vinculo,created_at")
      .single();

    if (error) {
      throw error;
    }

    const vinculo = data as VinculoRow;

    return NextResponse.json({
      vinculo: {
        id: vinculo.id,
        regra_id: vinculo.regra_id,
        documento_id: vinculo.documento_id,
        tipo_vinculo: vinculo.tipo_vinculo,
        created_at: vinculo.created_at,
      },
    });
  } catch (err) {
    console.error("Erro ao criar vinculo:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel criar o vinculo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(
        403,
        "Voce nao possui permissao para remover vinculos.",
      );
    }

    const { searchParams } = new URL(request.url);
    const vinculoId = searchParams.get("id");
    const regraId = searchParams.get("regraId");
    const documentoId = searchParams.get("documentoId");

    if (!vinculoId && (!regraId || !documentoId)) {
      throw new HttpError(400, "Informe o vinculo.");
    }

    let query = supabaseAdmin.from("documento_regra_vinculos").delete();
    if (vinculoId) {
      query = query.eq("id", vinculoId);
    } else {
      query = query.eq("regra_id", regraId).eq("documento_id", documentoId);
    }

    const { error } = await query;
    if (error) {
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Erro ao remover vinculo:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel remover o vinculo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
