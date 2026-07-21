import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  ApiHttpError as HttpError,
  getActorFromRequest,
  getAuthorizedPrestadorIds,
} from "@/lib/apiAuth";
import { logDocumentoAuditEvent } from "@/lib/documentosAudit";
import { normalizeText, parseValorTotal } from "@/lib/orcamentosInternos";
import { parseCompetencia } from "@/lib/competencia";

export type NotaFiscalConservacaoRow = {
  id: string;
  prestador_id: string;
  loja_id: string;
  numero_nf: string;
  numero_pedido: string | null;
  valor: number | null;
  competencia: string | null;
  data_recebimento: string;
  observacoes: string | null;
  status: "aguardando_verificacao" | "concluida" | "rejeitada";
  motivo_status: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type NotaFiscalConservacaoInput = {
  prestadorId?: string;
  lojaId?: string;
  numeroNf?: string;
  numeroPedido?: string;
  valor?: string | number | null;
  competencia?: string;
  dataRecebimento?: string;
  observacoes?: string;
  arquivo?: { path?: string; name?: string; type?: string; size?: number };
};

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);

    if (!actor.realUserId) {
      throw new HttpError(401, "Sessão inválida.");
    }

    const body = (await request.json()) as NotaFiscalConservacaoInput;

    const prestadorId = normalizeText(body.prestadorId);
    const lojaId = normalizeText(body.lojaId);
    const numeroNf = normalizeText(body.numeroNf);
    const dataRecebimento = normalizeText(body.dataRecebimento);
    const arquivoPath = normalizeText(body.arquivo?.path);

    if (!prestadorId || !lojaId || !numeroNf || !dataRecebimento || !arquivoPath) {
      throw new HttpError(
        400,
        "Informe prestador, loja, número da NF, data de recebimento e o anexo.",
      );
    }

    if (!actor.isAdmin) {
      const allowedPrestadores = await getAuthorizedPrestadorIds(
        actor.email,
        supabaseAdmin,
      );
      if (!allowedPrestadores.includes(prestadorId)) {
        throw new HttpError(
          403,
          "Você não possui acesso para cadastrar notas para este prestador.",
        );
      }
    }

    const { data: prestador, error: prestadorError } = await supabaseAdmin
      .from("prestadores")
      .select("id,nome,categoria")
      .eq("id", prestadorId)
      .maybeSingle();
    if (prestadorError) {
      throw prestadorError;
    }
    if (!prestador) {
      throw new HttpError(404, "Prestador não encontrado.");
    }
    if (prestador.categoria !== "conservacao") {
      throw new HttpError(
        400,
        "Este prestador não é uma empresa de conservação.",
      );
    }

    const { data: loja, error: lojaError } = await supabaseAdmin
      .from("lojas")
      .select("id,nome,codigo")
      .eq("id", lojaId)
      .maybeSingle();
    if (lojaError) {
      throw lojaError;
    }
    if (!loja) {
      throw new HttpError(404, "Loja não encontrada.");
    }

    const competenciaRaw = normalizeText(body.competencia);
    const competencia = competenciaRaw
      ? parseCompetencia(competenciaRaw)?.label ?? null
      : null;
    if (competenciaRaw && !competencia) {
      throw new HttpError(400, "Competência inválida. Use o formato MM/AAAA.");
    }

    const { data: existente, error: existenteError } = await supabaseAdmin
      .from("notas_fiscais_conservacao")
      .select("id")
      .eq("prestador_id", prestadorId)
      .eq("numero_nf", numeroNf)
      .maybeSingle();
    if (existenteError) {
      throw existenteError;
    }
    if (existente) {
      throw new HttpError(
        409,
        "Já existe uma nota fiscal cadastrada com este número para este prestador.",
      );
    }

    const valor = parseValorTotal(body.valor);
    const numeroPedido = normalizeText(body.numeroPedido) || null;
    const observacoes = normalizeText(body.observacoes) || null;
    const nomeArquivo = normalizeText(body.arquivo?.name) || arquivoPath.split("/").pop() || "nota.pdf";

    const { data: formulario, error: formularioError } = await supabaseAdmin
      .from("formularios")
      .insert({
        user_id: actor.realUserId,
        tipo: "notas_fiscais_conservacao",
        status: "em_analise",
        arquivo_path: arquivoPath,
        prestador_id: prestadorId,
        dados: {
          loja_id: lojaId,
          loja_nome: loja.codigo ? `${loja.nome} - ${loja.codigo}` : loja.nome,
          prestador: prestador.nome,
          numero_nf: numeroNf,
          numero_pedido: numeroPedido,
          valor,
          competencia,
          data_recebimento: dataRecebimento,
          observacoes,
          nome_arquivo: nomeArquivo,
        },
      })
      .select("id")
      .single();
    if (formularioError || !formulario) {
      throw formularioError ?? new Error("Falha ao criar o documento.");
    }

    const id = formulario.id as string;

    const { data: nota, error: notaError } = await supabaseAdmin
      .from("notas_fiscais_conservacao")
      .insert({
        id,
        prestador_id: prestadorId,
        loja_id: lojaId,
        numero_nf: numeroNf,
        numero_pedido: numeroPedido,
        valor,
        competencia,
        data_recebimento: dataRecebimento,
        observacoes,
        created_by: actor.realUserId,
      })
      .select("*")
      .single();
    if (notaError) {
      if (notaError.code === "23505") {
        throw new HttpError(
          409,
          "Já existe uma nota fiscal cadastrada com este número para este prestador.",
        );
      }
      throw notaError;
    }
    if (!nota) {
      throw new Error("Falha ao criar a nota fiscal.");
    }

    await logDocumentoAuditEvent({
      supabaseAdmin,
      documentoId: id,
      eventType: "nota_conservacao_criada",
      actorId: actor.realUserId,
      actorEmail: actor.realEmail,
      metadata: { prestador_id: prestadorId, numero_nf: numeroNf },
    });

    return NextResponse.json({ nota: nota as NotaFiscalConservacaoRow });
  } catch (err) {
    console.error("Erro ao criar nota fiscal de conservação:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível criar a nota fiscal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
