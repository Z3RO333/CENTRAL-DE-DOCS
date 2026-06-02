import { NextResponse } from "next/server";
import { buildDocumentosAccessOr } from "@/lib/documentosAccessFilters";
import { safeParseDados, sanitizeId } from "@/lib/documentosApiUtils";
import {
  isDocumentoAuditUnavailable,
  logDocumentoAuditEvent,
  type DocumentoAuditEvent,
} from "@/lib/documentosAudit";
import {
  ApiHttpError as HttpError,
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { fixMojibakeText, normalizeDisplayData } from "@/lib/textEncoding";

type FormularioRow = {
  id: string;
  tipo: string;
  status: string;
  arquivo_path: string | null;
  arquivo_assinado_path: string | null;
  created_at: string;
  dados: Record<string, unknown> | string | null;
  assinado_por: string | null;
  user_id: string;
  prestador_id: string | null;
};

type EntityRow = {
  id: string;
  nome: string | null;
  codigo?: string | null;
  tipo_servico?: string | null;
};

type DocumentoAnaliseIaRow = {
  id: string;
  documento_id: string;
  provider: string;
  model: string;
  status: string;
  resultado: Record<string, unknown>;
  erro: string | null;
  created_at: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuidLike = (value: string | null | undefined) =>
  Boolean(value && UUID_PATTERN.test(value));

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

const getDocumentoNome = (registro: FormularioRow) => {
  const dados = normalizeDisplayData(safeParseDados(registro.dados)) as Record<
    string,
    unknown
  > | null;
  const anexos = dados?.anexos;
  if (Array.isArray(anexos) && anexos.length > 0) {
    const primeiro = anexos[0] as { nome?: unknown } | null;
    if (primeiro?.nome && typeof primeiro.nome === "string") {
      return fixMojibakeText(primeiro.nome);
    }
  }
  const path = registro.arquivo_assinado_path ?? registro.arquivo_path;
  return path ? fixMojibakeText(path.split("/").pop() ?? path) : registro.id;
};

async function getVisibleDocumento(input: {
  request: Request;
  id: string;
}) {
  const user = await getSessionUserFromRequest(input.request);
  const email = user.email?.toLowerCase().trim() ?? null;
  const supabaseAdmin = createSupabaseAdminClient();
  const allowedPrestadores = await getAuthorizedPrestadorIds(email, supabaseAdmin);
  const gerenteEntries = await getGerenteAccessEntries(
    user.id,
    email,
    supabaseAdmin,
  );
  const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);

  let query = supabaseAdmin
    .from("formularios")
    .select(
      "id,tipo,status,arquivo_path,arquivo_assinado_path,created_at,dados,assinado_por,user_id,prestador_id",
    )
    .eq("id", input.id);

  if (!canAccess) {
    const dadosFilter = await buildDocumentosAccessOr({
      canAccess,
      allowedPrestadores,
      gerenteEntries,
      userId: user.id,
      filterUserId: user.id,
      filterPrestadores: [],
      filterLojas: [],
    });
    query = query.or(dadosFilter.join(","));
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    throw new HttpError(404, "Documento nao encontrado.");
  }

  return {
    user,
    email,
    supabaseAdmin,
    registro: data as FormularioRow,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = sanitizeId(rawId ?? "");
    if (!id) {
      throw new HttpError(400, "Informe um documento valido.");
    }

    const { supabaseAdmin, registro } = await getVisibleDocumento({
      request,
      id,
    });

    const dados = normalizeDisplayData(safeParseDados(registro.dados)) as Record<
      string,
      unknown
    > | null;
    const lojaId = getCampoTexto(dados, ["loja_id"]);
    const [lojaResult, prestadorResult, userResult, auditoriaResult, analiseResult] =
      await Promise.all([
        isUuidLike(lojaId)
          ? supabaseAdmin
              .from("lojas")
              .select("id,nome,codigo")
              .eq("id", lojaId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        isUuidLike(registro.prestador_id)
          ? supabaseAdmin
              .from("prestadores")
              .select("id,nome,tipo_servico")
              .eq("id", registro.prestador_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        registro.user_id
          ? supabaseAdmin.auth.admin.getUserById(registro.user_id)
          : Promise.resolve({ data: { user: null }, error: null }),
        supabaseAdmin
          .from("documentos_auditoria")
          .select("id,documento_id,event_type,actor_id,actor_email,metadata,created_at")
          .eq("documento_id", registro.id)
          .order("created_at", { ascending: false })
          .limit(60),
        supabaseAdmin
          .from("documentos_analises_ia")
          .select("id,documento_id,provider,model,status,resultado,erro,created_at")
          .eq("documento_id", registro.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    if (lojaResult.error) {
      console.error("Erro ao buscar loja do documento:", lojaResult.error);
    }
    if (prestadorResult.error) {
      console.error(
        "Erro ao buscar prestador do documento:",
        prestadorResult.error,
      );
    }
    if (userResult.error) {
      console.error("Erro ao buscar usuario do documento:", userResult.error);
    }
    if (auditoriaResult.error) {
      if (isDocumentoAuditUnavailable(auditoriaResult.error)) {
        console.warn(
          "Tabela documentos_auditoria indisponivel; usando timeline sintetica.",
        );
      } else {
        console.error(
          "Erro ao buscar auditoria do documento:",
          auditoriaResult.error,
        );
      }
    }
    if (analiseResult.error) {
      console.error("Erro ao buscar analise IA do documento:", analiseResult.error);
    }

    const loja = lojaResult.data as EntityRow | null;
    const prestador = prestadorResult.data as EntityRow | null;
    const enviadoPorUser = userResult.data.user;
    const eventos = ((auditoriaResult.error
      ? []
      : (auditoriaResult.data as DocumentoAuditEvent[] | null)) ?? [])
      .map((evento) => ({
        ...evento,
        metadata: evento.metadata ?? {},
      }));
    const hasCreatedEvent = eventos.some(
      (evento) => evento.event_type === "documento_criado",
    );
    const timeline = hasCreatedEvent
      ? eventos
      : [
          ...eventos,
          {
            id: `synthetic-created-${registro.id}`,
            documento_id: registro.id,
            event_type: "documento_criado",
            actor_id: registro.user_id,
            actor_email: enviadoPorUser?.email ?? null,
            metadata: {
              tipo: registro.tipo,
              status: registro.status,
              synthetic: true,
            },
            created_at: registro.created_at,
          },
        ];

    timeline.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return NextResponse.json({
      documento: {
        ...registro,
        dados,
        arquivo_path: registro.arquivo_path ?? "",
        arquivo_assinado_path: registro.arquivo_assinado_path ?? null,
        nome_arquivo: getDocumentoNome(registro),
      },
      detalhes: {
        loja: loja
          ? {
              id: loja.id,
              nome: loja.nome ? fixMojibakeText(loja.nome) : null,
              codigo: loja.codigo ? fixMojibakeText(loja.codigo) : null,
            }
          : null,
        prestador: prestador
          ? {
              id: prestador.id,
              nome: prestador.nome ? fixMojibakeText(prestador.nome) : null,
              tipo_servico: prestador.tipo_servico
                ? fixMojibakeText(prestador.tipo_servico)
                : null,
            }
          : null,
        enviadoPor: enviadoPorUser
          ? {
              id: enviadoPorUser.id,
              email: enviadoPorUser.email ?? null,
              name:
                (enviadoPorUser.user_metadata?.name as string | undefined) ??
                (enviadoPorUser.user_metadata?.full_name as string | undefined) ??
                null,
            }
          : null,
      },
      timeline,
      analise_ia: analiseResult.error
        ? null
        : ((analiseResult.data as DocumentoAnaliseIaRow | null) ?? null),
    });
  } catch (err) {
    console.error("Erro ao buscar detalhes do documento:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Nao foi possivel carregar o documento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = sanitizeId(rawId ?? "");
    if (!id) {
      throw new HttpError(400, "Informe um documento valido.");
    }
    const body = (await request.json().catch(() => ({}))) as {
      eventType?: string;
      metadata?: Record<string, unknown>;
    };
    if (body.eventType !== "baixado") {
      throw new HttpError(400, "Evento de auditoria invalido.");
    }

    const { user, email, supabaseAdmin } = await getVisibleDocumento({
      request,
      id,
    });
    await logDocumentoAuditEvent({
      supabaseAdmin,
      documentoId: id,
      eventType: "baixado",
      actorId: user.id,
      actorEmail: email,
      metadata: body.metadata ?? {},
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Erro ao registrar auditoria do documento:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel registrar auditoria.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
