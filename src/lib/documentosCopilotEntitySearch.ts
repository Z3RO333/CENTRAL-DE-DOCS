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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O modelo às vezes recebe o código da loja (ex.: "101") em vez do UUID ao
 * disambiguar entre lojas homônimas e o repassa como lojaId. Aceita ambos.
 */
export async function resolverLojaId(
  lojaIdOuCodigo: string,
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<string | null> {
  const valor = lojaIdOuCodigo.trim();
  if (!valor) return null;
  if (UUID_RE.test(valor)) {
    return valor;
  }

  const { data, error } = await supabaseAdmin
    .from("lojas")
    .select("id")
    .eq("codigo", valor)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

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
