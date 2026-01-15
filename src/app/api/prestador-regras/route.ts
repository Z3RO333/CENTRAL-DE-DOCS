import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

type PrestadorRegraRow = {
  id: string;
  prestador_id: string;
  tipo_regra: "formulario" | "tipo_servico";
  alvo: string;
  periodo: "mensal" | "anual";
  quantidade: number;
  label: string | null;
  ativo: boolean | null;
  aplica_anteriores?: boolean | null;
  aplica_desde?: string | null;
  modo_conflito?: "multi" | "single" | null;
  created_at: string;
  created_by?: string | null;
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function getSessionUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new HttpError(401, "Requisicao nao autorizada.");
  }

  const accessToken = authHeader.slice("Bearer ".length).trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Configuracao incompleta. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const supabaseSession = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabaseSession.auth.getUser(accessToken);
  if (error || !data?.user) {
    throw new HttpError(401, "Sessao invalida ou expirada.");
  }

  return data.user;
}

async function hasDocumentosAccess(
  userId: string,
  email: string | null,
  supabaseAdmin = createSupabaseAdminClient(),
) {
  const adminModules = ["admin", "documentos", "dashboards", "perfil"];
  const { data, error } = await supabaseAdmin
    .from("documentos_acesso")
    .select("id")
    .eq("user_id", userId)
    .eq("scope", "admin")
    .in("modulo", adminModules)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return true;
  }

  if (!email) {
    return false;
  }

  const {
    data: emailData,
    error: emailError,
  } = await supabaseAdmin
    .from("documentos_acesso")
    .select("id")
    .eq("email", email)
    .eq("scope", "admin")
    .in("modulo", adminModules)
    .limit(1)
    .maybeSingle();

  if (emailError) {
    throw emailError;
  }

  return Boolean(emailData);
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(
        403,
        "Voce nao possui permissao para consultar regras.",
      );
    }

    const { searchParams } = new URL(request.url);
    const prestadorIds = searchParams.getAll("prestadorId");
    const activeOnly = searchParams.get("activeOnly") !== "false";

    let query = supabaseAdmin
      .from("prestador_regras")
      .select(
        "id,prestador_id,tipo_regra,alvo,periodo,quantidade,label,ativo,created_at,aplica_anteriores,aplica_desde,modo_conflito",
      )
      .order("created_at", { ascending: false });

    if (prestadorIds.length > 0) {
      query = query.in("prestador_id", prestadorIds);
    }

    if (activeOnly) {
      query = query.eq("ativo", true);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const regras =
      data?.map((item) => ({
        id: item.id as string,
        prestador_id: item.prestador_id as string,
        tipo_regra: item.tipo_regra as "formulario" | "tipo_servico",
        alvo: item.alvo as string,
        periodo: item.periodo as "mensal" | "anual",
        quantidade: item.quantidade as number,
        label: item.label as string | null,
        ativo: (item.ativo as boolean | null) ?? true,
        aplica_anteriores: (item.aplica_anteriores as boolean | null) ?? true,
        aplica_desde: (item.aplica_desde as string | null) ?? null,
        modo_conflito: (item.modo_conflito as "multi" | "single") ?? "multi",
        created_at: item.created_at as string,
      })) ?? [];

    return NextResponse.json({ regras });
  } catch (err) {
    console.error("Erro ao buscar regras:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel carregar as regras.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(
        403,
        "Voce nao possui permissao para cadastrar regras.",
      );
    }

    const body = (await request.json()) as {
      prestador_id?: string;
      tipo_regra?: "formulario" | "tipo_servico";
      alvo?: string;
      periodo?: "mensal" | "anual";
      quantidade?: number;
      label?: string;
      aplica_anteriores?: boolean;
      aplica_desde?: string | null;
      modo_conflito?: "multi" | "single";
    };

    const prestadorId = body.prestador_id?.trim();
    const tipoRegra = body.tipo_regra;
    const alvo = body.alvo?.trim();
    const periodo = body.periodo;
    const quantidade = Number(body.quantidade);
    const label = body.label?.trim() ?? null;
    const aplicaAnteriores = body.aplica_anteriores ?? true;
    const aplicaDesdeRaw = body.aplica_desde ?? null;
    const modoConflito = body.modo_conflito ?? "multi";

    if (!prestadorId) {
      throw new HttpError(400, "Informe o prestador.");
    }
    if (!tipoRegra || !["formulario", "tipo_servico"].includes(tipoRegra)) {
      throw new HttpError(400, "Informe o tipo da regra.");
    }
    if (!alvo) {
      throw new HttpError(400, "Informe o alvo da regra.");
    }
    if (!periodo || !["mensal", "anual"].includes(periodo)) {
      throw new HttpError(400, "Informe o periodo da regra.");
    }
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      throw new HttpError(400, "Informe a quantidade da regra.");
    }
    if (!["multi", "single"].includes(modoConflito)) {
      throw new HttpError(400, "Informe o modo de conflito da regra.");
    }
    if (!aplicaAnteriores) {
      if (!aplicaDesdeRaw) {
        throw new HttpError(
          400,
          "Informe a data inicial quando nao aplicar documentos antigos.",
        );
      }
      const aplicaDesdeDate = new Date(aplicaDesdeRaw);
      if (Number.isNaN(aplicaDesdeDate.getTime())) {
        throw new HttpError(400, "Informe uma data inicial valida.");
      }
    }

    const { data, error } = await supabaseAdmin
      .from("prestador_regras")
      .insert({
        prestador_id: prestadorId,
        tipo_regra: tipoRegra,
        alvo,
        periodo,
        quantidade,
        label,
        ativo: true,
        aplica_anteriores: aplicaAnteriores,
        aplica_desde: aplicaAnteriores ? null : aplicaDesdeRaw,
        modo_conflito: modoConflito,
        created_by: user.id,
      })
      .select(
        "id,prestador_id,tipo_regra,alvo,periodo,quantidade,label,ativo,created_at,aplica_anteriores,aplica_desde,modo_conflito",
      )
      .single();

    if (error) {
      throw error;
    }

    const regra = data as PrestadorRegraRow;

    return NextResponse.json({
      regra: {
        id: regra.id,
        prestador_id: regra.prestador_id,
        tipo_regra: regra.tipo_regra,
        alvo: regra.alvo,
        periodo: regra.periodo,
        quantidade: regra.quantidade,
        label: regra.label,
        ativo: regra.ativo ?? true,
        aplica_anteriores: regra.aplica_anteriores ?? true,
        aplica_desde: regra.aplica_desde ?? null,
        modo_conflito: regra.modo_conflito ?? "multi",
        created_at: regra.created_at,
      },
    });
  } catch (err) {
    console.error("Erro ao criar regra:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel cadastrar a regra.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) {
      throw new HttpError(
        403,
        "Voce nao possui permissao para remover regras.",
      );
    }

    const { searchParams } = new URL(request.url);
    const regraId = searchParams.get("id");
    if (!regraId) {
      throw new HttpError(400, "Informe a regra.");
    }

    const { error } = await supabaseAdmin
      .from("prestador_regras")
      .delete()
      .eq("id", regraId);

    if (error) {
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Erro ao remover regra:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel remover a regra.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
