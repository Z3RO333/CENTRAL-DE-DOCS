import type { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

const STORAGE_BUCKET = "formularios";

export async function limparRascunhosAbandonados(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  input: { horasLimite: number; dryRun?: boolean },
) {
  const limite = new Date(Date.now() - input.horasLimite * 60 * 60 * 1000).toISOString();

  const { data: rascunhos, error: rascunhosError } = await supabaseAdmin
    .from("orcamentos_internos")
    .select("id, arquivo_original_path, numero_orcamento, prestador_nome, updated_at")
    .eq("status", "rascunho")
    .lt("updated_at", limite);
  if (rascunhosError) throw rascunhosError;

  const alvos = rascunhos ?? [];
  if (alvos.length === 0) {
    return { removidos: 0, ids: [] as string[] };
  }

  const ids = alvos.map((item) => item.id as string);

  const { data: versoes, error: versoesError } = await supabaseAdmin
    .from("orcamentos_internos_versoes")
    .select("orcamento_id, arquivo_path")
    .in("orcamento_id", ids);
  if (versoesError) throw versoesError;

  const caminhosStorage = new Set<string>();
  for (const item of alvos) {
    if (item.arquivo_original_path) {
      caminhosStorage.add(item.arquivo_original_path as string);
    }
  }
  for (const versao of versoes ?? []) {
    if (versao.arquivo_path) {
      caminhosStorage.add(versao.arquivo_path as string);
    }
  }

  if (input.dryRun) {
    return { removidos: alvos.length, ids };
  }

  const { error: auditoriaError } = await supabaseAdmin
    .from("documentos_auditoria")
    .delete()
    .in("documento_id", ids);
  if (auditoriaError) throw auditoriaError;

  const { error: versoesDeleteError } = await supabaseAdmin
    .from("orcamentos_internos_versoes")
    .delete()
    .in("orcamento_id", ids);
  if (versoesDeleteError) throw versoesDeleteError;

  const { error: orcamentosDeleteError } = await supabaseAdmin
    .from("orcamentos_internos")
    .delete()
    .in("id", ids);
  if (orcamentosDeleteError) throw orcamentosDeleteError;

  const { error: formulariosDeleteError } = await supabaseAdmin
    .from("formularios")
    .delete()
    .in("id", ids);
  if (formulariosDeleteError) throw formulariosDeleteError;

  if (caminhosStorage.size > 0) {
    const { error: storageError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .remove(Array.from(caminhosStorage));
    if (storageError) {
      console.error("[rascunhosLimpeza] Falha ao remover arquivos do storage:", storageError);
    }
  }

  return { removidos: alvos.length, ids };
}
