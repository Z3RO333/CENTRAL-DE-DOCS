export type TaxonomiaIndiceEntry = { termoId: string; termo: string };
export type TaxonomiaIndice = Map<string, TaxonomiaIndiceEntry>;

export function normalizarTermo(valor: string): string {
  return valor
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRegExp = (valor: string) => valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function construirIndiceTaxonomia(
  termos: { id: string; termo: string }[],
  sinonimos: { termo_id: string; variacao: string }[],
): TaxonomiaIndice {
  const termoPorId = new Map(termos.map((item) => [item.id, item.termo]));
  const indice: TaxonomiaIndice = new Map();

  for (const item of termos) {
    indice.set(normalizarTermo(item.termo), { termoId: item.id, termo: item.termo });
  }

  for (const sinonimo of sinonimos) {
    const termo = termoPorId.get(sinonimo.termo_id);
    if (!termo) {
      continue;
    }
    indice.set(normalizarTermo(sinonimo.variacao), { termoId: sinonimo.termo_id, termo });
  }

  return indice;
}

export function classificarTexto(texto: string, indice: TaxonomiaIndice): string[] {
  const textoNormalizado = normalizarTermo(texto);
  if (!textoNormalizado) {
    return [];
  }

  const encontrados = new Set<string>();
  for (const [variacaoNormalizada, entrada] of indice) {
    if (!variacaoNormalizada) {
      continue;
    }
    const regex = new RegExp(`(?:^|\\s)${escapeRegExp(variacaoNormalizada)}(?:\\s|$)`);
    if (regex.test(textoNormalizado)) {
      encontrados.add(entrada.termo);
    }
  }

  return Array.from(encontrados).sort();
}
