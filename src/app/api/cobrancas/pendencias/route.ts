import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  getSessionUserFromRequest,
  getAuthorizedPrestadorIds,
  getGerenteAccessEntries,
  hasDocumentosAccess,
  ApiHttpError as HttpError,
} from "@/lib/apiAuth";
import { anoManaus, levantarPendencias } from "@/lib/cobrancasService";
import { filtrarPendenciasPorAcesso } from "@/lib/cobrancasAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mascararEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local) return email;
  if (!domain || local.length <= 2) return `${local[0] ?? "*"}***@${domain ?? ""}`;
  const visivel = local.slice(0, 2);
  const fim = local.slice(-1);
  const asteriscos = "*".repeat(Math.max(local.length - 3, 3));
  return `${visivel}${asteriscos}${fim}@${domain}`;
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabase = createSupabaseAdminClient();

    const isAdmin = await hasDocumentosAccess(user.id, email, supabase);

    // Gerente/fornecedor: precisa ter algum escopo concedido
    const allowedPrestadores = isAdmin
      ? []
      : await getAuthorizedPrestadorIds(email, supabase);
    const gerenteEntries = isAdmin
      ? []
      : await getGerenteAccessEntries(user.id, email, supabase);

    if (
      !isAdmin &&
      allowedPrestadores.length === 0 &&
      gerenteEntries.length === 0
    ) {
      throw new HttpError(
        403,
        "Você não possui permissão para consultar pendências.",
      );
    }

    const { searchParams } = new URL(request.url);
    const anoParam = searchParams.get("ano");
    const anoNum = anoParam ? Number(anoParam) : NaN;
    const ano = Number.isFinite(anoNum) ? anoNum : undefined;

    let pendencias = await levantarPendencias(ano, supabase);

    // Restringe ao escopo de gerente/fornecedor (admin vê tudo)
    if (!isAdmin) {
      pendencias = filtrarPendenciasPorAcesso(pendencias, {
        allowedPrestadores,
        gerenteEntries,
      });
    }

    // Agrupa por prestador para facilitar a exibição no painel
    type LojaResumo = {
      loja_id: string;
      loja_nome: string;
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
    type FornecedorResumo = {
      prestador_id: string;
      prestador_nome: string;
      emails_contato: string[];
      ano_referencia: number;
      total_lojas: number;
      total_documentos_faltantes: number;
      lojas: LojaResumo[];
    };

    const porPrestador: Record<string, FornecedorResumo> = {};

    for (const p of pendencias) {
      if (!porPrestador[p.prestador_id]) {
        porPrestador[p.prestador_id] = {
          prestador_id: p.prestador_id,
          prestador_nome: p.prestador_nome,
          emails_contato: p.prestador_emails.map(mascararEmail),
          ano_referencia: p.ano_referencia,
          total_lojas: 0,
          total_documentos_faltantes: 0,
          lojas: [],
        };
      }
      const fornecedor = porPrestador[p.prestador_id];
      fornecedor.lojas.push({
        loja_id: p.loja_id,
        loja_nome: p.loja_nome,
        meses_com_documentos: p.meses_com_documentos,
        meses_com_documentos_laudos: p.meses_com_documentos_laudos,
        meses_com_documentos_retencao: p.meses_com_documentos_retencao,
        meses_pendentes: p.meses_pendentes,
        meses_pendentes_laudos: p.meses_pendentes_laudos,
        meses_pendentes_retencao: p.meses_pendentes_retencao,
        total_esperado: p.total_esperado,
        total_recebido: p.total_recebido,
        total_faltante: p.total_faltante,
      });
      fornecedor.total_lojas += 1;
      fornecedor.total_documentos_faltantes += p.total_faltante;
    }

    const fornecedores = Object.values(porPrestador).sort(
      (a, b) => b.total_documentos_faltantes - a.total_documentos_faltantes,
    );

    return NextResponse.json({
      ano: ano ?? anoManaus(),
      perfil: isAdmin ? "admin" : "gerente",
      total_fornecedores: fornecedores.length,
      total_pendencias: pendencias.length,
      fornecedores,
    });
  } catch (err) {
    console.error("[cobrancas/pendencias] Erro:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Erro ao consultar pendências.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
