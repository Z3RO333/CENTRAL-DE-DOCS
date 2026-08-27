import type { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { fixMojibakeText } from "@/lib/textEncoding";

export type LojaSearchResult = {
  id: string;
  nome: string | null;
  codigo: string | null;
};

export type PrestadorSearchResult = {
  id: string;
  nome: string | null;
};

export const ENTITY_SEARCH_LIMIT = 15;

const sanitizeSearchTerm = (query: string) =>
  query.trim().replace(/[,()%]/g, " ").replace(/  +/g, "  ").trim();

export async function buscarLojasPorNome(
  query: string,
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<LojaSearchResult[]> {
  const termo = sanitizeSearchTerm(query);
  if (!termo) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("lojas")
    .select("id,nome,codigo")
    .or(`nome.ilike.%${termo}%,codigo.ilike.%${termo}%`)
    .limit(ENTITY_SEARCH_LIMIT);

  if (error) {
    throw error;
  }

  return ((data as LojaSearchResult[]) ?? []).map((loja) => ({
    id: loja.id,
    nome: loja.nome ? fixMojibakeText(loja.nome) : null,
    codigo: loja.codigo,
  }));
}

export async function buscarPrestadoresPorNome(
  query: string,
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<PrestadorSearchResult[]> {
  const termo = sanitizeSearchTerm(query);
  if (!termo) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("prestadores")
    .select("id,nome")
    .ilike("nome", `%${termo}%`)
    .limit(ENTITY_SEARCH_LIMIT);

  if (error) {
    throw error;
  }

  return ((data as PrestadorSearchResult[]) ?? []).map((prestador) => ({
    id: prestador.id,
    nome: prestador.nome ? fixMojibakeText(prestador.nome) : null,
  }));
}
