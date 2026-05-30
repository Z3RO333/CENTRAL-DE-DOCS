import { type GerenteAccessRow } from "@/lib/apiAuth";
import { sanitizeId } from "@/lib/documentosApiUtils";
import type { PendenciaCobranca } from "@/lib/cobrancasService";

type FiltroAcessoInput = {
  allowedPrestadores: string[];
  gerenteEntries: GerenteAccessRow[];
};

/**
 * Filtra as pendências para o escopo de um usuário não-admin (gerente/fornecedor).
 * Regras (espelham buildDocumentosAccessOr):
 *  - fornecedor: vê todas as lojas dos prestadores onde seu e-mail está em `usuarios`;
 *  - gerente com can_view_all numa loja: vê todos os prestadores daquela loja;
 *  - gerente sem can_view_all: vê apenas os pares (loja, prestador) concedidos.
 */
export function filtrarPendenciasPorAcesso(
  pendencias: PendenciaCobranca[],
  { allowedPrestadores, gerenteEntries }: FiltroAcessoInput,
): PendenciaCobranca[] {
  const prestadoresPermitidos = new Set(allowedPrestadores);
  const lojasVerTudo = new Set<string>();
  const lojasLimitadas = new Map<string, Set<string>>();

  for (const entry of gerenteEntries) {
    const lojaId = entry.loja_id ? sanitizeId(entry.loja_id) : "";
    if (!lojaId) continue;

    if (entry.can_view_all) {
      lojasVerTudo.add(lojaId);
      lojasLimitadas.delete(lojaId);
      continue;
    }
    if (!entry.prestador_id || lojasVerTudo.has(lojaId)) continue;

    const set = lojasLimitadas.get(lojaId) ?? new Set<string>();
    set.add(sanitizeId(entry.prestador_id));
    lojasLimitadas.set(lojaId, set);
  }

  return pendencias.filter((p) => {
    if (prestadoresPermitidos.has(p.prestador_id)) return true;
    if (lojasVerTudo.has(p.loja_id)) return true;
    return lojasLimitadas.get(p.loja_id)?.has(p.prestador_id) ?? false;
  });
}
