import { describe, expect, it } from "vitest";
import { TAXONOMIA_SEED } from "@/lib/taxonomiaSeed";

describe("TAXONOMIA_SEED", () => {
  it("nao tem termos canonicos duplicados", () => {
    const termos = TAXONOMIA_SEED.map((item) => item.termo);
    expect(new Set(termos).size).toBe(termos.length);
  });

  it("nao tem variacoes duplicadas, nem entre termos diferentes", () => {
    const variacoes = TAXONOMIA_SEED.flatMap((item) => item.sinonimos);
    expect(new Set(variacoes).size).toBe(variacoes.length);
  });

  it("nenhuma variacao repete o proprio termo canonico do mesmo item", () => {
    for (const item of TAXONOMIA_SEED) {
      expect(item.sinonimos).not.toContain(item.termo);
    }
  });

  it("todo item tem categoria e ao menos um sinonimo", () => {
    for (const item of TAXONOMIA_SEED) {
      expect(item.categoria.length).toBeGreaterThan(0);
      expect(item.sinonimos.length).toBeGreaterThan(0);
    }
  });

  it("inclui os equipamentos citados explicitamente na spec", () => {
    const termos = TAXONOMIA_SEED.map((item) => item.termo);
    expect(termos).toEqual(
      expect.arrayContaining([
        "gerador",
        "refrigeracao",
        "elevador",
        "subestacao",
        "extintor",
        "ar condicionado",
      ]),
    );
  });
});
