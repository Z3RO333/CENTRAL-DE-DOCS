import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

type RegraRow = {
  id: string;
  prestador_id: string;
  tipo_regra: "formulario" | "tipo_servico";
  alvo: string;
  aplica_anteriores: boolean | null;
  aplica_desde: string | null;
  modo_conflito: "multi" | "single" | null;
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

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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
        "Voce nao possui permissao para aplicar regras.",
      );
    }

    const body = (await request.json()) as { regra_id?: string };
    const regraId = body.regra_id?.trim();
    if (!regraId) {
      throw new HttpError(400, "Informe a regra.");
    }

    const { data: regraData, error: regraError } = await supabaseAdmin
      .from("prestador_regras")
      .select(
        "id,prestador_id,tipo_regra,alvo,aplica_anteriores,aplica_desde,modo_conflito",
      )
      .eq("id", regraId)
      .maybeSingle();

    if (regraError) {
      throw regraError;
    }
    if (!regraData) {
      throw new HttpError(404, "Regra nao encontrada.");
    }

    const regra = regraData as RegraRow;
    const aplicaAnteriores = regra.aplica_anteriores ?? true;
    const modoConflito = regra.modo_conflito ?? "multi";

    let docsQuery = supabaseAdmin
      .from("formularios")
      .select("id,created_at")
      .eq("prestador_id", regra.prestador_id);

    if (regra.tipo_regra === "formulario") {
      docsQuery = docsQuery.eq("tipo", regra.alvo);
    } else {
      docsQuery = docsQuery.eq("dados->>tipo_laudo", regra.alvo);
    }

    if (!aplicaAnteriores) {
      const fromDate = regra.aplica_desde ?? new Date().toISOString();
      docsQuery = docsQuery.gte("created_at", fromDate);
    }

    const { data: docs, error: docsError } = await docsQuery;
    if (docsError) {
      throw docsError;
    }

    const documentoIds =
      docs?.map((item) => item.id as string).filter(Boolean) ?? [];

    if (documentoIds.length === 0) {
      return NextResponse.json({ inserted: 0, skipped: 0, total: 0 });
    }

    const existingLinksByDoc = new Map<
      string,
      { hasAny: boolean; hasManual: boolean; hasRule: boolean }
    >();

    for (const chunk of chunkArray(documentoIds, 400)) {
      const { data: existingLinks, error: existingError } = await supabaseAdmin
        .from("documento_regra_vinculos")
        .select("documento_id,regra_id,tipo_vinculo")
        .in("documento_id", chunk);

      if (existingError) {
        throw existingError;
      }

      (existingLinks ?? []).forEach((item) => {
        const docId = item.documento_id as string;
        const current =
          existingLinksByDoc.get(docId) ?? {
            hasAny: false,
            hasManual: false,
            hasRule: false,
          };
        current.hasAny = true;
        if (item.tipo_vinculo === "manual") {
          current.hasManual = true;
        }
        if (item.regra_id === regraId) {
          current.hasRule = true;
        }
        existingLinksByDoc.set(docId, current);
      });
    }

    const toInsert = documentoIds
      .map((documentoId) => {
        const status = existingLinksByDoc.get(documentoId);
        if (modoConflito === "single" && status?.hasAny) {
          return null;
        }
        if (status?.hasManual) {
          return null;
        }
        if (status?.hasRule) {
          return null;
        }
        return {
          regra_id: regraId,
          documento_id: documentoId,
          tipo_vinculo: "auto",
          created_by: user.id,
        };
      })
      .filter(Boolean) as Array<{
      regra_id: string;
      documento_id: string;
      tipo_vinculo: "auto";
      created_by: string;
    }>;

    let inserted = 0;
    for (const chunk of chunkArray(toInsert, 300)) {
      const { error } = await supabaseAdmin
        .from("documento_regra_vinculos")
        .insert(chunk);
      if (error) {
        throw error;
      }
      inserted += chunk.length;
    }

    const skipped = documentoIds.length - inserted;

    return NextResponse.json({
      inserted,
      skipped,
      total: documentoIds.length,
    });
  } catch (err) {
    console.error("Erro ao aplicar regra:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel aplicar a regra.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
