export function normalizarNomeUnidade(nome: string): string {
  const semAcento = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();

  const semPrefixo = semAcento
    .replace(/^BEMOL\s+FARMA\s+/, "")
    .replace(/^FARMA\s+/, "");

  return semPrefixo
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function encontrarLojaCorrespondente(
  nomeUnidade: string,
  lojas: Array<{ id: string; nome: string; codigo: string | null }>,
): { id: string; nome: string } | null {
  const alvo = normalizarNomeUnidade(nomeUnidade);

  const porNome = lojas.find((loja) => normalizarNomeUnidade(loja.nome) === alvo);
  if (porNome) {
    return { id: porNome.id, nome: porNome.nome };
  }

  if (/^\d+$/.test(nomeUnidade.trim())) {
    const porCodigo = lojas.find((loja) => loja.codigo === nomeUnidade.trim());
    if (porCodigo) {
      return { id: porCodigo.id, nome: porCodigo.nome };
    }
  }

  return null;
}
