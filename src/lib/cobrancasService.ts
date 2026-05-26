import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { enviarEmailCobranca, type PendenciaLoja } from "@/lib/emailService";

export type PendenciaCobranca = {
  prestador_id: string;
  prestador_nome: string;
  prestador_emails: string[];
  loja_id: string;
  loja_nome: string;
  ano_referencia: number;
  meses_com_documentos: number[];
  meses_pendentes: number[];
  total_esperado: number;
  total_recebido: number;
  total_faltante: number;
};

export type ResultadoDisparo = {
  ano: number;
  total_pendencias: number;
  emails_enviados: number;
  emails_ignorados_duplicata: number;
  erros: { prestador: string; loja: string; erro: string }[];
};

type RpcRow = {
  prestador_id: string;
  loja_id: string;
  loja_nome: string | null;
  meses_com_documentos: number[] | null;
  meses_pendentes: number[] | null;
};

type PrestadorRow = {
  id: string;
  nome: string;
  usuarios: string[] | null;
};

// Retorna as pendências sem enviar e-mails – usado no relatório admin
export async function levantarPendencias(
  ano?: number,
): Promise<PendenciaCobranca[]> {
  const supabase = createSupabaseAdminClient();
  const anoRef = ano ?? new Date().getFullYear();
  const mesAtual = new Date().getMonth() + 1;
  const mesLimite = mesAtual - 1;

  if (mesLimite < 1) return [];

  const { data: rows, error } = await supabase.rpc(
    "cobrancas_pendencias_ano",
    { p_ano: anoRef, p_mes_limite: mesLimite },
  );

  if (error) throw error;
  if (!rows || rows.length === 0) return [];

  const prestadorIds = [...new Set((rows as RpcRow[]).map((r) => r.prestador_id))];
  const { data: prestadores, error: prestadoresError } = await supabase
    .from("prestadores")
    .select("id, nome, usuarios")
    .in("id", prestadorIds);

  if (prestadoresError) throw prestadoresError;

  const prestMap = new Map<string, PrestadorRow>(
    (prestadores ?? []).map((p) => [p.id, p]),
  );

  return (rows as RpcRow[])
    .map((row) => {
      const prest = prestMap.get(row.prestador_id);
      if (!prest) return null;

      const mesesCom = row.meses_com_documentos ?? [];
      const mesesPend = row.meses_pendentes ?? [];

      return {
        prestador_id: row.prestador_id,
        prestador_nome: prest.nome,
        prestador_emails: (prest.usuarios ?? []).filter(Boolean),
        loja_id: row.loja_id,
        loja_nome: row.loja_nome ?? row.loja_id,
        ano_referencia: anoRef,
        meses_com_documentos: mesesCom,
        meses_pendentes: mesesPend,
        total_esperado: 12,
        total_recebido: mesesCom.length,
        total_faltante: mesesPend.length,
      } satisfies PendenciaCobranca;
    })
    .filter((p): p is PendenciaCobranca => p !== null);
}

// Verifica se já houve cobrança hoje para um par prestador+loja+ano
async function jaCobradoHoje(
  prestadorId: string,
  lojaId: string,
  ano: number,
): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  const hoje = new Date();
  const inicioDia = new Date(
    hoje.getFullYear(),
    hoje.getMonth(),
    hoje.getDate(),
  ).toISOString();

  const { count } = await supabase
    .from("cobrancas_documentacao_historico")
    .select("id", { count: "exact", head: true })
    .eq("prestador_id", prestadorId)
    .eq("loja_id", lojaId)
    .eq("ano_referencia", ano)
    .gte("enviado_em", inicioDia);

  return (count ?? 0) > 0;
}

async function registrarCobranca(
  pendencia: PendenciaCobranca,
  emails: string[],
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  await supabase.from("cobrancas_documentacao_historico").insert({
    prestador_id: pendencia.prestador_id,
    loja_id: pendencia.loja_id,
    ano_referencia: pendencia.ano_referencia,
    meses_pendentes: pendencia.meses_pendentes,
    emails_destinatarios: emails,
  });
}

// Orquestrador principal: levanta pendências, agrupa por fornecedor e envia e-mails
export async function processarCobrancas(
  ano?: number,
): Promise<ResultadoDisparo> {
  const pendencias = await levantarPendencias(ano);
  const anoRef = ano ?? new Date().getFullYear();

  const resultado: ResultadoDisparo = {
    ano: anoRef,
    total_pendencias: pendencias.length,
    emails_enviados: 0,
    emails_ignorados_duplicata: 0,
    erros: [],
  };

  if (pendencias.length === 0) return resultado;

  // Agrupa por prestador para enviar um único e-mail por fornecedor
  const porPrestador = new Map<string, PendenciaCobranca[]>();
  for (const p of pendencias) {
    if (!porPrestador.has(p.prestador_id)) porPrestador.set(p.prestador_id, []);
    porPrestador.get(p.prestador_id)!.push(p);
  }

  for (const [, lojasPendentes] of porPrestador) {
    const first = lojasPendentes[0];
    const emails = first.prestador_emails;

    if (emails.length === 0) continue;

    // Filtra lojas que ainda não foram cobradas hoje
    const novas: PendenciaCobranca[] = [];
    for (const pend of lojasPendentes) {
      const duplicata = await jaCobradoHoje(
        pend.prestador_id,
        pend.loja_id,
        anoRef,
      );
      if (duplicata) {
        resultado.emails_ignorados_duplicata++;
      } else {
        novas.push(pend);
      }
    }

    if (novas.length === 0) continue;

    const pendenciasLoja: PendenciaLoja[] = novas.map((p) => ({
      loja_nome: p.loja_nome,
      meses_pendentes: p.meses_pendentes,
      total_recebido: p.total_recebido,
      total_faltante: p.total_faltante,
    }));

    try {
      await enviarEmailCobranca({
        prestador_nome: first.prestador_nome,
        destinatarios: emails,
        ano_referencia: anoRef,
        pendencias_por_loja: pendenciasLoja,
      });

      for (const pend of novas) {
        await registrarCobranca(pend, emails);
      }

      resultado.emails_enviados++;
    } catch (err) {
      const mensagem =
        err instanceof Error ? err.message : "Erro desconhecido";
      for (const pend of novas) {
        resultado.erros.push({
          prestador: pend.prestador_nome,
          loja: pend.loja_nome,
          erro: mensagem,
        });
      }
    }
  }

  return resultado;
}
