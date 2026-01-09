import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { resolveServicoOficial } from "@/lib/servicosVocab";

type ModuleKey = "documentos" | "dashboards" | "perfil";

type ModulesAccess = Record<ModuleKey, boolean>;

type FormularioRow = {
  id: string;
  tipo: string;
  status: string;
  created_at: string;
  dados: Record<string, unknown> | string | null;
  prestador_id?: string | null;
  user_id: string;
};

type DocumentoResumo = {
  id: string;
  tipo: string;
  status: string;
  created_at: string;
  empresa?: string | null;
  prestador?: string | null;
  responsavel?: string | null;
  numero_pedido?: string | null;
  tipo_laudo?: string | null;
};

type ConsultaBody = {
  question?: string;
};

type ExtractedFilters = {
  empresa?: string | null;
  prestador?: string | null;
  responsavel?: string | null;
  numero_pedido?: string | null;
  tipo_laudo?: string | null;
  tipo_formulario?: string | null;
  status?: string | null;
  ano?: string | null;
  mes?: string | null;
  termo_livre?: string | null;
  limite?: number | null;
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
    throw new HttpError(401, "Unauthorized request.");
  }

  const accessToken = authHeader.slice("Bearer ".length).trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase env vars.");
  }

  const supabaseSession = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabaseSession.auth.getUser(accessToken);
  if (error || !data?.user) {
    throw new HttpError(401, "Invalid or expired session.");
  }

  return data.user;
}

async function getModulesAccess(
  userId: string,
  email: string | null,
  supabaseAdmin = createSupabaseAdminClient(),
) {
  const baseModules: ModulesAccess = {
    documentos: false,
    dashboards: false,
    perfil: false,
  };

  const applyRecords = (records: { modulo?: string | null }[] | null) => {
    records?.forEach((item) => {
      const modulo = (item.modulo ?? "documentos") as ModuleKey;
      if (modulo in baseModules) {
        baseModules[modulo] = true;
      }
    });
  };

  const selectWithModule = async (column: "user_id" | "email", value: string) =>
    supabaseAdmin.from("documentos_acesso").select("id,modulo").eq(column, value);

  const selectWithoutModule = async (
    column: "user_id" | "email",
    value: string,
  ) => supabaseAdmin.from("documentos_acesso").select("id").eq(column, value);

  let data: { modulo?: string | null }[] | null = null;
  let { data: userData, error } = await selectWithModule("user_id", userId);
  if (error && error.message?.toLowerCase().includes("modulo")) {
    const fallback = await selectWithoutModule("user_id", userId);
    userData =
      fallback.data?.map((item) => ({
        ...item,
        modulo: null,
      })) ?? null;
    error = fallback.error;
  }
  if (error) {
    throw error;
  }

  data = userData;
  applyRecords(data);

  if ((!data || data.length === 0) && email) {
    let { data: emailData, error: emailError } = await selectWithModule(
      "email",
      email,
    );
    if (emailError && emailError.message?.toLowerCase().includes("modulo")) {
      const fallback = await selectWithoutModule("email", email);
      emailData =
        fallback.data?.map((item) => ({
          ...item,
          modulo: null,
        })) ?? null;
      emailError = fallback.error;
    }
    if (emailError) {
      throw emailError;
    }
    applyRecords(emailData ?? null);
  }

  return baseModules;
}

async function getAuthorizedPrestadorIds(
  email: string | null,
  supabaseAdmin = createSupabaseAdminClient(),
) {
  if (!email) {
    return [];
  }
  const { data, error } = await supabaseAdmin
    .from("prestadores")
    .select("id,usuarios")
    .contains("usuarios", [email]);
  if (error) {
    throw error;
  }
  return (
    data?.map((item) => ({
      id: item.id as string,
      usuarios: (item.usuarios as string[] | null) ?? [],
    })) ?? []
  )
    .filter((item) => item.usuarios.some((usuario) => usuario === email))
    .map((item) => item.id);
}

const getText = (dados: Record<string, unknown> | null, key: string) => {
  const value = dados?.[key];
  return typeof value === "string" ? value : null;
};

const mapRowToResumo = (row: FormularioRow): DocumentoResumo => {
  const dados =
    typeof row.dados === "string"
      ? (JSON.parse(row.dados) as Record<string, unknown>)
      : (row.dados as Record<string, unknown> | null);

  return {
    id: row.id,
    tipo: row.tipo,
    status: row.status,
    created_at: row.created_at,
    empresa: getText(dados, "empresa"),
    prestador: getText(dados, "prestador"),
    responsavel: getText(dados, "responsavel"),
    numero_pedido: getText(dados, "numero_pedido"),
    tipo_laudo: getText(dados, "tipo_laudo"),
  };
};

async function extractFilters(
  question: string,
  endpoint: string,
  deployment: string,
  apiKey: string,
) {
  const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=2025-01-01-preview`;
  const system = [
    "You are a system that extracts filters for querying documents.",
    "Return ONLY valid JSON.",
    "Keys: empresa, prestador, responsavel, numero_pedido, tipo_laudo, tipo_formulario, status, ano, mes, termo_livre, limite.",
    "tipo_formulario must be one of: retencao_trabalhista, registro_laudos, notas_fiscais.",
    "status must be one of: pendente, em_analise, assinado.",
    "ano is YYYY, mes is MM.",
    "Use null for unknown fields.",
  ].join(" ");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: system },
        { role: "user", content: question },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "AI request failed.");
  }

  const content = payload.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content) as ExtractedFilters;
  } catch {
    return { termo_livre: question } as ExtractedFilters;
  }
}

async function generateAnswer(
  question: string,
  registros: DocumentoResumo[],
  endpoint: string,
  deployment: string,
  apiKey: string,
) {
  const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/chat/completions?api-version=2025-01-01-preview`;
  const system = [
    "You are a helpful assistant for document lookup.",
    "Answer in pt-BR, concise.",
    "If you list documents, include their ids.",
    "If none found, say so and suggest refining the query.",
  ].join(" ");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({ question, registros }),
        },
      ],
      temperature: 0.2,
    }),
  });

  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "AI response failed.");
  }

  return payload.choices?.[0]?.message?.content ?? "";
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      { error: "Consulta por IA em manutencao." },
      { status: 503 },
    );
    const { question } = (await request.json()) as ConsultaBody;
    if (!question || !question.trim()) {
      throw new HttpError(400, "Question is required.");
    }

    const user = await getSessionUser(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();
    const modules = await getModulesAccess(user.id, email, supabaseAdmin);
    const canAccess = modules.documentos || modules.dashboards;
    const allowedPrestadores = await getAuthorizedPrestadorIds(
      email,
      supabaseAdmin,
    );

    const endpoint = process.env.AZURE_OPENAI_ENDPOINT ?? "";
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? "";
    const apiKey = process.env.AZURE_OPENAI_API_KEY ?? "";

    if (!endpoint || !deployment || !apiKey) {
      throw new Error("Missing Azure OpenAI env vars.");
    }

    const filters = await extractFilters(
      question,
      endpoint,
      deployment,
      apiKey,
    );

    const limit =
      typeof filters.limite === "number" && Number.isFinite(filters.limite)
        ? Math.min(Math.max(filters.limite, 1), 100)
        : 50;

    let query = supabaseAdmin
      .from("formularios")
      .select("id,tipo,status,created_at,dados,prestador_id,user_id")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!canAccess) {
      if (allowedPrestadores.length > 0) {
        query = query.in("prestador_id", allowedPrestadores);
      } else {
        query = query.eq("user_id", user.id);
      }
    }

    if (filters.tipo_formulario) {
      query = query.eq("tipo", filters.tipo_formulario);
    }

    if (filters.status) {
      query = query.eq("status", filters.status);
    }

    if (filters.empresa) {
      query = query.ilike("dados->>empresa", `%${filters.empresa}%`);
    }
    if (filters.prestador) {
      query = query.ilike("dados->>prestador", `%${filters.prestador}%`);
    }
    if (filters.responsavel) {
      query = query.ilike("dados->>responsavel", `%${filters.responsavel}%`);
    }
    if (filters.numero_pedido) {
      query = query.ilike("dados->>numero_pedido", `%${filters.numero_pedido}%`);
    }
    if (filters.tipo_laudo) {
      const resolved = resolveServicoOficial(filters.tipo_laudo);
      const tipoLaudo = resolved.canonical;
      query = query.ilike("dados->>tipo_laudo", `%${tipoLaudo}%`);
    }

    if (filters.ano && filters.ano !== "todos") {
      const ano = Number(filters.ano);
      if (!Number.isNaN(ano)) {
        if (filters.mes && filters.mes !== "todos") {
          const mes = Number(filters.mes);
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

    if (filters.termo_livre || question.trim()) {
      const term = filters.termo_livre?.trim() || question.trim();
      const sanitized = term.replace(/,/g, " ").trim();
      if (sanitized) {
        const pattern = `%${sanitized}%`;
        query = query.or(
          [
            `dados->>empresa.ilike.${pattern}`,
            `dados->>prestador.ilike.${pattern}`,
            `dados->>responsavel.ilike.${pattern}`,
            `dados->>numero_pedido.ilike.${pattern}`,
            `dados->>tipo_laudo.ilike.${pattern}`,
          ].join(","),
        );
      }
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const registros = (data as FormularioRow[] | null)?.map(mapRowToResumo) ?? [];

    const answer = await generateAnswer(
      question,
      registros,
      endpoint,
      deployment,
      apiKey,
    );

    return NextResponse.json({
      answer,
      registros,
    });
  } catch (err) {
    console.error("Erro na consulta IA:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Failed to process IA request.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
