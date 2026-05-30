import { describe, it, expect } from "vitest";
import { calcularMesLimite, diaManaus } from "@/lib/cobrancasService";

describe("calcularMesLimite", () => {
  const hojeMaio2026 = new Date(2026, 4, 29); // 29/05/2026 (mês 5)

  it("ano corrente: cobra até o mês anterior ao atual", () => {
    // Em maio, apenas jan–abr (4 meses) já são devidos
    expect(calcularMesLimite(2026, hojeMaio2026)).toBe(4);
  });

  it("ano fechado: cobra os 12 meses", () => {
    expect(calcularMesLimite(2025, hojeMaio2026)).toBe(12);
    expect(calcularMesLimite(2020, hojeMaio2026)).toBe(12);
  });

  it("ano futuro: não cobra nada", () => {
    expect(calcularMesLimite(2027, hojeMaio2026)).toBe(0);
  });

  it("janeiro do ano corrente: nada vencido ainda", () => {
    const janeiro = new Date(2026, 0, 10);
    expect(calcularMesLimite(2026, janeiro)).toBe(0);
  });
});

describe("diaManaus", () => {
  it("retorna a data no formato YYYY-MM-DD", () => {
    const d = new Date("2026-05-29T12:00:00Z");
    expect(diaManaus(d)).toBe("2026-05-29");
  });

  it("ajusta a virada de dia para o fuso de Manaus (UTC-4)", () => {
    // 01:00 UTC ainda é 21:00 do dia anterior em Manaus
    const d = new Date("2026-05-29T01:00:00Z");
    expect(diaManaus(d)).toBe("2026-05-28");
  });
});
