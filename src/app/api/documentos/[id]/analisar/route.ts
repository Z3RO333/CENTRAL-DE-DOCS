import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { safeParseDados, sanitizeId } from "@/lib/documentosApiUtils";
import {
  ApiHttpError as HttpError,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";
import {
  baixarEAnalisarArquivo,
  buscarEquipamentosAtivosDaLoja,
  determinarStatusFinal,
  deveTentarEquipamento,
  encontrarEquipamentoCorrespondente,
  registrarAnaliseIa,
  registrarRecomendacoesCriticas,
  temAchadoUrgente,
  resolverLojaId,
} from "@/lib/documentAnalysisPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FormularioRow = {
  id: string;
  tipo: string;
  dados: Record<string, unknown> | string | null;
  arquivo_path: string | null;
  arquivo_assinado_path: string | null;
  equipamento_id: string | null;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();
    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);

    if (!canAccess) {
      throw new HttpError(403, "Apenas administradores podem analisar documentos por IA.");
    }

    const { id: rawId } = await context.params;
    const id = sanitizeId(rawId ?? "");
    if (!id) {
      throw new HttpError(400, "Informe um documento valido.");
    }

    const { data: registro, error: registroError } = await supabaseAdmin
      .from("formularios")
      .select("id,tipo,dados,arquivo_path,arquivo_assinado_path,equipamento_id")
      .eq("id", id)
      .maybeSingle();

    if (registroError) {
      throw registroError;
    }
    if (!registro) {
      throw new HttpError(404, "Documento nao encontrado.");
    }

    const row = registro as FormularioRow;
    const path = row.arquivo_assinado_path ?? row.arquivo_path;
    if (!path) {
      throw new HttpError(400, "Documento sem arquivo para analise.");
    }

    const dadosAtuais = safeParseDados(row.dados);

    const { provider, model, resultado } = await baixarEAnalisarArquivo(supabaseAdmin, {
      path,
      tipoDocumento: row.tipo,
      dadosAtuais,
    });

    const analise = await registrarAnaliseIa(supabaseAdmin, {
      documentoId: row.id,
      provider,
      model,
      resultado,
    });

    let equipamentoId: string | null = row.equipamento_id;
    let equipamentoRequerido = false;
    const lojaId = resolverLojaId(dadosAtuais);

    if (deveTentarEquipamento(row.tipo) && lojaId && !equipamentoId) {
      const sinalDeEquipamento = Boolean(
        resultado.equipamento_tipo?.trim() ||
          resultado.equipamento_numero_serie?.trim() ||
          resultado.equipamento_identificacao?.trim(),
      );
      if (sinalDeEquipamento) {
        const equipamentosAtivos = await buscarEquipamentosAtivosDaLoja(supabaseAdmin, lojaId);
        if (equipamentosAtivos.length > 0) {
          equipamentoRequerido = true;
          const match = encontrarEquipamentoCorrespondente(equipamentosAtivos, resultado);
          equipamentoId = match?.id ?? null;
        }
      }
    }

    const competencia =
      typeof dadosAtuais?.competencia === "string" ? dadosAtuais.competencia : null;

    try {
      await registrarRecomendacoesCriticas(supabaseAdmin, {
        documentoId: row.id,
        equipamentoId,
        lojaId,
        tipoDocumento: row.tipo,
        competencia,
        achados: resultado.recomendacoes_criticas ?? [],
      });
    } catch (err) {
      // Best-effort: nao deixar uma falha ao registrar mascarar o erro original.
      console.error("[documentos/analisar] Falha ao registrar recomendacoes_criticas:", err);
    }

    const statusFinal = determinarStatusFinal(resultado, {
      equipamentoRequerido,
      equipamentoResolvido: equipamentoId !== null,
      achadoUrgente: temAchadoUrgente(resultado),
    });

    const updatePayload: { status_analise_ia: string; equipamento_id?: string | null } = {
      status_analise_ia: statusFinal,
    };
    if (deveTentarEquipamento(row.tipo)) {
      updatePayload.equipamento_id = equipamentoId;
    }

    const { error: statusUpdateError } = await supabaseAdmin
      .from("formularios")
      .update(updatePayload)
      .eq("id", row.id);

    if (statusUpdateError) {
      console.error("[documentos/analisar] Falha ao atualizar status_analise_ia:", statusUpdateError);
    }

    return NextResponse.json({ analise });
  } catch (err) {
    console.error("[documentos/analisar] Erro:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && err.message.startsWith("Tipo de arquivo nao suportado:")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel analisar o documento.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
