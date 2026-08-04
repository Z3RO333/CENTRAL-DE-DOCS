import {
  analisarDocumentoComOpenAi,
  type DocumentoAnaliseIa,
} from "@/lib/openAiDocumentAnalysis";
import { safeParseDados } from "@/lib/documentosApiUtils";
import type { SupabaseClient } from "@supabase/supabase-js";

export const TIPOS_ANALISE_AUTOMATICA = [
  "notas_fiscais",
  "registro_laudos",
  "retencao_trabalhista",
  "contratos",
  "orcamentos",
] as const;

export function deveAnalisarAutomaticamente(tipo: string): boolean {
  return (TIPOS_ANALISE_AUTOMATICA as readonly string[]).includes(tipo);
}

const LIMIAR_CONFIANCA_REVISAO = 0.5;

export function determinarStatusFinal(
  resultado: DocumentoAnaliseIa,
): "concluida" | "necessita_revisao" {
  const semLoja = !resultado.lojas || resultado.lojas.length === 0;
  const semCompetencia =
    !resultado.competencias || resultado.competencias.length === 0;
  const confiancaBaixa =
    typeof resultado.confianca_geral !== "number" ||
    resultado.confianca_geral < LIMIAR_CONFIANCA_REVISAO;

  if (semLoja || semCompetencia || confiancaBaixa) {
    return "necessita_revisao";
  }
  return "concluida";
}

export function verificarSegredoWebhook(
  authHeader: string | null,
  secretEsperado: string | undefined,
): boolean {
  if (!secretEsperado) {
    return false;
  }
  return authHeader === `Bearer ${secretEsperado}`;
}

export function resolveMimeType(path: string, fallback?: string | null) {
  if (fallback?.trim()) {
    return fallback;
  }

  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export function resolveFileName(path: string) {
  return path.split("/").pop() || "documento.pdf";
}

type FormularioParaDuplicidade = {
  tipo: string;
  prestador_id: string | null;
  dados: Record<string, unknown> | null;
};

export async function verificarDuplicado(
  supabaseAdmin: SupabaseClient,
  documentoId: string,
  documento: FormularioParaDuplicidade,
): Promise<boolean> {
  const lojaId =
    typeof documento.dados?.loja_id === "string" ? documento.dados.loja_id : null;
  const competencia =
    typeof documento.dados?.competencia === "string"
      ? documento.dados.competencia
      : null;

  if (!lojaId || !competencia || !documento.prestador_id) {
    return false;
  }

  const { data, error } = await supabaseAdmin
    .from("formularios")
    .select("id")
    .eq("tipo", documento.tipo)
    .eq("prestador_id", documento.prestador_id)
    .eq("dados->>loja_id", lojaId)
    .eq("dados->>competencia", competencia)
    .eq("status_analise_ia", "concluida")
    .neq("id", documentoId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

export async function baixarEAnalisarArquivo(
  supabaseAdmin: SupabaseClient,
  params: {
    path: string;
    tipoDocumento: string | null;
    dadosAtuais?: Record<string, unknown> | null;
  },
) {
  const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
    .from("formularios")
    .download(params.path);

  if (downloadError || !fileBlob) {
    throw downloadError ?? new Error("Nao foi possivel baixar o arquivo.");
  }

  const mimeType = resolveMimeType(params.path, fileBlob.type);
  if (
    mimeType !== "application/pdf" &&
    mimeType !== "image/png" &&
    mimeType !== "image/jpeg"
  ) {
    throw new Error(`Tipo de arquivo nao suportado: ${mimeType}.`);
  }

  return analisarDocumentoComOpenAi({
    fileName: resolveFileName(params.path),
    mimeType,
    bytes: await fileBlob.arrayBuffer(),
    dadosAtuais: params.dadosAtuais ?? null,
    tipoDocumento: params.tipoDocumento,
  });
}

export async function registrarAnaliseIa(
  supabaseAdmin: SupabaseClient,
  params: {
    documentoId: string;
    provider: string;
    model: string;
    resultado?: DocumentoAnaliseIa;
    erro?: string;
  },
) {
  const status = params.erro ? "erro" : "concluida";
  const { data, error } = await supabaseAdmin
    .from("documentos_analises_ia")
    .insert({
      documento_id: params.documentoId,
      provider: params.provider,
      model: params.model,
      status,
      resultado: params.resultado ?? {},
      erro: params.erro ?? null,
    })
    .select("id,documento_id,provider,model,status,resultado,erro,created_at")
    .single();

  if (error) {
    throw error;
  }
  return data as {
    id: string;
    documento_id: string;
    provider: string;
    model: string;
    status: string;
    resultado: DocumentoAnaliseIa;
    erro: string | null;
    created_at: string;
  };
}

type FormularioRow = {
  id: string;
  tipo: string;
  dados: Record<string, unknown> | string | null;
  arquivo_path: string | null;
  arquivo_assinado_path: string | null;
  prestador_id: string | null;
};

export async function processarDocumentoComIa(
  supabaseAdmin: SupabaseClient,
  documentoId: string,
): Promise<{ status: string; motivo?: string }> {
  try {
    const { data: registro, error: registroError } = await supabaseAdmin
      .from("formularios")
      .select("id,tipo,dados,arquivo_path,arquivo_assinado_path,prestador_id")
      .eq("id", documentoId)
      .maybeSingle();

    if (registroError) {
      throw registroError;
    }
    if (!registro) {
      return { status: "erro", motivo: "Documento nao encontrado." };
    }

    const row = registro as FormularioRow;
    if (!deveAnalisarAutomaticamente(row.tipo)) {
      return { status: "ignorado", motivo: `Tipo ${row.tipo} fora do escopo automatico.` };
    }

    const dados = safeParseDados(row.dados);
    const duplicado = await verificarDuplicado(supabaseAdmin, row.id, {
      tipo: row.tipo,
      prestador_id: row.prestador_id,
      dados,
    });
    if (duplicado) {
      await supabaseAdmin
        .from("formularios")
        .update({ status_analise_ia: "duplicado" })
        .eq("id", row.id);
      return { status: "duplicado" };
    }

    await supabaseAdmin
      .from("formularios")
      .update({ status_analise_ia: "em_analise" })
      .eq("id", row.id);

    const path = row.arquivo_assinado_path ?? row.arquivo_path;
    if (!path) {
      await registrarAnaliseIa(supabaseAdmin, {
        documentoId: row.id,
        provider: "azure-openai",
        model: "n/a",
        erro: "Documento sem arquivo para analise.",
      });
      await supabaseAdmin
        .from("formularios")
        .update({ status_analise_ia: "erro" })
        .eq("id", row.id);
      return { status: "erro", motivo: "Documento sem arquivo." };
    }

    const { provider, model, resultado } = await baixarEAnalisarArquivo(supabaseAdmin, {
      path,
      tipoDocumento: row.tipo,
      dadosAtuais: dados,
    });

    await registrarAnaliseIa(supabaseAdmin, {
      documentoId: row.id,
      provider,
      model,
      resultado,
    });

    const statusFinal = determinarStatusFinal(resultado);
    await supabaseAdmin
      .from("formularios")
      .update({ status_analise_ia: statusFinal })
      .eq("id", row.id);

    return { status: statusFinal };
  } catch (err) {
    const mensagem =
      err instanceof Error ? err.message : "Falha desconhecida na analise.";

    try {
      await registrarAnaliseIa(supabaseAdmin, {
        documentoId,
        provider: "azure-openai",
        model: "n/a",
        erro: mensagem,
      });
    } catch {
      // Best-effort: nao deixar uma falha ao registrar mascarar o erro original.
    }

    try {
      await supabaseAdmin
        .from("formularios")
        .update({ status_analise_ia: "erro" })
        .eq("id", documentoId);
    } catch {
      // Best-effort: nao deixar uma falha ao atualizar mascarar o erro original.
    }

    return { status: "erro", motivo: mensagem };
  }
}
