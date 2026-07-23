import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { analisarDocumentoComOpenAi } from "@/lib/openAiDocumentAnalysis";
import {
  assertCanEditAsSolicitante,
  assertInternalActor,
  logOrcamentoEvent,
  normalizeText,
  type OrcamentoInternoRow,
} from "@/lib/orcamentosInternos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function onlyDigits(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

function normalizeName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    await assertInternalActor({ actor, supabaseAdmin });

    const { data, error } = await supabaseAdmin
      .from("orcamentos_internos")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new HttpError(404, "Orçamento interno não encontrado.");
    }

    const orcamento = data as OrcamentoInternoRow;
    assertCanEditAsSolicitante(orcamento, actor);

    const path = orcamento.arquivo_original_path;
    if (!path.toLowerCase().endsWith(".pdf")) {
      throw new HttpError(400, "A análise automática aceita apenas PDF.");
    }

    const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
      .from("formularios")
      .download(path);
    if (downloadError || !fileBlob) {
      throw downloadError ?? new Error("Não foi possível baixar o orçamento.");
    }

    const { provider, model, resultado } = await analisarDocumentoComOpenAi({
      fileName: path.split("/").pop() || "orcamento.pdf",
      mimeType: "application/pdf",
      bytes: await fileBlob.arrayBuffer(),
      tipoDocumento: "orcamentos",
      dadosAtuais: {
        prestador: orcamento.prestador_nome,
        fornecedor_cnpj: orcamento.fornecedor_cnpj,
        numero_orcamento: orcamento.numero_orcamento,
        valor: orcamento.valor_total,
        data_validade: orcamento.data_validade,
        descricao: orcamento.descricao,
      },
    });

    const fornecedorExtraido = normalizeText(resultado.prestador) || null;
    const cnpjExtraido = normalizeText(resultado.cnpj) || null;
    const { data: prestadores, error: prestadoresError } = await supabaseAdmin
      .from("prestadores")
      .select("id,nome,cnpj");
    if (prestadoresError) throw prestadoresError;

    const cnpjDigits = onlyDigits(cnpjExtraido);
    const fornecedorNormalizado = normalizeName(fornecedorExtraido);
    const prestadorEncontrado = (prestadores ?? []).find((prestador) => {
      if (cnpjDigits && onlyDigits(prestador.cnpj as string | null) === cnpjDigits) {
        return true;
      }
      return (
        fornecedorNormalizado.length > 0 &&
        normalizeName(prestador.nome as string | null) === fornecedorNormalizado
      );
    });

    const sugestao = {
      prestadorId: (prestadorEncontrado?.id as string | undefined) ?? null,
      prestadorNome:
        normalizeText(prestadorEncontrado?.nome) || fornecedorExtraido || "",
      fornecedorCnpj: cnpjExtraido ?? "",
      numeroOrcamento: normalizeText(resultado.numero_orcamento),
      valorTotal:
        typeof resultado.valor_total === "number" ? resultado.valor_total : null,
      dataValidade: normalizeText(resultado.data_validade) || null,
      descricao:
        normalizeText(resultado.descricao) || normalizeText(resultado.objeto),
      confianca: resultado.confianca_geral,
      alertas: resultado.alertas,
    };

    const { error: insertError } = await supabaseAdmin
      .from("documentos_analises_ia")
      .insert({
        documento_id: id,
        provider,
        model,
        status: "concluida",
        resultado,
      });
    if (insertError) throw insertError;

    await logOrcamentoEvent({
      supabaseAdmin,
      documentoId: id,
      eventType: "orcamento_analisado_ia",
      actorId: actor.realUserId,
      actorEmail: actor.realEmail,
      metadata: {
        provider,
        model,
        confianca: resultado.confianca_geral,
        prestador_encontrado: Boolean(prestadorEncontrado),
      },
    });

    return NextResponse.json({ sugestao, resultado, provider, model });
  } catch (err) {
    console.error("Erro ao analisar orçamento interno com IA:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Não foi possível analisar o orçamento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
