import type { DocumentoAnaliseIa } from "@/lib/openAiDocumentAnalysis";

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
