import { describe, expect, it } from "vitest";
import {
  CHUNK_MIN_UTIL,
  dividirEmChunks,
} from "@/lib/documentoChunking";

const paragrafo = (tamanho: number, palavra = "laudo") => {
  const bloco = `${palavra} `.repeat(Math.ceil(tamanho / (palavra.length + 1)));
  return bloco.slice(0, tamanho).trim();
};

describe("dividirEmChunks", () => {
  it("retorna vazio para texto vazio ou so espacos", () => {
    expect(dividirEmChunks("")).toEqual([]);
    expect(dividirEmChunks("   \n\n  ")).toEqual([]);
  });

  it("mantem um texto curto em um unico chunk", () => {
    const chunks = dividirEmChunks("Laudo do gerador aprovado sem restricoes tecnicas.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].ordem).toBe(0);
    expect(chunks[0].pagina).toBeNull();
  });

  it("empacota paragrafos ate o alvo e numera em ordem", () => {
    const p1 = paragrafo(55);
    const p2 = paragrafo(55, "motor");
    const chunks = dividirEmChunks(`${p1}\n\n${p2}`, {
      alvo: 60,
      sobreposicao: 0,
      minUtil: 10,
    });
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.ordem)).toEqual([0, 1]);
    expect(chunks[0].texto).toBe(p1);
    expect(chunks[1].texto).toBe(p2);
  });

  it("aplica sobreposicao do chunk anterior no seguinte", () => {
    const p1 = paragrafo(55);
    const p2 = paragrafo(55, "motor");
    const chunks = dividirEmChunks(`${p1}\n\n${p2}`, {
      alvo: 60,
      sobreposicao: 12,
      minUtil: 10,
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[1].texto.endsWith(p2)).toBe(true);
    expect(chunks[1].texto.length).toBeGreaterThan(p2.length);
  });

  it("descarta fragmento abaixo do minimo util quando ha trecho util", () => {
    // 58 + 2 (separador) + 2 ("ok") = 62 > alvo 60, entao "ok" vira um bloco
    // separado em vez de ser empacotado junto — e ai cai abaixo do minimo util.
    const grande = paragrafo(58);
    const chunks = dividirEmChunks(`${grande}\n\nok`, {
      alvo: 60,
      sobreposicao: 0,
      minUtil: 50,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].texto).toBe(grande);
  });

  it("mantem o texto quando todos os trechos ficariam abaixo do minimo", () => {
    const chunks = dividirEmChunks("Laudo ok.", { minUtil: CHUNK_MIN_UTIL });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].texto).toBe("Laudo ok.");
  });

  it("quebra paragrafo maior que o alvo sem estourar o limite", () => {
    const enorme = paragrafo(500);
    const chunks = dividirEmChunks(enorme, { alvo: 100, sobreposicao: 0, minUtil: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.texto.length).toBeLessThanOrEqual(100);
    }
  });
});
