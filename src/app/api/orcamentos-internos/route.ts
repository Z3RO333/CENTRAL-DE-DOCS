import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  ApiHttpError as HttpError,
  getActorFromRequest,
} from "@/lib/apiAuth";
import {
  TIPO_ORCAMENTO_INTERNO,
  assertInternalActor,
  getArquivoPrincipal,
  getAprovadorEmails,
  logOrcamentoEvent,
  normalizeEmail,
  normalizeText,
  parseValorTotal,
  resolveLojaNome,
  resolvePrestadorNome,
  validateOrcamentoInput,
  validateStatus,
  type OrcamentoInternoArquivoInput,
  type OrcamentoInternoInput,
  type OrcamentoInternoRow,
} from "@/lib/orcamentosInternos";

const PAGE_SIZE = 50;

function mapOrcamento(row: OrcamentoInternoRow) {
  return {
    ...row,
    valor_total:
      row.valor_total === null ? null : Number(row.valor_total),
  };
}

function normalizeArquivos(
  arquivos: OrcamentoInternoArquivoInput[],
  principalPath: string,
) {
  return arquivos
    .filter((arquivo) => arquivo.path?.trim())
    .map((arquivo) => ({
      path: arquivo.path!.trim(),
      name: normalizeText(arquivo.name) || arquivo.path!.split("/").pop() || "arquivo",
      type: normalizeText(arquivo.type) || null,
      size: typeof arquivo.size === "number" ? arquivo.size : null,
      principal: arquivo.path!.trim() === principalPath || Boolean(arquivo.principal),
    }));
}

export async function GET(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    await assertInternalActor({ actor, supabaseAdmin });
    const aprovadores = await getAprovadorEmails(supabaseAdmin);
    const isAprovador = Boolean(
      actor.email && aprovadores.has(normalizeEmail(actor.email) ?? ""),
    );

    const { searchParams } = new URL(request.url);
    const tab = searchParams.get("tab") ?? "meus";
    const status = searchParams.get("status");
    const lojaId = searchParams.get("lojaId");
    const prestadorId = searchParams.get("prestadorId");
    const gestor = normalizeEmail(searchParams.get("gestor"));
    const colaborador = searchParams.get("colaborador");
    const dataInicio = searchParams.get("dataInicio");
    const dataFim = searchParams.get("dataFim");
    const valorMin = parseValorTotal(searchParams.get("valorMin"));
    const valorMax = parseValorTotal(searchParams.get("valorMax"));
    const offsetParam = Number(searchParams.get("offset"));
    const limitParam = Number(searchParams.get("limit"));
    const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 100)
      : PAGE_SIZE;

    let query = supabaseAdmin
      .from("orcamentos_internos")
      .select("*", { count: "exact" })
      .order("updated_at", { ascending: false });

    if (!actor.isAdmin && !isAprovador) {
      const ors: string[] = [];
      if (actor.userId) {
        ors.push(`solicitante_id.eq.${actor.userId}`);
        ors.push(`gestor_id.eq.${actor.userId}`);
      }
      if (actor.email) {
        ors.push(`gestor_email.eq.${actor.email}`);
      }
      if (ors.length === 0) {
        throw new HttpError(403, "Você não possui acesso aos orçamentos internos.");
      }
      query = query.or(ors.join(","));
    }

    if (tab === "meus") {
      if (!actor.userId) {
        query = query.eq("solicitante_email", actor.email ?? "");
      } else {
        query = query.eq("solicitante_id", actor.userId);
      }
    } else if (tab === "aprovacao") {
      query = query.in("status", [
        "aguardando_aprovacao",
        "em_analise_gestor",
        "reenviado",
      ]);
      if (!actor.isAdmin && !isAprovador) {
        const ors: string[] = [];
        if (actor.userId) ors.push(`gestor_id.eq.${actor.userId}`);
        if (actor.email) ors.push(`gestor_email.eq.${actor.email}`);
        query = query.or(
          ors.length > 0 ? ors.join(",") : "id.eq.00000000-0000-0000-0000-000000000000",
        );
      }
    } else if (tab === "todos" && !actor.isAdmin) {
      throw new HttpError(403, "A visão geral é restrita a administradores.");
    }

    if (status && status !== "todos") {
      query = query.eq("status", validateStatus(status));
    }
    if (lojaId && lojaId !== "todos") {
      query = query.eq("loja_id", lojaId);
    }
    if (prestadorId && prestadorId !== "todos") {
      query = query.eq("prestador_id", prestadorId);
    }
    if (gestor && gestor !== "todos") {
      query = query.eq("gestor_email", gestor);
    }
    if (colaborador && colaborador !== "todos") {
      query = query.eq("solicitante_id", colaborador);
    }
    if (dataInicio) {
      query = query.gte("created_at", dataInicio);
    }
    if (dataFim) {
      query = query.lte("created_at", `${dataFim}T23:59:59`);
    }
    if (valorMin !== null) {
      query = query.gte("valor_total", valorMin);
    }
    if (valorMax !== null) {
      query = query.lte("valor_total", valorMax);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) {
      throw error;
    }

    return NextResponse.json({
      orcamentos: ((data as OrcamentoInternoRow[] | null) ?? []).map(mapOrcamento),
      total: count ?? 0,
      isAdmin: actor.isAdmin,
    });
  } catch (err) {
    console.error("Erro ao listar orçamentos internos:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível listar os orçamentos internos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    await assertInternalActor({ actor, supabaseAdmin });

    if (!actor.realUserId) {
      throw new HttpError(401, "Sessão inválida.");
    }

    const body = (await request.json()) as OrcamentoInternoInput & {
      submit?: boolean;
    };
    const submit = Boolean(body.submit);
    validateOrcamentoInput(body, submit ? "submit" : "draft");

    const principal = getArquivoPrincipal(body.arquivos ?? []);
    if (!principal?.path) {
      throw new HttpError(400, "Arquivo principal não informado.");
    }

    const lojaId = normalizeText(body.lojaId) || null;
    const prestadorId = normalizeText(body.prestadorId) || null;
    const [lojaNome, prestadorNome] = await Promise.all([
      resolveLojaNome(lojaId, supabaseAdmin),
      resolvePrestadorNome(
        {
          prestadorId,
          prestadorNome: body.prestadorNome ?? null,
        },
        supabaseAdmin,
      ),
    ]);

    const gestorEmail = normalizeEmail(body.gestorEmail);
    const gestorId = normalizeText(body.gestorId) || null;

    const status = submit ? "aguardando_aprovacao" : "rascunho";
    const dados = {
      tipo_interno: true,
      loja_id: lojaId,
      loja_nome: lojaNome,
      prestador: prestadorNome,
      numero_orcamento: normalizeText(body.numeroOrcamento),
      descricao: normalizeText(body.descricao),
      valor: parseValorTotal(body.valorTotal),
      data_validade: normalizeText(body.dataValidade),
      gestor_email: gestorEmail,
      gestor_nome: normalizeText(body.gestorNome) || null,
      anexos: normalizeArquivos(body.arquivos ?? [], principal.path),
    };

    const { data: formulario, error: formularioError } = await supabaseAdmin
      .from("formularios")
      .insert({
        user_id: actor.realUserId,
        tipo: TIPO_ORCAMENTO_INTERNO,
        status,
        arquivo_path: principal.path.trim(),
        prestador_id: prestadorId,
        dados,
      })
      .select("id")
      .single();
    if (formularioError || !formulario) {
      throw formularioError ?? new Error("Falha ao criar o documento.");
    }

    const id = formulario.id as string;
    const arquivos = normalizeArquivos(body.arquivos ?? [], principal.path);

    const { data: orcamento, error: orcamentoError } = await supabaseAdmin
      .from("orcamentos_internos")
      .insert({
        id,
        solicitante_id: actor.realUserId,
        solicitante_email: actor.realEmail,
        loja_id: lojaId,
        loja_nome: lojaNome,
        area_solicitante: normalizeText(body.areaSolicitante),
        prestador_id: prestadorId,
        prestador_nome: prestadorNome,
        numero_orcamento: normalizeText(body.numeroOrcamento),
        descricao: normalizeText(body.descricao),
        valor_total: parseValorTotal(body.valorTotal),
        data_validade: normalizeText(body.dataValidade) || null,
        numero_referencia: normalizeText(body.numeroReferencia) || null,
        gestor_id: gestorId,
        gestor_email: gestorEmail ?? "",
        gestor_nome: normalizeText(body.gestorNome) || null,
        observacoes: normalizeText(body.observacoes) || null,
        arquivo_original_path: principal.path.trim(),
        status,
        enviado_em: submit ? new Date().toISOString() : null,
      })
      .select("*")
      .single();
    if (orcamentoError || !orcamento) {
      throw orcamentoError ?? new Error("Falha ao criar o orçamento.");
    }

    if (arquivos.length > 0) {
      const { error: versoesError } = await supabaseAdmin
        .from("orcamentos_internos_versoes")
        .insert(
          arquivos.map((arquivo) => ({
            orcamento_id: id,
            versao: 1,
            arquivo_path: arquivo.path,
            nome_arquivo: arquivo.name,
            mime_type: arquivo.type,
            tamanho_bytes: arquivo.size,
            principal: arquivo.principal,
            criado_por: actor.realUserId,
            criado_por_email: actor.realEmail,
          })),
        );
      if (versoesError) {
        throw versoesError;
      }
    }

    await logOrcamentoEvent({
      supabaseAdmin,
      documentoId: id,
      eventType: "orcamento_criado",
      actorId: actor.realUserId,
      actorEmail: actor.realEmail,
      to: status,
      metadata: {
        notification: submit ? "aprovadores" : null,
      },
    });

    if (submit) {
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "orcamento_enviado_aprovacao",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        from: "rascunho",
        to: status,
        metadata: { notification: "aprovadores" },
      });
    }

    return NextResponse.json({
      orcamento: mapOrcamento(orcamento as OrcamentoInternoRow),
    });
  } catch (err) {
    console.error("Erro ao criar orçamento interno:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível criar o orçamento interno.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
