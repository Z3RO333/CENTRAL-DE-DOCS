import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { safeParseDados } from "@/lib/documentosApiUtils";
import { parseValorTotal } from "@/lib/orcamentosInternos";
import { parseCompetencia } from "@/lib/competencia";

type FormularioGenericoRow = {
  id: string;
  user_id: string;
  prestador_id: string;
  dados: Record<string, unknown> | string | null;
  created_at: string;
};

export async function syncNotasFiscaisConservacaoFromGenericos(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
) {
  const { data: prestadoresConservacao, error: prestadoresError } = await supabaseAdmin
    .from("prestadores")
    .select("id")
    .eq("categoria", "conservacao");
  if (prestadoresError) {
    throw prestadoresError;
  }
  const prestadorIds = ((prestadoresConservacao ?? []) as { id: string }[]).map(
    (item) => item.id,
  );
  if (prestadorIds.length === 0) {
    return;
  }

  const { data: formulariosGenericos, error: formulariosError } = await supabaseAdmin
    .from("formularios")
    .select("id,user_id,prestador_id,dados,created_at")
    .eq("tipo", "notas_fiscais")
    .in("prestador_id", prestadorIds);
  if (formulariosError) {
    throw formulariosError;
  }
  const pendentesCandidatos = (formulariosGenericos ?? []) as FormularioGenericoRow[];
  if (pendentesCandidatos.length === 0) {
    return;
  }

  const formularioIds = pendentesCandidatos.map((item) => item.id);
  const { data: jaImportadas, error: importadasError } = await supabaseAdmin
    .from("notas_fiscais_conservacao")
    .select("id")
    .in("id", formularioIds);
  if (importadasError) {
    throw importadasError;
  }
  const importadasSet = new Set(((jaImportadas ?? []) as { id: string }[]).map((n) => n.id));

  const pendentes = pendentesCandidatos.filter((item) => !importadasSet.has(item.id));
  if (pendentes.length === 0) {
    return;
  }

  for (const formulario of pendentes) {
    const dados = safeParseDados(formulario.dados) ?? {};
    const lojaId = typeof dados.loja_id === "string" ? dados.loja_id : null;
    if (!lojaId) {
      console.error(
        `Não foi possível importar a nota fiscal ${formulario.id}: sem loja associada.`,
      );
      continue;
    }

    const numeroNf =
      (typeof dados.numero_nf === "string" && dados.numero_nf.trim()) ||
      (typeof dados.numero_pedido === "string" && dados.numero_pedido.trim()) ||
      `IMPORT-${formulario.id.slice(0, 8)}`;
    const competenciaRaw = typeof dados.competencia === "string" ? dados.competencia : null;
    const competencia = competenciaRaw ? parseCompetencia(competenciaRaw)?.label ?? null : null;
    const valor = parseValorTotal(dados.valor);
    const observacoes =
      (typeof dados.observacoes === "string" && dados.observacoes.trim()) ||
      (typeof dados.descricao === "string" && dados.descricao.trim()) ||
      null;
    const responsavel = typeof dados.responsavel === "string" ? dados.responsavel.trim() || null : null;
    const dataRecebimento = formulario.created_at.slice(0, 10);

    const { error: insertError } = await supabaseAdmin
      .from("notas_fiscais_conservacao")
      .insert({
        id: formulario.id,
        prestador_id: formulario.prestador_id,
        loja_id: lojaId,
        numero_nf: numeroNf,
        valor,
        competencia,
        data_recebimento: dataRecebimento,
        observacoes,
        responsavel,
        created_by: formulario.user_id,
      });
    if (insertError) {
      if (insertError.code === "23505") {
        continue;
      }
      console.error(`Erro ao importar a nota fiscal ${formulario.id}:`, insertError);
      continue;
    }

    const { error: updateError } = await supabaseAdmin
      .from("formularios")
      .update({ tipo: "notas_fiscais_conservacao" })
      .eq("id", formulario.id);
    if (updateError) {
      console.error(
        `Nota fiscal ${formulario.id} importada, mas falhou ao atualizar o tipo do documento original:`,
        updateError,
      );
    }
  }
}
