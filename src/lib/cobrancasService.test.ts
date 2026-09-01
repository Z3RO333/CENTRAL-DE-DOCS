import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anoManaus,
  calcularMesLimite,
  diaManaus,
  levantarPendencias,
  mascararEmail,
} from "@/lib/cobrancasService";

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

  it("usa o fuso de Manaus na virada de mes", () => {
    const aindaMaioEmManaus = new Date("2026-06-01T03:30:00Z");
    expect(calcularMesLimite(2026, aindaMaioEmManaus)).toBe(4);
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

describe("anoManaus", () => {
  it("usa o ano de Manaus na virada UTC", () => {
    const ainda2026EmManaus = new Date("2027-01-01T02:00:00Z");
    expect(anoManaus(ainda2026EmManaus)).toBe(2026);
  });
});

describe("levantarPendencias", () => {
  it("conta documentos recebidos e faltantes por tipo", async () => {
    const supabase = {
      rpc: async () => ({
        data: [
          {
            prestador_id: "prestador-1",
            loja_id: "loja-1",
            loja_nome: "Loja 1",
            meses_com_documentos: [1, 2],
            meses_com_documentos_laudos: [1],
            meses_com_documentos_retencao: [1, 2],
            meses_pendentes: [2, 3],
            meses_pendentes_laudos: [2, 3],
            meses_pendentes_retencao: [3],
          },
        ],
        error: null,
      }),
      from: () => ({
        select: () => ({
          in: async () => ({
            data: [
              {
                id: "prestador-1",
                nome: "Fornecedor Teste",
                usuarios: ["externo@example.com", "interno@bemol.com.br"],
              },
            ],
            error: null,
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const [pendencia] = await levantarPendencias(2026, supabase);

    expect(pendencia.total_recebido).toBe(3);
    expect(pendencia.total_faltante).toBe(3);
    expect(pendencia.total_esperado).toBe(6);
    expect(pendencia.prestador_emails).toEqual(["externo@example.com"]);
  });
});

describe("mascararEmail", () => {
  it("mascara o e-mail mantendo os 2 primeiros e o ultimo caractere do local-part", () => {
    expect(mascararEmail("joaosilva@empresa.com")).toBe("jo******a@empresa.com");
  });

  it("usa fallback quando o local-part tem 2 caracteres ou menos", () => {
    expect(mascararEmail("ab@empresa.com")).toBe("a***@empresa.com");
  });

  it("devolve o email original quando nao ha local-part (formato invalido)", () => {
    expect(mascararEmail("@empresa.com")).toBe("@empresa.com");
  });
});
