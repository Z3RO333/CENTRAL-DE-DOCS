import { describe, expect, it } from "vitest";
import {
  encontrarLojaCorrespondente,
  normalizarNomeUnidade,
} from "@/lib/equipamentosImport";

describe("normalizarNomeUnidade", () => {
  it("converte para maiusculas e remove acentos", () => {
    expect(normalizarNomeUnidade("Camapuã")).toBe("CAMAPUA");
    expect(normalizarNomeUnidade("Codajás")).toBe("CODAJAS");
  });

  it("remove o prefixo Farma / Bemol Farma", () => {
    expect(normalizarNomeUnidade("Farma Torquato")).toBe("TORQUATO");
    expect(normalizarNomeUnidade("Bemol Farma Nova Cidade")).toBe("NOVA CIDADE");
  });

  it("colapsa espacos e remove abreviacoes com ponto", () => {
    expect(normalizarNomeUnidade("P. Negra")).toBe("P NEGRA");
    expect(normalizarNomeUnidade("G.  Circular")).toBe("G CIRCULAR");
  });

  it("mantem o nome ja normalizado sem alteracao", () => {
    expect(normalizarNomeUnidade("MATRIZ")).toBe("MATRIZ");
  });
});

describe("encontrarLojaCorrespondente", () => {
  const lojas = [
    { id: "1", nome: "PONTA NEGRA", codigo: "114" },
    { id: "2", nome: "GRANDE CIRCULAR", codigo: "109" },
    { id: "3", nome: "BEMOL FARMA TORQUATO", codigo: "601" },
    { id: "4", nome: "NOVA CIDADE", codigo: "121" },
    { id: "5", nome: "CIDADE NOVA", codigo: "115" },
  ];

  it("acha match exato por nome normalizado", () => {
    expect(encontrarLojaCorrespondente("Nova Cidade", lojas)?.id).toBe("4");
    expect(encontrarLojaCorrespondente("Farma Torquato", lojas)?.id).toBe("3");
  });

  it("nao confunde Nova Cidade com Cidade Nova", () => {
    expect(encontrarLojaCorrespondente("Cidade Nova", lojas)?.id).toBe("5");
    expect(encontrarLojaCorrespondente("Nova Cidade", lojas)?.id).not.toBe("5");
  });

  it("retorna null quando nao ha match", () => {
    expect(encontrarLojaCorrespondente("Loja Inexistente", lojas)).toBeNull();
  });
});
