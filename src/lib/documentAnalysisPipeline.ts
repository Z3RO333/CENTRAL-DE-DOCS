import {
  analisarDocumentoComOpenAi,
  type DocumentoAnaliseIa,
} from "@/lib/openAiDocumentAnalysis";
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
