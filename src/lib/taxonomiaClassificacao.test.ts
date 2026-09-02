import { describe, expect, it } from "vitest";
import {
  classificarTexto,
  construirIndiceTaxonomia,
  normalizarTermo,
} from "@/lib/taxonomiaClassificacao";

describe("normalizarTermo", () => {
  it("remove acentos, baixa a caixa e colapsa espacos", () => {
    expect(normalizarTermo("  Subestação   Elétrica ")).toBe("subestacao eletrica");
  });

  it("remove pontuacao mantendo letras e numeros", () => {
    expect(normalizarTermo("Grupo-Motogerador (GMG)")).toBe("grupo motogerador gmg");
  });
});

describe("construirIndiceTaxonomia", () => {
  const termos = [
    { id: "t-gerador", termo: "gerador" },
    { id: "t-elevador", termo: "elevador" },
  ];
  const sinonimos = [
    { termo_id: "t-gerador", variacao: "grupo motogerador" },
    { termo_id: "t-gerador", variacao: "GMG" },
    { termo_id: "t-elevador", variacao: "casa de maquinas" },
  ];

  it("indexa o proprio termo canonico alem dos sinonimos", () => {
    const indice = construirIndiceTaxonomia(termos, sinonimos);
    expect(indice.get("gerador")).toEqual({ termoId: "t-gerador", termo: "gerador" });
    expect(indice.get("grupo motogerador")).toEqual({ termoId: "t-gerador", termo: "gerador" });
  });

  it("normaliza a variacao antes de indexar", () => {
    const indice = construirIndiceTaxonomia(termos, sinonimos);
    expect(indice.get("gmg")).toEqual({ termoId: "t-gerador", termo: "gerador" });
  });

  it("ignora sinonimo orfao (termo_id sem termo correspondente)", () => {
    const indice = construirIndiceTaxonomia(termos, [
      { termo_id: "t-inexistente", variacao: "algo" },
    ]);
    expect(indice.has("algo")).toBe(false);
  });
});

describe("classificarTexto", () => {
  const indice = construirIndiceTaxonomia(
    [
      { id: "t-gerador", termo: "gerador" },
      { id: "t-elevador", termo: "elevador" },
    ],
    [
      { termo_id: "t-gerador", variacao: "grupo motogerador" },
      { termo_id: "t-gerador", variacao: "GMG" },
    ],
  );

  it("retorna vazio para texto vazio", () => {
    expect(classificarTexto("", indice)).toEqual([]);
    expect(classificarTexto("   ", indice)).toEqual([]);
  });

  it("encontra o termo canonico pelo proprio nome", () => {
    expect(classificarTexto("Laudo de manutencao do gerador da loja Matriz.", indice)).toEqual([
      "gerador",
    ]);
  });

  it("encontra o termo canonico por um sinonimo, inclusive com acentuacao/caixa diferente", () => {
    expect(classificarTexto("Realizado teste no GRUPO MOTOGERADOR da unidade.", indice)).toEqual([
      "gerador",
    ]);
  });

  it("nao da falso positivo por substring dentro de outra palavra", () => {
    const indiceComGas = construirIndiceTaxonomia([{ id: "t-gas", termo: "gas" }], []);
    // "gas" e substring literal de "algas" — o match precisa exigir limite de
    // palavra, senao "algas marinhas" seria classificado como assunto "gas".
    expect(classificarTexto("Foram encontradas algas na caixa dagua.", indiceComGas)).toEqual([]);
  });

  it("dedup quando o termo e o sinonimo aparecem no mesmo texto", () => {
    expect(
      classificarTexto("Manutencao do gerador. O GMG apresentou falha na partida.", indice),
    ).toEqual(["gerador"]);
  });

  it("encontra multiplos termos diferentes, em ordem alfabetica", () => {
    expect(
      classificarTexto("Vistoria do elevador e teste do gerador na mesma visita.", indice),
    ).toEqual(["elevador", "gerador"]);
  });
});
