import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  ApiHttpError as HttpError,
  getActorFromRequest,
} from "@/lib/apiAuth";
import {
  TIPO_ORCAMENTO_INTERNO,
  assertCanDecide,
  assertCanEditAsSolicitante,
  assertCanManageSignedOrcamento,
  assertCanViewOrcamento,
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
  type OrcamentoInternoAction,
  type OrcamentoInternoArquivoInput,
  type OrcamentoInternoInput,
  type OrcamentoInternoRow,
  type OrcamentoInternoStatus,
  type OrcamentoInternoVersaoRow,
} from "@/lib/orcamentosInternos";
import { type DocumentoAuditEvent } from "@/lib/documentosAudit";
import { gerarPdfAssinado, resolveAssinadoPorNome } from "@/lib/orcamentoAssinatura";

export const runtime = "nodejs";

function mapOrcamento(row: OrcamentoInternoRow) {
  return {
    ...row,
    valor_total: row.valor_total === null ? null : Number(row.valor_total),
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

async function getOrcamentoOrThrow(
  id: string,
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
) {
  const { data, error } = await supabaseAdmin
    .from("orcamentos_internos")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new HttpError(404, "Orçamento interno não encontrado.");
  }
  return data as OrcamentoInternoRow;
}

async function updateFormularioStatus(input: {
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
  id: string;
  status: OrcamentoInternoStatus;
  arquivoOriginalPath?: string;
  arquivoAssinadoPath?: string | null;
  assinadoPor?: string | null;
  dadosUpdates?: Record<string, unknown>;
}) {
  const payload: Record<string, unknown> = {
    status: input.status,
  };
  if (input.arquivoOriginalPath) {
    payload.arquivo_path = input.arquivoOriginalPath;
  }
  if (Object.prototype.hasOwnProperty.call(input, "arquivoAssinadoPath")) {
    payload.arquivo_assinado_path = input.arquivoAssinadoPath ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "assinadoPor")) {
    payload.assinado_por = input.assinadoPor ?? null;
  }
  if (input.dadosUpdates) {
    const { data: current, error: currentError } = await input.supabaseAdmin
      .from("formularios")
      .select("dados")
      .eq("id", input.id)
      .maybeSingle();
    if (currentError) throw currentError;
    payload.dados = {
      ...((current?.dados as Record<string, unknown> | null) ?? {}),
      ...input.dadosUpdates,
    };
  }

  const { error } = await input.supabaseAdmin
    .from("formularios")
    .update(payload)
    .eq("id", input.id)
    .eq("tipo", TIPO_ORCAMENTO_INTERNO);
  if (error) throw error;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    await assertInternalActor({ actor, supabaseAdmin });
    const aprovadores = await getAprovadorEmails(supabaseAdmin);

    const orcamento = await getOrcamentoOrThrow(id, supabaseAdmin);
    assertCanViewOrcamento(orcamento, actor, aprovadores);

    const [versoesResult, timelineResult] = await Promise.all([
      supabaseAdmin
        .from("orcamentos_internos_versoes")
        .select("*")
        .eq("orcamento_id", id)
        .order("versao", { ascending: false })
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("documentos_auditoria")
        .select("id,documento_id,event_type,actor_id,actor_email,metadata,created_at")
        .eq("documento_id", id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (versoesResult.error) throw versoesResult.error;
    if (timelineResult.error) throw timelineResult.error;

    const actorRealEmail = normalizeEmail(actor.realEmail);
    const actorIsAprovador =
      actorRealEmail !== null && aprovadores.has(actorRealEmail);
    if (actorIsAprovador) {
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "orcamento_visualizado_gestor",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        metadata: { status: orcamento.status },
      });
    }

    return NextResponse.json({
      orcamento: mapOrcamento(orcamento),
      versoes: ((versoesResult.data as OrcamentoInternoVersaoRow[] | null) ?? []),
      timeline:
        ((timelineResult.data as DocumentoAuditEvent[] | null) ?? []).map(
          (event) => ({
            ...event,
            metadata: event.metadata ?? {},
          }),
        ),
      isAdmin: actor.isAdmin,
      canDecide:
        ["aguardando_aprovacao", "em_analise_gestor", "reenviado"].includes(
          orcamento.status,
        ) &&
        (actor.realIsAdmin || actorIsAprovador) &&
        orcamento.solicitante_id !== actor.realUserId,
    });
  } catch (err) {
    console.error("Erro ao carregar orçamento interno:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível carregar o orçamento interno.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    await assertInternalActor({ actor, supabaseAdmin });
    const aprovadores = await getAprovadorEmails(supabaseAdmin);

    const body = (await request.json()) as OrcamentoInternoInput & {
      action?: OrcamentoInternoAction;
      justificativa?: string;
    };
    const action = body.action;
    if (!action) {
      throw new HttpError(400, "Informe a ação do orçamento.");
    }

    const current = await getOrcamentoOrThrow(id, supabaseAdmin);
    assertCanViewOrcamento(current, actor, aprovadores);
    const from = current.status;

    if (action === "registrar_numero_pedido") {
      assertCanManageSignedOrcamento(current, actor);
      const numeroPedido = normalizeText(body.numeroPedido) || null;
      if (!numeroPedido) {
        throw new HttpError(400, "Informe o número do pedido.");
      }

      const { data, error } = await supabaseAdmin
        .from("orcamentos_internos")
        .update({ numero_pedido: numeroPedido })
        .eq("id", id)
        .eq("status", "aprovado_assinado")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        throw new HttpError(409, "O orçamento mudou enquanto o pedido era salvo.");
      }

      try {
        await updateFormularioStatus({
          supabaseAdmin,
          id,
          status: current.status,
          dadosUpdates: { numero_pedido: numeroPedido },
        });
      } catch (errorFormulario) {
        await supabaseAdmin
          .from("orcamentos_internos")
          .update({ numero_pedido: current.numero_pedido })
          .eq("id", id);
        throw errorFormulario;
      }

      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "numero_pedido_registrado",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        from: current.numero_pedido,
        to: numeroPedido,
      });
      return NextResponse.json({
        orcamento: mapOrcamento(data as OrcamentoInternoRow),
      });
    }

    if (action === "substituir_pdf_assinado") {
      assertCanManageSignedOrcamento(current, actor);
      const principal = getArquivoPrincipal(body.arquivos ?? []);
      if (!principal?.path) {
        throw new HttpError(400, "Envie o novo PDF do orçamento.");
      }
      if (!principal.name?.toLowerCase().endsWith(".pdf")) {
        throw new HttpError(400, "O arquivo substituto deve ser um PDF.");
      }

      const novoOriginalPath = principal.path.trim();
      const hasNovoValor = Object.prototype.hasOwnProperty.call(body, "valorTotal");
      const novoValorTotal = hasNovoValor
        ? parseValorTotal(body.valorTotal)
        : current.valor_total;
      if (hasNovoValor && novoValorTotal === null) {
        throw new HttpError(400, "Informe um novo valor total válido.");
      }
      const assinadoPorNome = await resolveAssinadoPorNome(supabaseAdmin, {
        userId: actor.realUserId,
        email: actor.realEmail,
      });
      const novoAssinadoPath = await gerarPdfAssinado({
        supabaseAdmin,
        orcamentoId: id,
        arquivoOriginalPath: novoOriginalPath,
        assinadoPorNome,
        assinadoPorUserId: actor.realUserId,
      });
      const nextVersion = current.versao_atual + 1;

      const { data: versaoCriada, error: versaoError } = await supabaseAdmin
        .from("orcamentos_internos_versoes")
        .insert({
          orcamento_id: id,
          versao: nextVersion,
          arquivo_path: novoOriginalPath,
          arquivo_assinado_path: novoAssinadoPath,
          nome_arquivo:
            normalizeText(principal.name) ||
            novoOriginalPath.split("/").pop() ||
            "orcamento.pdf",
          mime_type: normalizeText(principal.type) || "application/pdf",
          tamanho_bytes:
            typeof principal.size === "number" ? principal.size : null,
          principal: true,
          criado_por: actor.realUserId,
          criado_por_email: actor.realEmail,
        })
        .select("id")
        .single();
      if (versaoError || !versaoCriada) {
        await supabaseAdmin.storage
          .from("formularios")
          .remove([novoOriginalPath, novoAssinadoPath]);
        throw versaoError ?? new Error("Falha ao registrar a nova versão.");
      }

      const { data, error } = await supabaseAdmin
        .from("orcamentos_internos")
        .update({
          arquivo_original_path: novoOriginalPath,
          arquivo_assinado_path: novoAssinadoPath,
          versao_atual: nextVersion,
          valor_total: novoValorTotal,
        })
        .eq("id", id)
        .eq("status", "aprovado_assinado")
        .eq("versao_atual", current.versao_atual)
        .select("*")
        .maybeSingle();
      if (error || !data) {
        await Promise.all([
          supabaseAdmin
            .from("orcamentos_internos_versoes")
            .delete()
            .eq("id", versaoCriada.id),
          supabaseAdmin.storage
            .from("formularios")
            .remove([novoOriginalPath, novoAssinadoPath]),
        ]);
        throw (
          error ??
          new HttpError(409, "O orçamento mudou durante a substituição do PDF.")
        );
      }

      await updateFormularioStatus({
        supabaseAdmin,
        id,
        status: current.status,
        arquivoOriginalPath: novoOriginalPath,
        arquivoAssinadoPath: novoAssinadoPath,
        assinadoPor: actor.realEmail,
        ...(hasNovoValor ? { dadosUpdates: { valor: novoValorTotal } } : {}),
      });
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "orcamento_pdf_substituido",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        metadata: {
          versao_anterior: current.versao_atual,
          versao_atual: nextVersion,
          arquivo_original_anterior: current.arquivo_original_path,
          arquivo_assinado_anterior: current.arquivo_assinado_path,
          arquivo_original_atual: novoOriginalPath,
          arquivo_assinado_atual: novoAssinadoPath,
          valor_anterior: current.valor_total,
          valor_atual: novoValorTotal,
        },
      });
      return NextResponse.json({
        orcamento: mapOrcamento(data as OrcamentoInternoRow),
      });
    }

    if (action === "salvar_rascunho" || action === "corrigir_metadados") {
      if (action === "corrigir_metadados" && !actor.realIsAdmin) {
        throw new HttpError(403, "Somente administradores podem corrigir metadados.");
      }
      if (action === "salvar_rascunho") {
        assertCanEditAsSolicitante(current, actor);
      }
      const lojaId = normalizeText(body.lojaId) || current.loja_id;
      const prestadorId =
        Object.prototype.hasOwnProperty.call(body, "prestadorId")
          ? normalizeText(body.prestadorId) || null
          : current.prestador_id;
      const [lojaNome, prestadorNome] = await Promise.all([
        resolveLojaNome(lojaId, supabaseAdmin),
        resolvePrestadorNome(
          {
            prestadorId,
            prestadorNome: body.prestadorNome ?? current.prestador_nome,
          },
          supabaseAdmin,
        ),
      ]);

      const updates = {
        loja_id: lojaId,
        loja_nome: lojaNome,
        area_solicitante:
          normalizeText(body.areaSolicitante) || current.area_solicitante,
        prestador_id: prestadorId,
        prestador_nome: prestadorNome,
        fornecedor_cnpj: Object.prototype.hasOwnProperty.call(body, "fornecedorCnpj")
          ? normalizeText(body.fornecedorCnpj) || null
          : current.fornecedor_cnpj,
        numero_orcamento: Object.prototype.hasOwnProperty.call(body, "numeroOrcamento")
          ? normalizeText(body.numeroOrcamento)
          : current.numero_orcamento,
        descricao: Object.prototype.hasOwnProperty.call(body, "descricao")
          ? normalizeText(body.descricao)
          : current.descricao,
        valor_total: Object.prototype.hasOwnProperty.call(body, "valorTotal")
          ? parseValorTotal(body.valorTotal)
          : current.valor_total,
        data_validade: Object.prototype.hasOwnProperty.call(body, "dataValidade")
          ? normalizeText(body.dataValidade) || null
          : current.data_validade,
        numero_referencia:
          normalizeText(body.numeroReferencia) || current.numero_referencia,
        observacoes: normalizeText(body.observacoes) || current.observacoes,
      };
      const { data, error } = await supabaseAdmin
        .from("orcamentos_internos")
        .update(updates)
        .eq("id", id)
        .select("*")
        .single();
      if (error || !data) throw error ?? new Error("Falha ao atualizar.");
      await updateFormularioStatus({
        supabaseAdmin,
        id,
        status: current.status,
        dadosUpdates: {
          loja_id: updates.loja_id,
          loja_nome: updates.loja_nome,
          prestador: updates.prestador_nome,
          fornecedor_cnpj: updates.fornecedor_cnpj,
          numero_orcamento: updates.numero_orcamento,
          descricao: updates.descricao,
          valor: updates.valor_total,
          data_validade: updates.data_validade,
        },
      });
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "documento_editado",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
      });
      return NextResponse.json({ orcamento: mapOrcamento(data as OrcamentoInternoRow) });
    }

    if (action === "enviar_aprovacao" || action === "reenviar") {
      assertCanEditAsSolicitante(current, actor);
      validateOrcamentoInput(
        {
          ...body,
          lojaId: body.lojaId ?? current.loja_id,
          areaSolicitante: body.areaSolicitante ?? current.area_solicitante,
          prestadorId: body.prestadorId ?? current.prestador_id,
          prestadorNome: body.prestadorNome ?? current.prestador_nome,
          fornecedorCnpj: body.fornecedorCnpj ?? current.fornecedor_cnpj,
          numeroOrcamento: body.numeroOrcamento ?? current.numero_orcamento,
          descricao: body.descricao ?? current.descricao,
          valorTotal: body.valorTotal ?? current.valor_total,
          dataValidade: body.dataValidade ?? current.data_validade,
          arquivos:
            body.arquivos && body.arquivos.length > 0
              ? body.arquivos
              : [
                  {
                    path: current.arquivo_original_path,
                    name: current.arquivo_original_path.split("/").pop(),
                    type: "application/pdf",
                    principal: true,
                  },
                ],
        },
        "submit",
      );

      const principal =
        body.arquivos && body.arquivos.length > 0
          ? getArquivoPrincipal(body.arquivos)
          : {
              path: current.arquivo_original_path,
              name: current.arquivo_original_path.split("/").pop(),
              type: "application/pdf",
              principal: true,
            };
      if (!principal?.path) {
        throw new HttpError(400, "Arquivo principal não informado.");
      }

      const lojaId = normalizeText(body.lojaId) || current.loja_id;
      const prestadorId =
        Object.prototype.hasOwnProperty.call(body, "prestadorId")
          ? normalizeText(body.prestadorId) || null
          : current.prestador_id;
      const [lojaNome, prestadorNome] = await Promise.all([
        resolveLojaNome(lojaId, supabaseAdmin),
        resolvePrestadorNome(
          {
            prestadorId,
            prestadorNome: body.prestadorNome ?? current.prestador_nome,
          },
          supabaseAdmin,
        ),
      ]);

      const nextStatus: OrcamentoInternoStatus =
        action === "reenviar" ? "reenviado" : "aguardando_aprovacao";
      const nextVersion =
        body.arquivos && body.arquivos.length > 0
          ? current.versao_atual + 1
          : current.versao_atual;
      const updates = {
        loja_id: lojaId,
        loja_nome: lojaNome,
        area_solicitante:
          normalizeText(body.areaSolicitante) || current.area_solicitante,
        prestador_id: prestadorId,
        prestador_nome: prestadorNome,
        fornecedor_cnpj: Object.prototype.hasOwnProperty.call(body, "fornecedorCnpj")
          ? normalizeText(body.fornecedorCnpj) || null
          : current.fornecedor_cnpj,
        numero_orcamento: Object.prototype.hasOwnProperty.call(body, "numeroOrcamento")
          ? normalizeText(body.numeroOrcamento)
          : current.numero_orcamento,
        descricao: Object.prototype.hasOwnProperty.call(body, "descricao")
          ? normalizeText(body.descricao)
          : current.descricao,
        valor_total: Object.prototype.hasOwnProperty.call(body, "valorTotal")
          ? parseValorTotal(body.valorTotal)
          : current.valor_total,
        data_validade: Object.prototype.hasOwnProperty.call(body, "dataValidade")
          ? normalizeText(body.dataValidade) || null
          : current.data_validade,
        numero_referencia:
          normalizeText(body.numeroReferencia) || current.numero_referencia,
        observacoes: normalizeText(body.observacoes) || current.observacoes,
        arquivo_original_path: principal.path.trim(),
        status: nextStatus,
        versao_atual: nextVersion,
        enviado_em: new Date().toISOString(),
        ultima_justificativa: null,
        gestor_id: null,
        gestor_email: "",
        gestor_nome: null,
      };
      const { data, error } = await supabaseAdmin
        .from("orcamentos_internos")
        .update(updates)
        .eq("id", id)
        .select("*")
        .single();
      if (error || !data) throw error ?? new Error("Falha ao reenviar.");

      if (body.arquivos && body.arquivos.length > 0) {
        const arquivos = normalizeArquivos(body.arquivos, principal.path);
        const { error: versoesError } = await supabaseAdmin
          .from("orcamentos_internos_versoes")
          .insert(
            arquivos.map((arquivo) => ({
              orcamento_id: id,
              versao: nextVersion,
              arquivo_path: arquivo.path,
              nome_arquivo: arquivo.name,
              mime_type: arquivo.type,
              tamanho_bytes: arquivo.size,
              principal: arquivo.principal,
              arquivo_assinado_path: null,
              criado_por: actor.realUserId,
              criado_por_email: actor.realEmail,
            })),
          );
        if (versoesError) throw versoesError;
      }

      await updateFormularioStatus({
        supabaseAdmin,
        id,
        status: nextStatus,
        arquivoOriginalPath: principal.path.trim(),
        dadosUpdates: {
          loja_id: updates.loja_id,
          loja_nome: updates.loja_nome,
          prestador: updates.prestador_nome,
          fornecedor_cnpj: updates.fornecedor_cnpj,
          numero_orcamento: updates.numero_orcamento,
          descricao: updates.descricao,
          valor: updates.valor_total,
          data_validade: updates.data_validade,
        },
      });
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType:
          action === "reenviar"
            ? "orcamento_reenviado"
            : "orcamento_enviado_aprovacao",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        from,
        to: nextStatus,
        metadata: { notification: "aprovadores" },
      });
      return NextResponse.json({ orcamento: mapOrcamento(data as OrcamentoInternoRow) });
    }

    if (action === "solicitar_ajuste") {
      assertCanDecide(current, actor, aprovadores);
      const justificativa = normalizeText(body.justificativa);
      if (!justificativa) {
        throw new HttpError(400, "Informe a justificativa do ajuste.");
      }
      const nextStatus: OrcamentoInternoStatus = "ajuste_solicitado";
      const { data, error } = await supabaseAdmin
        .from("orcamentos_internos")
        .update({
          status: nextStatus,
          ultima_justificativa: justificativa,
          gestor_id: actor.realUserId,
          gestor_email: actor.realEmail ?? "",
          gestor_nome: null,
        })
        .eq("id", id)
        .eq("status", from)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        throw new HttpError(409, "Este orçamento já foi decidido por outro gestor.");
      }
      await updateFormularioStatus({ supabaseAdmin, id, status: nextStatus });
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "ajuste_solicitado",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        from,
        to: nextStatus,
        justificativa,
        metadata: { notification: "solicitante" },
      });
      return NextResponse.json({ orcamento: mapOrcamento(data as OrcamentoInternoRow) });
    }

    if (action === "rejeitar") {
      assertCanDecide(current, actor, aprovadores);
      const justificativa = normalizeText(body.justificativa);
      if (!justificativa) {
        throw new HttpError(400, "Informe a justificativa da rejeição.");
      }
      const nextStatus: OrcamentoInternoStatus = "rejeitado";
      const { data, error } = await supabaseAdmin
        .from("orcamentos_internos")
        .update({
          status: nextStatus,
          rejeitado_em: new Date().toISOString(),
          ultima_justificativa: justificativa,
          gestor_id: actor.realUserId,
          gestor_email: actor.realEmail ?? "",
          gestor_nome: null,
        })
        .eq("id", id)
        .eq("status", from)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        throw new HttpError(409, "Este orçamento já foi decidido por outro gestor.");
      }
      await updateFormularioStatus({ supabaseAdmin, id, status: nextStatus });
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "orcamento_rejeitado",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        from,
        to: nextStatus,
        justificativa,
        metadata: { notification: "solicitante" },
      });
      return NextResponse.json({ orcamento: mapOrcamento(data as OrcamentoInternoRow) });
    }

    if (action === "devolver_sem_decisao") {
      assertCanDecide(current, actor, aprovadores);
      const nextStatus: OrcamentoInternoStatus = "aguardando_aprovacao";
      const { data, error } = await supabaseAdmin
        .from("orcamentos_internos")
        .update({ status: nextStatus })
        .eq("id", id)
        .eq("status", from)
        .select("*")
        .single();
      if (error || !data) throw error ?? new Error("Falha ao devolver.");
      await updateFormularioStatus({ supabaseAdmin, id, status: nextStatus });
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "orcamento_devolvido_sem_decisao",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        from,
        to: nextStatus,
      });
      return NextResponse.json({ orcamento: mapOrcamento(data as OrcamentoInternoRow) });
    }

    if (action === "aprovar_assinar") {
      assertCanDecide(current, actor, aprovadores);

      const assinadoPorNome = await resolveAssinadoPorNome(supabaseAdmin, {
        userId: actor.realUserId,
        email: actor.realEmail,
      });
      const signedPath = await gerarPdfAssinado({
        supabaseAdmin,
        orcamentoId: id,
        arquivoOriginalPath: current.arquivo_original_path,
        assinadoPorNome,
        assinadoPorUserId: actor.realUserId,
      });

      const nextStatus: OrcamentoInternoStatus = "aprovado_assinado";
      const now = new Date().toISOString();
      const { data, error } = await supabaseAdmin
        .from("orcamentos_internos")
        .update({
          status: nextStatus,
          arquivo_assinado_path: signedPath,
          aprovado_em: now,
          ultima_justificativa: null,
          gestor_id: actor.realUserId,
          gestor_email: actor.realEmail ?? "",
          gestor_nome: null,
        })
        .eq("id", id)
        .eq("status", from)
        .select("*")
        .maybeSingle();
      if (error) {
        await supabaseAdmin.storage.from("formularios").remove([signedPath]);
        throw error;
      }
      if (!data) {
        await supabaseAdmin.storage.from("formularios").remove([signedPath]);
        throw new HttpError(409, "Este orçamento já foi decidido por outro gestor.");
      }
      await updateFormularioStatus({
        supabaseAdmin,
        id,
        status: nextStatus,
        arquivoAssinadoPath: signedPath,
        assinadoPor: actor.realEmail,
      });
      const { error: versaoAssinadaError } = await supabaseAdmin
        .from("orcamentos_internos_versoes")
        .update({ arquivo_assinado_path: signedPath })
        .eq("orcamento_id", id)
        .eq("versao", current.versao_atual)
        .eq("principal", true);
      if (versaoAssinadaError) throw versaoAssinadaError;
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "orcamento_aprovado",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        from,
        to: nextStatus,
        metadata: { approved_at: now, notification: "solicitante" },
      });
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "orcamento_assinado",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        metadata: { arquivo_assinado_path: signedPath },
      });
      return NextResponse.json({ orcamento: mapOrcamento(data as OrcamentoInternoRow) });
    }

    if (action === "cancelar") {
      if (!actor.realIsAdmin) {
        throw new HttpError(403, "Somente administradores podem cancelar solicitações.");
      }
      const nextStatus: OrcamentoInternoStatus = "cancelado";
      const { data, error } = await supabaseAdmin
        .from("orcamentos_internos")
        .update({
          status: nextStatus,
          cancelado_em: new Date().toISOString(),
          ultima_justificativa: normalizeText(body.justificativa) || null,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error || !data) throw error ?? new Error("Falha ao cancelar.");
      await updateFormularioStatus({ supabaseAdmin, id, status: nextStatus });
      await logOrcamentoEvent({
        supabaseAdmin,
        documentoId: id,
        eventType: "orcamento_cancelado",
        actorId: actor.realUserId,
        actorEmail: actor.realEmail,
        from,
        to: nextStatus,
        justificativa: normalizeText(body.justificativa) || null,
      });
      return NextResponse.json({ orcamento: mapOrcamento(data as OrcamentoInternoRow) });
    }

    throw new HttpError(400, "Ação inválida para orçamento interno.");
  } catch (err) {
    console.error("Erro ao atualizar orçamento interno:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível atualizar o orçamento interno.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    await assertInternalActor({ actor, supabaseAdmin });
    const aprovadores = await getAprovadorEmails(supabaseAdmin);
    const current = await getOrcamentoOrThrow(id, supabaseAdmin);
    assertCanViewOrcamento(current, actor, aprovadores);

    await logOrcamentoEvent({
      supabaseAdmin,
      documentoId: id,
      eventType: "documento_baixado",
      actorId: actor.realUserId,
      actorEmail: actor.realEmail,
      metadata: (await request.json().catch(() => ({}))) as Record<string, unknown>,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Erro ao registrar auditoria do orçamento interno:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Não foi possível registrar auditoria." },
      { status: 500 },
    );
  }
}
