import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  ApiHttpError as HttpError,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";
import { fixMojibakeText } from "@/lib/textEncoding";

type PrestadorRow = {
  id: string;
  nome: string;
  cnpj: string;
  tipo_servico: string;
  usuarios: string[] | null;
  created_at: string;
  created_by: string | null;
};

function normalizeEmails(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.toLowerCase().trim())
        .filter((value) => Boolean(value)),
    ),
  );
}

function normalizePrestador(item: PrestadorRow) {
  return {
    id: item.id,
    nome: fixMojibakeText(item.nome),
    cnpj: item.cnpj,
    tipo_servico: fixMojibakeText(item.tipo_servico),
    usuarios: item.usuarios ?? [],
    created_at: item.created_at,
  };
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    const { searchParams } = new URL(request.url);
    const assignedOnly = searchParams.get("assignedOnly") === "true";

    if (assignedOnly && !email) {
      return NextResponse.json({ prestadores: [] });
    }

    if (!assignedOnly) {
      const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
      if (!canAccess) {
        throw new HttpError(
          403,
          "Voce nao possui permissao para consultar prestadores.",
        );
      }
    }
    let query = supabaseAdmin
      .from("prestadores")
      .select("id,nome,cnpj,tipo_servico,usuarios,created_at")
      .order("created_at", { ascending: false });

    if (assignedOnly && email) {
      query = query.contains("usuarios", [email]);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const prestadores =
      data?.map((item) =>
        normalizePrestador({
          id: item.id as string,
          nome: item.nome as string,
          cnpj: item.cnpj as string,
          tipo_servico: item.tipo_servico as string,
          usuarios: (item.usuarios as string[] | null) ?? [],
          created_at: item.created_at as string,
          created_by: null,
        }),
      ) ?? [];

    return NextResponse.json({ prestadores });
  } catch (err) {
    console.error("Erro ao buscar prestadores:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel carregar os prestadores.";
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
        "Voce nao possui permissao para cadastrar prestadores.",
      );
    }

    const body = (await request.json()) as {
      nome?: string;
      cnpj?: string;
      tipo_servico?: string;
      usuarios?: string[];
    };

    const nome = body.nome ? fixMojibakeText(body.nome.trim()) : undefined;
    const cnpj = body.cnpj?.trim();
    const tipoServico = body.tipo_servico
      ? fixMojibakeText(body.tipo_servico.trim())
      : undefined;
    const usuarios = normalizeEmails(body.usuarios ?? []);

    if (!nome) {
      throw new HttpError(400, "Informe o nome do prestador.");
    }
    if (!tipoServico) {
      throw new HttpError(400, "Informe o tipo de servico.");
    }
    if (!cnpj) {
      throw new HttpError(400, "Informe o CNPJ do prestador.");
    }
    if (usuarios.length === 0) {
      throw new HttpError(
        400,
        "Informe ao menos um e-mail autorizado para o prestador.",
      );
    }

    const { data, error } = await supabaseAdmin
      .from("prestadores")
      .insert({
        nome,
        cnpj,
        tipo_servico: tipoServico,
        usuarios,
        created_by: user.id,
      })
      .select("id,nome,cnpj,tipo_servico,usuarios,created_at")
      .single();

    if (error) {
      throw error;
    }

    const prestador: PrestadorRow = data as PrestadorRow;

    return NextResponse.json({
      prestador: normalizePrestador(prestador),
    });
  } catch (err) {
    console.error("Erro ao criar prestador:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel cadastrar o prestador.";
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
      throw new HttpError(
        403,
        "Voce nao possui permissao para atualizar prestadores.",
      );
    }

    const body = (await request.json()) as {
      id?: string;
      emails?: string[];
      remove_emails?: string[];
    };

    const prestadorId = body.id?.trim();
    const novosEmails = normalizeEmails(body.emails ?? []);
    const removerEmails = normalizeEmails(body.remove_emails ?? []);

    if (!prestadorId) {
      throw new HttpError(400, "Informe o prestador.");
    }
    if (novosEmails.length === 0 && removerEmails.length === 0) {
      throw new HttpError(400, "Informe ao menos um e-mail.");
    }

    if (novosEmails.length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidos = novosEmails.filter((e) => !emailRegex.test(e));
      if (invalidos.length > 0) {
        throw new HttpError(
          400,
          `E-mails com formato invalido: ${invalidos.join(", ")}`,
        );
      }
    }

    const { data: prestadorData, error: prestadorError } = await supabaseAdmin
      .from("prestadores")
      .select("id,nome,cnpj,tipo_servico,usuarios,created_at")
      .eq("id", prestadorId)
      .single();

    if (prestadorError) {
      throw prestadorError;
    }

    const existentes = (prestadorData?.usuarios as string[] | null) ?? [];
    const usuarios = normalizeEmails([...existentes, ...novosEmails]).filter(
      (value) => !removerEmails.includes(value),
    );

    const { data, error } = await supabaseAdmin
      .from("prestadores")
      .update({ usuarios })
      .eq("id", prestadorId)
      .select("id,nome,cnpj,tipo_servico,usuarios,created_at")
      .single();

    if (error) {
      throw error;
    }

    const prestador: PrestadorRow = data as PrestadorRow;

    return NextResponse.json({
      prestador: normalizePrestador(prestador),
    });
  } catch (err) {
    console.error("Erro ao atualizar prestador:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel atualizar o prestador.";
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
        "Voce nao possui permissao para remover prestadores.",
      );
    }

    const { searchParams } = new URL(request.url);
    const prestadorId = searchParams.get("id")?.trim();
    if (!prestadorId) {
      throw new HttpError(400, "Informe o prestador.");
    }

    const { error } = await supabaseAdmin
      .from("prestadores")
      .delete()
      .eq("id", prestadorId);

    if (error) {
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Erro ao remover prestador:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel remover o prestador.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
