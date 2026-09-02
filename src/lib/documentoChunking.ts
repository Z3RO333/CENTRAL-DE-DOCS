export type DocumentoChunk = {
  ordem: number;
  texto: string;
  /** Sempre null na Fase 1: o OCR atual devolve o documento inteiro, sem mapa de paginas. */
  pagina: number | null;
};

export const CHUNK_ALVO = 1000;
export const CHUNK_SOBREPOSICAO = 150;
export const CHUNK_MIN_UTIL = 50;

const normalizar = (texto: string) =>
  texto
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const dividirEmSentencas = (bloco: string): string[] => {
  const partes = bloco.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
  return partes ? partes.map((parte) => parte.trim()).filter(Boolean) : [bloco];
};

const fatiarDuro = (texto: string, alvo: number): string[] => {
  const fatias: string[] = [];
  for (let inicio = 0; inicio < texto.length; inicio += alvo) {
    fatias.push(texto.slice(inicio, inicio + alvo));
  }
  return fatias;
};

const explodirBloco = (bloco: string, alvo: number): string[] => {
  if (bloco.length <= alvo) {
    return [bloco];
  }
  const saida: string[] = [];
  for (const sentenca of dividirEmSentencas(bloco)) {
    if (sentenca.length <= alvo) {
      saida.push(sentenca);
    } else {
      saida.push(...fatiarDuro(sentenca, alvo));
    }
  }
  return saida;
};

/** Cauda do texto anterior, cortada no inicio de palavra para nao comecar picotado. */
const caudaEmLimiteDePalavra = (texto: string, tamanho: number) => {
  if (tamanho <= 0) {
    return "";
  }
  if (texto.length <= tamanho) {
    return texto;
  }
  const cauda = texto.slice(-tamanho);
  const espaco = cauda.indexOf(" ");
  return espaco === -1 ? cauda : cauda.slice(espaco + 1);
};

export function dividirEmChunks(
  texto: string,
  opcoes: { alvo?: number; sobreposicao?: number; minUtil?: number } = {},
): DocumentoChunk[] {
  const alvo = opcoes.alvo ?? CHUNK_ALVO;
  const sobreposicao = opcoes.sobreposicao ?? CHUNK_SOBREPOSICAO;
  const minUtil = opcoes.minUtil ?? CHUNK_MIN_UTIL;

  const normalizado = normalizar(texto ?? "");
  if (!normalizado) {
    return [];
  }

  const blocos = normalizado
    .split(/\n\s*\n/)
    .map((bloco) => bloco.trim())
    .filter(Boolean)
    .flatMap((bloco) => explodirBloco(bloco, alvo));

  const brutos: string[] = [];
  let atual = "";
  for (const bloco of blocos) {
    const candidato = atual ? `${atual}\n\n${bloco}` : bloco;
    if (candidato.length > alvo && atual) {
      brutos.push(atual);
      atual = bloco;
    } else {
      atual = candidato;
    }
  }
  if (atual) {
    brutos.push(atual);
  }

  // Fragmentos curtos sao ruido de OCR — mas se TODOS ficarem abaixo do minimo,
  // o documento e curto de verdade e deve continuar pesquisavel.
  const uteis = brutos.filter((bloco) => bloco.trim().length >= minUtil);
  const finais = uteis.length > 0 ? uteis : brutos;

  return finais.map((textoChunk, indice) => {
    const anterior = indice > 0 ? finais[indice - 1] : null;
    const prefixo = anterior ? caudaEmLimiteDePalavra(anterior, sobreposicao) : "";
    return {
      ordem: indice,
      texto: prefixo ? `${prefixo} ${textoChunk}` : textoChunk,
      pagina: null,
    };
  });
}
