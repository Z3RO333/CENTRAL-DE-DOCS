import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { getActorFromRequest, ApiHttpError as HttpError } from "@/lib/apiAuth";
import { anoManaus } from "@/lib/cobrancasService";
import { levantarPendenciasEquipamentos } from "@/lib/controleEquipamentosService";
import { isAprovadorInterno } from "@/lib/orcamentosInternos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EquipamentoResumo = {
  equipamento_id: string;
  identificacao: string | null;
  frequencia: string;
  meses_com_documentos: number[];
  meses_pendentes: number[];
  total_esperado: number;
  total_recebido: number;
  total_faltante: number;
};

type TipoResumo = {
  tipo_equipamento: string;
  equipamentos: EquipamentoResumo[];
};

type LojaResumo = {
  loja_id: string;
  loja_nome: string;
  tipos: TipoResumo[];
};

export async function GET(request: Request) {
  try {
    const supabase = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabase);
    const email = actor.email;

    const isAdmin = actor.isAdmin;
    const isGestor = isAdmin || (await isAprovadorInterno(email, supabase));

    if (!isGestor) {
      throw new HttpError(
        403,
        "Controle de equipamentos é restrito a administradores e gestores.",
      );
    }

    const { searchParams } = new URL(request.url);
    const anoParam = searchParams.get("ano");
    const anoNum = anoParam ? Number(anoParam) : NaN;
    const ano = Number.isFinite(anoNum) ? anoNum : undefined;

    const pendencias = await levantarPendenciasEquipamentos(ano, supabase);

    const porLoja: Record<string, LojaResumo> = {};

    for (const p of pendencias) {
      if (!porLoja[p.loja_id]) {
        porLoja[p.loja_id] = {
          loja_id: p.loja_id,
          loja_nome: p.loja_nome,
          tipos: [],
        };
      }
      const loja = porLoja[p.loja_id];

      let tipo = loja.tipos.find((t) => t.tipo_equipamento === p.tipo_equipamento);
      if (!tipo) {
        tipo = { tipo_equipamento: p.tipo_equipamento, equipamentos: [] };
        loja.tipos.push(tipo);
      }

      tipo.equipamentos.push({
        equipamento_id: p.equipamento_id,
        identificacao: p.identificacao,
        frequencia: p.frequencia,
        meses_com_documentos: p.meses_com_documentos,
        meses_pendentes: p.meses_pendentes,
        total_esperado: p.total_esperado,
        total_recebido: p.total_recebido,
        total_faltante: p.total_faltante,
      });
    }

    const lojas = Object.values(porLoja).sort((a, b) =>
      a.loja_nome.localeCompare(b.loja_nome),
    );

    return NextResponse.json({
      ano: ano ?? anoManaus(),
      perfil: isAdmin ? "admin" : "gestor",
      total_equipamentos_pendentes: pendencias.length,
      total_pendencias: pendencias.reduce((soma, p) => soma + p.total_faltante, 0),
      lojas,
    });
  } catch (err) {
    console.error("[controle-equipamentos/pendencias] Erro:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Erro ao consultar pendências de equipamentos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
