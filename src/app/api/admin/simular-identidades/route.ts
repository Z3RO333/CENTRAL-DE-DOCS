import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import {
  ApiHttpError as HttpError,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Identidade = {
  email: string;
  label: string;
  role: "gerente_loja" | "prestador" | "colaborador";
  detalhe?: string;
};

export async function GET(request: Request) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();

    // Só admin pode listar identidades para simular
    const isAdmin = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!isAdmin) {
      throw new HttpError(403, "Apenas administradores podem simular visões.");
    }

    const identidades: Identidade[] = [];

    // ── Gerentes (scope=gerente em documentos_acesso) ─────────────────────────
    const { data: gerentes } = await supabaseAdmin
      .from("documentos_acesso")
      .select("email, loja_id, can_view_all")
      .eq("scope", "gerente");

    if (gerentes) {
      // nomes das lojas para rótulo
      const lojaIds = Array.from(
        new Set(gerentes.map((g) => g.loja_id).filter(Boolean) as string[]),
      );
      const lojaNome = new Map<string, string>();
      if (lojaIds.length) {
        const { data: lojas } = await supabaseAdmin
          .from("lojas")
          .select("id, nome")
          .in("id", lojaIds);
        lojas?.forEach((l) => lojaNome.set(l.id as string, (l.nome as string) ?? ""));
      }
      const porEmail = new Map<string, string[]>();
      gerentes.forEach((g) => {
        const e = (g.email as string | null)?.toLowerCase().trim();
        if (!e) return;
        const nome = g.loja_id ? lojaNome.get(g.loja_id as string) : null;
        const arr = porEmail.get(e) ?? [];
        if (nome) arr.push(nome);
        porEmail.set(e, arr);
      });
      porEmail.forEach((lojas, e) => {
        identidades.push({
          email: e,
          label: e,
          role: "gerente_loja",
          detalhe: lojas.length ? `Gerente · ${lojas.join(", ")}` : "Gerente",
        });
      });
    }

    // ── Prestadores (usuários vinculados) ─────────────────────────────────────
    const { data: prestadores } = await supabaseAdmin
      .from("prestadores")
      .select("nome, usuarios")
      .not("usuarios", "is", null);

    prestadores?.forEach((p) => {
      const usuarios = (p.usuarios as string[] | null) ?? [];
      const primeiro = usuarios.find((u) => u && u.includes("@"));
      if (primeiro) {
        identidades.push({
          email: primeiro.toLowerCase().trim(),
          label: (p.nome as string) ?? primeiro,
          role: "prestador",
          detalhe: "Prestador",
        });
      }
    });

    // remove duplicados por email
    const unico = new Map<string, Identidade>();
    identidades.forEach((i) => {
      if (i.email !== email && !unico.has(i.email)) unico.set(i.email, i);
    });

    return NextResponse.json({ identidades: Array.from(unico.values()) });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : "Erro ao listar identidades";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
