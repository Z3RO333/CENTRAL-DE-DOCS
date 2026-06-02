import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { enviarEmailCobranca, type PendenciaLoja } from "@/lib/emailService";
import { fixMojibakeText } from "@/lib/textEncoding";

// Fornecedores que nunca devem ser cobrados (comparação por nome normalizado, maiúsculo)
const PRESTADORES_EXCLUIDOS = new Set(["TESTE"]);

function nomeExcluido(nome: string): boolean {
  return PRESTADORES_EXCLUIDOS.has(fixMojibakeText(nome).trim().toUpperCase());
}

// Domínio interno: e-mails @bemol.com.br não são cobrados como fornecedor
// (a manutenção ainda recebe cópia via CC do próprio remetente).
const DOMINIO_INTERNO = "@bemol.com.br";

function emailsExternos(usuarios: string[] | null): string[] {
  return (usuarios ?? [])
    .map((e) => e.trim())
    .filter(Boolean)
    .filter((e) => !e.toLowerCase().endsWith(DOMINIO_INTERNO));
}

export type PendenciaCobranca = {
  prestador_id: string;
  prestador_nome: string;
  prestador_emails: string[];
  loja_id: string;
  loja_nome: string;
  ano_referencia: number;
  meses_com_documentos: number[];
  meses_com_documentos_laudos: number[];
  meses_com_documentos_retencao: number[];
  meses_pendentes: number[];
  meses_pendentes_laudos: number[];
  meses_pendentes_retencao: number[];
  total_esperado: number;
  total_recebido: number;
  total_faltante: number;
};

export type ResultadoDisparo = {
  ano: number;
  dry_run: boolean;
  total_pendencias: number;
  emails_enviados: number;
  emails_ignorados_duplicata: number;
  fornecedores_sem_email: number;
  erros: { prestador: string; loja: string; erro: string }[];
  // No dry-run, lista quem SERIA cobrado (sem enviar nada)
  previa: {
    prestador: string;
    emails: string[];
    lojas: number;
    documentos_faltantes: number;
  }[];
};

type RpcRow = {
  prestador_id: string;
  loja_id: string;
  loja_nome: string | null;
  meses_com_documentos: number[] | null;
  meses_com_documentos_laudos?: number[] | null;
  meses_com_documentos_retencao?: number[] | null;
  meses_pendentes: number[] | null;
  // colunas adicionadas pela migração 202606011700 (podem ser null em ambientes antigos)
  meses_pendentes_laudos: number[] | null;
  meses_pendentes_retencao: number[] | null;
};

type PrestadorRow = {
  id: string;
  nome: string;
  usuarios: string[] | null;
};

// Retorna a data "hoje" no fuso de Manaus (UTC-4) no formato YYYY-MM-DD
export function diaManaus(date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Manaus" });
}

// Quantos meses do ano já devem ter documentação:
//  - ano corrente: até o mês anterior ao atual (mês ainda em curso não é cobrado)
//  - anos fechados: os 12 meses
//  - anos futuros: nenhum
export function calcularMesLimite(anoRef: number, hoje = new Date()): number {
  const anoAtual = hoje.getFullYear();
  if (anoRef > anoAtual) return 0;
  if (anoRef < anoAtual) return 12;
  return hoje.getMonth(); // mês atual (1-12) menos 1 == getMonth() (0-11)
}

// Retorna as pendências sem enviar e-mails – usado no relatório (admin/gerente)
export async function levantarPendencias(
  ano?: number,
  supabase: SupabaseClient = createSupabaseAdminClient(),
): Promise<PendenciaCobranca[]> {
  const anoRef = ano ?? new Date().getFullYear();
  const mesLimite = calcularMesLimite(anoRef);

  if (mesLimite < 1) return [];

  const { data: rows, error } = await supabase.rpc("cobrancas_pendencias_ano", {
    p_ano: anoRef,
    p_mes_limite: mesLimite,
  });

  if (error) throw error;
  if (!rows || rows.length === 0) return [];

  const prestadorIds = [
    ...new Set((rows as RpcRow[]).map((r) => r.prestador_id)),
  ];
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
      // Pula fornecedores na lista de exclusão (ex.: cadastros de teste)
      if (nomeExcluido(prest.nome)) return null;

      const mesesCom = row.meses_com_documentos ?? [];
      const laudosCom = row.meses_com_documentos_laudos ?? [];
      const retencaoCom = row.meses_com_documentos_retencao ?? [];
      const mesesPend = row.meses_pendentes ?? [];
      const laudosPend = row.meses_pendentes_laudos ?? [];
      const retencaoPend = row.meses_pendentes_retencao ?? [];
      const totalRecebido =
        laudosCom.length + retencaoCom.length || mesesCom.length;
      // total_faltante = soma dos dois tipos (laudos + retenção), pode ser > meses únicos
      const totalFaltante =
        laudosPend.length + retencaoPend.length || mesesPend.length;
      const totalEsperado = totalRecebido + totalFaltante;

      return {
        prestador_id: row.prestador_id,
        prestador_nome: fixMojibakeText(prest.nome),
        prestador_emails: emailsExternos(prest.usuarios),
        loja_id: row.loja_id,
        loja_nome: fixMojibakeText(row.loja_nome ?? row.loja_id),
        ano_referencia: anoRef,
        meses_com_documentos: mesesCom,
        meses_com_documentos_laudos: laudosCom,
        meses_com_documentos_retencao: retencaoCom,
        meses_pendentes: mesesPend,
        meses_pendentes_laudos: laudosPend,
        meses_pendentes_retencao: retencaoPend,
        total_esperado: totalEsperado,
        total_recebido: totalRecebido,
        total_faltante: totalFaltante,
      } satisfies PendenciaCobranca;
    })
    .filter((p): p is PendenciaCobranca => p !== null);
}

// Busca, em UMA query, todos os pares prestador+loja já cobrados hoje (evita N+1)
async function carregarCobrancasDeHoje(
  supabase: SupabaseClient,
  anoRef: number,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("cobrancas_documentacao_historico")
    .select("prestador_id, loja_id")
    .eq("ano_referencia", anoRef)
    .eq("dia_cobranca", diaManaus());

  if (error) throw error;

  return new Set(
    (data ?? []).map((r) => `${r.prestador_id}:${r.loja_id}`),
  );
}

// Orquestrador principal: levanta pendências, agrupa por fornecedor e envia e-mails.
// dryRun = true apenas simula (não envia e-mail nem grava histórico).
export async function processarCobrancas(
  ano?: number,
  opts: { dryRun?: boolean } = {},
): Promise<ResultadoDisparo> {
  const dryRun = opts.dryRun ?? false;
  const supabase = createSupabaseAdminClient();
  const anoRef = ano ?? new Date().getFullYear();
  const pendencias = await levantarPendencias(anoRef, supabase);

  const resultado: ResultadoDisparo = {
    ano: anoRef,
    dry_run: dryRun,
    total_pendencias: pendencias.length,
    emails_enviados: 0,
    emails_ignorados_duplicata: 0,
    fornecedores_sem_email: 0,
    erros: [],
    previa: [],
  };

  if (pendencias.length === 0) return resultado;

  const jaCobradas = await carregarCobrancasDeHoje(supabase, anoRef);

  // Agrupa por prestador para enviar um único e-mail por fornecedor
  const porPrestador = new Map<string, PendenciaCobranca[]>();
  for (const p of pendencias) {
    if (!porPrestador.has(p.prestador_id)) porPrestador.set(p.prestador_id, []);
    porPrestador.get(p.prestador_id)!.push(p);
  }

  for (const [, lojasPendentes] of porPrestador) {
    const first = lojasPendentes[0];
    const emails = first.prestador_emails;

    if (emails.length === 0) {
      resultado.fornecedores_sem_email++;
      continue;
    }

    // Filtra lojas que ainda não foram cobradas hoje (checagem em memória)
    const novas = lojasPendentes.filter((p) => {
      const chave = `${p.prestador_id}:${p.loja_id}`;
      if (jaCobradas.has(chave)) {
        resultado.emails_ignorados_duplicata++;
        return false;
      }
      return true;
    });

    if (novas.length === 0) continue;

    // Dry-run: apenas registra a prévia, sem enviar nem gravar
    if (dryRun) {
      resultado.previa.push({
        prestador: first.prestador_nome,
        emails,
        lojas: novas.length,
        documentos_faltantes: novas.reduce((a, p) => a + p.total_faltante, 0),
      });
      continue;
    }

    const pendenciasLoja: PendenciaLoja[] = novas.map((p) => ({
      loja_nome: p.loja_nome,
      meses_pendentes: p.meses_pendentes,
      meses_pendentes_laudos: p.meses_pendentes_laudos,
      meses_pendentes_retencao: p.meses_pendentes_retencao,
      total_esperado: p.total_esperado,
      total_recebido: p.total_recebido,
      total_faltante: p.total_faltante,
    }));

    try {
      await enviarEmailCobranca({
        prestador_nome: first.prestador_nome,
        destinatarios: emails,
        ano_referencia: anoRef,
        mes_limite: calcularMesLimite(anoRef),
        pendencias_por_loja: pendenciasLoja,
      });

      // Bulk insert do histórico; índice único protege contra corrida
      const { error: insertError } = await supabase
        .from("cobrancas_documentacao_historico")
        .upsert(
          novas.map((p) => ({
            prestador_id: p.prestador_id,
            loja_id: p.loja_id,
            ano_referencia: p.ano_referencia,
            meses_pendentes: p.meses_pendentes,
            emails_destinatarios: emails,
            dia_cobranca: diaManaus(),
          })),
          {
            onConflict: "prestador_id,loja_id,ano_referencia,dia_cobranca",
            ignoreDuplicates: true,
          },
        );

      if (insertError) {
        // Histórico falhou: registra como erro para reprocessar, mas e-mail já saiu
        console.error("[cobrancas] Falha ao gravar histórico:", insertError);
        resultado.erros.push({
          prestador: first.prestador_nome,
          loja: "(histórico)",
          erro: insertError.message,
        });
      }

      resultado.emails_enviados++;
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : "Erro desconhecido";
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
