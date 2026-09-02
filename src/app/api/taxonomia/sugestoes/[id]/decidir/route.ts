import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

type DecidirBody = {
  decisao?: string;
  termoId?: string;
  termo?: string;
  categoria?: string;
  tipo?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    if (!actor.isAdmin) {
      throw new HttpError(403, "Revisao de taxonomia e restrita a administradores.");
    }

    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as DecidirBody;

    const { data: sugestao, error: erroSugestao } = await supabaseAdmin
      .from("taxonomia_sugestoes")
      .select("id,variacao,status")
      .eq("id", id)
      .maybeSingle();
    if (erroSugestao) {
      throw erroSugestao;
    }
    if (!sugestao) {
      throw new HttpError(404, "Sugestao nao encontrada.");
    }
    if (sugestao.status !== "pendente") {
      throw new HttpError(400, "Essa sugestao ja foi revisada.");
    }

    if (body.decisao === "rejeitar") {
      const { error } = await supabaseAdmin
        .from("taxonomia_sugestoes")
        .update({
          status: "rejeitada",
          revisado_por: actor.realUserId,
          revisado_em: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) {
        throw error;
      }
      return NextResponse.json({ ok: true });
    }

    if (body.decisao === "aprovar_existente") {
      const termoId = typeof body.termoId === "string" ? body.termoId.trim() : "";
      if (!termoId) {
        throw new HttpError(400, "Informe o termo existente para vincular.");
      }

      const { error: erroSinonimo } = await supabaseAdmin.from("taxonomia_sinonimos").insert({
        termo_id: termoId,
        variacao: sugestao.variacao,
        origem: "aprovado",
      });
      if (erroSinonimo) {
        throw erroSinonimo;
      }

      const { error: erroUpdate } = await supabaseAdmin
        .from("taxonomia_sugestoes")
        .update({
          status: "aprovada",
          revisado_por: actor.realUserId,
          revisado_em: new Date().toISOString(),
        })
        .eq("id", id);
      if (erroUpdate) {
        throw erroUpdate;
      }

      return NextResponse.json({ ok: true });
    }

    if (body.decisao === "aprovar_novo") {
      const termo = typeof body.termo === "string" ? body.termo.trim().toLowerCase() : "";
      const categoria = typeof body.categoria === "string" ? body.categoria.trim() : "";
      const tipo =
        body.tipo === "equipamento" ? "equipamento" : body.tipo === "assunto" ? "assunto" : "";
      if (!termo || !categoria || !tipo) {
        throw new HttpError(400, "Informe termo, categoria e tipo para criar um novo termo.");
      }

      const { data: novoTermo, error: erroTermo } = await supabaseAdmin
        .from("taxonomia_termos")
        .insert({ termo, categoria, tipo })
        .select("id")
        .single();
      if (erroTermo) {
        throw erroTermo;
      }

      const { error: erroSinonimo } = await supabaseAdmin.from("taxonomia_sinonimos").insert({
        termo_id: novoTermo.id,
        variacao: sugestao.variacao,
        origem: "aprovado",
      });
      if (erroSinonimo) {
        throw erroSinonimo;
      }

      const { error: erroUpdate } = await supabaseAdmin
        .from("taxonomia_sugestoes")
        .update({
          status: "aprovada",
          revisado_por: actor.realUserId,
          revisado_em: new Date().toISOString(),
        })
        .eq("id", id);
      if (erroUpdate) {
        throw erroUpdate;
      }

      return NextResponse.json({ ok: true, termoId: novoTermo.id as string });
    }

    throw new HttpError(400, "Decisao invalida.");
  } catch (err) {
    console.error("Erro ao decidir sugestao de taxonomia:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Nao foi possivel processar a decisao.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
