import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

type AccessRole = "admin" | "gerente_loja" | "colaborador";

type GerenteAccessInput = {
  lojaId: string;
  canViewAll?: boolean;
  prestadorIds?: string[];
};

type Payload = {
  userId?: string;
  email?: string;
  role?: AccessRole;
  access?: GerenteAccessInput[];
};

type AccessRow = {
  user_id: string | null;
  email: string | null;
  scope: string | null;
  modulo: string | null;
  loja_id: string | null;
  prestador_id: string | null;
  can_view_all: boolean | null;
};

type Identity = {
  userId: string;
  email: string;
};

const ADMIN_MODULES = ["admin", "documentos", "dashboards", "perfil"] as const;

const sanitizeId = (value: string) => value.replace(/[^a-zA-Z0-9-]/g, "");
const sanitizeEmail = (value: string) => value.toLowerCase().trim();

const normalizeIds = (values: string[]) =>
  Array.from(
    new Set(values.map((value) => sanitizeId(value.trim())).filter(Boolean)),
  );

async function getAuthorizedAdmin(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY sao obrigatorios.",
    );
  }

  const supabaseSessionClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: userData, error: sessionError } =
    await supabaseSessionClient.auth.getUser(accessToken);

  if (sessionError || !userData?.user) {
    throw new Error("Sessao invalida.");
  }

  const supabaseAdmin = createSupabaseAdminClient();
  const requesterId = userData.user.id;
  const requesterEmail = userData.user.email?.toLowerCase().trim() ?? null;

  const { data: permissionById, error: permissionByIdError } =
    await supabaseAdmin
      .from("documentos_acesso")
      .select("id")
      .eq("user_id", requesterId)
      .eq("scope", "admin")
      .in("modulo", [...ADMIN_MODULES])
      .limit(1)
      .maybeSingle();

  if (permissionByIdError) {
    throw permissionByIdError;
  }

  let hasPermission = Boolean(permissionById);
  if (!hasPermission && requesterEmail) {
    const { data: permissionByEmail, error: permissionByEmailError } =
      await supabaseAdmin
        .from("documentos_acesso")
        .select("id")
        .eq("email", requesterEmail)
        .eq("scope", "admin")
        .in("modulo", [...ADMIN_MODULES])
        .limit(1)
        .maybeSingle();

    if (permissionByEmailError) {
      throw permissionByEmailError;
    }
    hasPermission = Boolean(permissionByEmail);
  }

  if (!hasPermission) {
    throw new Error("Voce nao tem permissao para gerenciar usuarios.");
  }

  return supabaseAdmin;
}

async function getExistingRows(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  identity: Identity,
) {
  let query = supabaseAdmin
    .from("documentos_acesso")
    .select("user_id,email,scope,modulo,loja_id,prestador_id,can_view_all");

  if (identity.userId && identity.email) {
    query = query.or(`user_id.eq.${identity.userId},email.eq.${identity.email}`);
  } else if (identity.userId) {
    query = query.eq("user_id", identity.userId);
  } else {
    query = query.eq("email", identity.email);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return (data ?? []) as AccessRow[];
}

async function deleteByScope(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  identity: Identity,
  scope: "admin" | "gerente",
) {
  if (identity.userId) {
    const byId = await supabaseAdmin
      .from("documentos_acesso")
      .delete()
      .eq("scope", scope)
      .eq("user_id", identity.userId);
    if (byId.error) {
      throw byId.error;
    }
  }

  if (identity.email) {
    const byEmail = await supabaseAdmin
      .from("documentos_acesso")
      .delete()
      .eq("scope", scope)
      .eq("email", identity.email);
    if (byEmail.error) {
      throw byEmail.error;
    }
  }
}

async function restoreRows(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  rows: AccessRow[],
) {
  if (rows.length === 0) {
    return;
  }

  const { error } = await supabaseAdmin.from("documentos_acesso").insert(
    rows.map((row) => ({
      user_id: row.user_id,
      email: row.email,
      scope: row.scope,
      modulo: row.modulo,
      loja_id: row.loja_id,
      prestador_id: row.prestador_id,
      can_view_all: row.can_view_all,
    })),
  );

  if (error) {
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Requisicao nao autorizada." },
        { status: 401 },
      );
    }

    const token = authHeader.slice("Bearer ".length).trim();
    const supabaseAdmin = await getAuthorizedAdmin(token);
    const body = (await request.json()) as Payload;

    const role = body.role;
    const userId = sanitizeId(body.userId?.trim() ?? "");
    const email = sanitizeEmail(body.email?.trim() ?? "");

    if (!role || !["admin", "gerente_loja", "colaborador"].includes(role)) {
      return NextResponse.json({ error: "Funcao invalida." }, { status: 400 });
    }

    if (!userId && !email) {
      return NextResponse.json(
        { error: "Informe userId ou email do usuario." },
        { status: 400 },
      );
    }

    const identity: Identity = { userId, email };
    const existingRows = await getExistingRows(supabaseAdmin, identity);

    try {
      if (role === "admin") {
        await deleteByScope(supabaseAdmin, identity, "gerente");

        const hasAdmin = existingRows.some(
          (row) =>
            row.scope === "admin" &&
            row.modulo &&
            ADMIN_MODULES.includes(row.modulo as (typeof ADMIN_MODULES)[number]),
        );

        if (!hasAdmin) {
          const { error: insertError } = await supabaseAdmin
            .from("documentos_acesso")
            .insert({
              user_id: userId || null,
              email: email || null,
              scope: "admin",
              modulo: "admin",
            });

          if (insertError) {
            throw insertError;
          }
        }
      }

      if (role === "colaborador") {
        await deleteByScope(supabaseAdmin, identity, "admin");
        await deleteByScope(supabaseAdmin, identity, "gerente");
      }

      if (role === "gerente_loja") {
        const access = body.access ?? [];
        if (access.length === 0) {
          throw new Error("Selecione ao menos uma loja para o gerente.");
        }

        const gerenteRows = access.flatMap((entry) => {
          const lojaId = sanitizeId(entry.lojaId ?? "");
          if (!lojaId) {
            return [];
          }

          if (entry.canViewAll) {
            return [
              {
                scope: "gerente",
                user_id: userId || null,
                email: email || null,
                loja_id: lojaId,
                prestador_id: null,
                can_view_all: true,
              },
            ];
          }

          const prestadorIds = normalizeIds(entry.prestadorIds ?? []);
          if (prestadorIds.length === 0) {
            throw new Error(
              "Selecione prestadores ou habilite acesso total para a loja.",
            );
          }

          return prestadorIds.map((prestadorId) => ({
            scope: "gerente",
            user_id: userId || null,
            email: email || null,
            loja_id: lojaId,
            prestador_id: prestadorId,
            can_view_all: false,
          }));
        });

        if (gerenteRows.length === 0) {
          throw new Error("Nao foi possivel montar as permissoes de gerente.");
        }

        await deleteByScope(supabaseAdmin, identity, "admin");
        await deleteByScope(supabaseAdmin, identity, "gerente");

        const { error: gerenteInsertError } = await supabaseAdmin
          .from("documentos_acesso")
          .insert(gerenteRows);

        if (gerenteInsertError) {
          throw gerenteInsertError;
        }
      }
    } catch (updateError) {
      try {
        await deleteByScope(supabaseAdmin, identity, "admin");
        await deleteByScope(supabaseAdmin, identity, "gerente");
        await restoreRows(supabaseAdmin, existingRows);
      } catch (rollbackError) {
        console.error("Falha no rollback de atualizacao de funcao:", rollbackError);
      }

      throw updateError;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Erro ao atualizar funcao de usuario:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Erro interno ao atualizar funcao.",
      },
      { status: 500 },
    );
  }
}
