import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  getSessionUserFromRequest,
  hasDocumentosAccess,
  ApiHttpError as HttpError,
} from "@/lib/apiAuth";
import { levantarPendencias } from "@/lib/cobrancasService";

export async function GET(request: Request) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabase = createSupabaseAdminClient();

    const canAccess = await hasDocumentosAccess(user.id, email, supabase);
    if (!canAccess) {
      throw new HttpError(403, "Acesso restrito a administradores.");
    }

    const { searchParams } = new URL(request.url);
    const anoParam = searchParams.get("ano");
    const ano = anoParam ? Number(anoParam) : undefined;

    const pendencias = await levantarPendencias(
      Number.isFinite(ano) ? ano : undefined,
    );

    // Agrupa por prestador para facilitar a exibição no painel
    const porPrestador: Record<
      string,
      {
        prestador_id: string;
        prestador_nome: string;
        ano_referencia: number;
        lojas: {
          loja_id: string;
          loja_nome: string;
          meses_com_documentos: number[];
          meses_pendentes: number[];
          total_esperado: number;
          total_recebido: number;
          total_faltante: number;
        }[];
      }
    > = {};

    for (const p of pendencias) {
      if (!porPrestador[p.prestador_id]) {
        porPrestador[p.prestador_id] = {
          prestador_id: p.prestador_id,
          prestador_nome: p.prestador_nome,
          ano_referencia: p.ano_referencia,
          lojas: [],
        };
      }
      porPrestador[p.prestador_id].lojas.push({
        loja_id: p.loja_id,
        loja_nome: p.loja_nome,
        meses_com_documentos: p.meses_com_documentos,
        meses_pendentes: p.meses_pendentes,
        total_esperado: p.total_esperado,
        total_recebido: p.total_recebido,
        total_faltante: p.total_faltante,
      });
    }

    return NextResponse.json({
      ano: ano ?? new Date().getFullYear(),
      total_pendencias: pendencias.length,
      fornecedores: Object.values(porPrestador),
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
