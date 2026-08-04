import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { anoManaus, calcularMesLimite } from "@/lib/cobrancasService";

export type Frequencia = "mensal" | "semestral" | "anual";

export function calcularMesesDevidos(
  frequencia: Frequencia,
  mesLimite: number,
): number[] {
  const meses: number[] = [];
  for (let mes = 1; mes <= mesLimite; mes++) {
    const devido =
      frequencia === "mensal" ||
      (frequencia === "semestral" && (mes === 6 || mes === 12)) ||
      (frequencia === "anual" && mes === 12);
    if (devido) {
      meses.push(mes);
    }
  }
  return meses;
}

export type PendenciaEquipamento = {
  equipamento_id: string;
  loja_id: string;
  loja_nome: string;
  tipo_equipamento: string;
  identificacao: string | null;
  frequencia: Frequencia;
  meses_com_documentos: number[];
  meses_pendentes: number[];
  total_esperado: number;
  total_recebido: number;
  total_faltante: number;
};

type RpcRow = {
  equipamento_id: string;
  loja_id: string;
  loja_nome: string;
  tipo_equipamento: string;
  identificacao: string | null;
  frequencia: string;
  meses_com_documentos: number[] | null;
  meses_pendentes: number[] | null;
};

export async function levantarPendenciasEquipamentos(
  ano?: number,
  supabase: SupabaseClient = createSupabaseAdminClient(),
): Promise<PendenciaEquipamento[]> {
  const anoRef = ano ?? anoManaus();
  const mesLimite = calcularMesLimite(anoRef);

  const { data, error } = await supabase.rpc("equipamentos_pendencias_ano", {
    p_ano: anoRef,
    p_mes_limite: mesLimite,
  });

  if (error) {
    throw error;
  }

  return ((data ?? []) as RpcRow[]).map((row) => {
    const mesesComDocumentos = row.meses_com_documentos ?? [];
    const mesesPendentes = row.meses_pendentes ?? [];
    return {
      equipamento_id: row.equipamento_id,
      loja_id: row.loja_id,
      loja_nome: row.loja_nome,
      tipo_equipamento: row.tipo_equipamento,
      identificacao: row.identificacao,
      frequencia: row.frequencia as Frequencia,
      meses_com_documentos: mesesComDocumentos,
      meses_pendentes: mesesPendentes,
      total_esperado: mesesComDocumentos.length + mesesPendentes.length,
      total_recebido: mesesComDocumentos.length,
      total_faltante: mesesPendentes.length,
    };
  });
}
