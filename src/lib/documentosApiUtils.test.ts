import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  formatCurrencyBRL,
  getValorOrcamento,
  normalizeIds,
  resolveLimit,
  safeParseDados,
  resumirAchadosCriticosPorDocumento,
} from "@/lib/documentosApiUtils";
import { fixMojibakeText, normalizeDisplayData } from "@/lib/textEncoding";

describe("documentosApiUtils", () => {
  it("safeParseDados retorna objeto valido quando JSON e valido", () => {
    expect(safeParseDados('{"valor": 42}')).toEqual({ valor: 42 });
  });

  it("safeParseDados retorna null para JSON invalido", () => {
    expect(safeParseDados("{invalid")).toBeNull();
  });

  it("safeParseDados retorna null para valores nao-objeto", () => {
    expect(safeParseDados(["a"])).toBeNull();
  });

  it("safeParseDados retorna o proprio objeto quando ja eh objeto", () => {
    expect(safeParseDados({ item: "ok" })).toEqual({ item: "ok" });
  });

  it("resolveLimit respeita limites e fallback", () => {
    expect(resolveLimit(null)).toBe(DEFAULT_LIMIT);
    expect(resolveLimit("0")).toBe(1);
    expect(resolveLimit("10")).toBe(10);
    expect(resolveLimit("999999")).toBe(MAX_LIMIT);
    expect(resolveLimit("abc")).toBe(DEFAULT_LIMIT);
  });

  it("normalizeIds remove caracteres invalidos e deduplica", () => {
    expect(normalizeIds(["  abc ", "a@b", "abc", "", "a-b"])).toEqual([
      "abc",
      "ab",
      "a-b",
    ]);
  });

  it("fixMojibakeText corrige acentos lidos como Windows-1252", () => {
    expect(fixMojibakeText("Relat\u00c3\u00b3rio")).toBe("Relatório");
    expect(fixMojibakeText("SEGURAN\u00c3\u2021A")).toBe("SEGURANÇA");
    expect(fixMojibakeText("REFRIGERA\u00c3\u2021\u00c3\u0192O")).toBe(
      "REFRIGERAÇÃO",
    );
  });

  it("normalizeDisplayData corrige textos em objetos e listas", () => {
    expect(
      normalizeDisplayData({
        prestador: "Din\u00c3\u00a2mica Servi\u00c3\u00a7os",
        anexos: [{ nome: "Laborat\u00c3\u00b3rio.pdf" }],
      }),
    ).toEqual({
      prestador: "Dinâmica Serviços",
      anexos: [{ nome: "Laboratório.pdf" }],
    });
  });

  it("getValorOrcamento le numero de dados.valor", () => {
    expect(getValorOrcamento({ valor: 1234.5 })).toBe(1234.5);
  });

  it("getValorOrcamento converte string com ponto decimal", () => {
    expect(getValorOrcamento({ valor: "1234.50" })).toBe(1234.5);
  });

  it("getValorOrcamento converte string com virgula decimal", () => {
    expect(getValorOrcamento({ valor: "1234,50" })).toBe(1234.5);
  });

  it("getValorOrcamento retorna null quando valor ausente ou invalido", () => {
    expect(getValorOrcamento(null)).toBeNull();
    expect(getValorOrcamento({})).toBeNull();
    expect(getValorOrcamento({ valor: "abc" })).toBeNull();
  });

  it("getValorOrcamento converte string com separador de milhar (formato pt-BR)", () => {
    expect(getValorOrcamento({ valor: "1.155,00" })).toBe(1155);
    expect(getValorOrcamento({ valor: "1.234.567,89" })).toBe(1234567.89);
  });

  it("formatCurrencyBRL formata em Real com duas casas decimais", () => {
    expect(formatCurrencyBRL(1234.5)).toBe(
      (1234.5).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    );
  });

  it("formatCurrencyBRL retorna null quando valor e null", () => {
    expect(formatCurrencyBRL(null)).toBeNull();
  });
});

describe("resumirAchadosCriticosPorDocumento", () => {
  it("retorna objeto vazio quando nao ha achados", () => {
    expect(resumirAchadosCriticosPorDocumento([])).toEqual({});
  });

  it("agrupa um achado por documento", () => {
    const resultado = resumirAchadosCriticosPorDocumento([
      { documento_id: "doc-1", problema: "Vazamento no compressor", prioridade: "critica" },
    ]);
    expect(resultado).toEqual({
      "doc-1": { problema: "Vazamento no compressor", prioridade: "critica", total: 1 },
    });
  });

  it("quando ha mais de um achado, mantem o de maior prioridade e soma o total", () => {
    const resultado = resumirAchadosCriticosPorDocumento([
      { documento_id: "doc-1", problema: "Ruido anormal", prioridade: "critica" },
      { documento_id: "doc-1", problema: "Vazamento identificado", prioridade: "emergencial" },
    ]);
    expect(resultado["doc-1"]).toEqual({
      problema: "Vazamento identificado",
      prioridade: "emergencial",
      total: 2,
    });
  });

  it("mantem critica quando so ha achados critica, mesmo com varios", () => {
    const resultado = resumirAchadosCriticosPorDocumento([
      { documento_id: "doc-1", problema: "Problema A", prioridade: "critica" },
      { documento_id: "doc-1", problema: "Problema B", prioridade: "critica" },
    ]);
    expect(resultado["doc-1"].prioridade).toBe("critica");
    expect(resultado["doc-1"].total).toBe(2);
  });

  it("agrupa documentos diferentes de forma independente", () => {
    const resultado = resumirAchadosCriticosPorDocumento([
      { documento_id: "doc-1", problema: "Problema A", prioridade: "critica" },
      { documento_id: "doc-2", problema: "Problema B", prioridade: "emergencial" },
    ]);
    expect(Object.keys(resultado).sort()).toEqual(["doc-1", "doc-2"]);
    expect(resultado["doc-1"].prioridade).toBe("critica");
    expect(resultado["doc-2"].prioridade).toBe("emergencial");
  });
});
