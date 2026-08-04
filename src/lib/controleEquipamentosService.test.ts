import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calcularMesesDevidos,
  levantarPendenciasEquipamentos,
} from "@/lib/controleEquipamentosService";

describe("calcularMesesDevidos", () => {
  it("mensal retorna todos os meses ate o limite", () => {
    expect(calcularMesesDevidos("mensal", 4)).toEqual([1, 2, 3, 4]);
  });

  it("semestral retorna so junho e dezembro dentro do limite", () => {
    expect(calcularMesesDevidos("semestral", 12)).toEqual([6, 12]);
    expect(calcularMesesDevidos("semestral", 5)).toEqual([]);
    expect(calcularMesesDevidos("semestral", 7)).toEqual([6]);
  });

  it("anual retorna so dezembro dentro do limite", () => {
    expect(calcularMesesDevidos("anual", 12)).toEqual([12]);
    expect(calcularMesesDevidos("anual", 11)).toEqual([]);
  });

  it("limite zero retorna lista vazia para qualquer frequencia", () => {
    expect(calcularMesesDevidos("mensal", 0)).toEqual([]);
    expect(calcularMesesDevidos("semestral", 0)).toEqual([]);
    expect(calcularMesesDevidos("anual", 0)).toEqual([]);
  });
});

describe("levantarPendenciasEquipamentos", () => {
  it("mapeia as linhas da RPC e calcula os totais", async () => {
    const supabase = {
      rpc: async (nome: string, params: Record<string, unknown>) => {
        expect(nome).toBe("equipamentos_pendencias_ano");
        expect(params).toEqual({ p_ano: 2026, p_mes_limite: expect.any(Number) });
        return {
          data: [
            {
              equipamento_id: "eq-1",
              loja_id: "loja-1",
              loja_nome: "Loja Teste",
              tipo_equipamento: "Gerador",
              identificacao: "Gerador 01",
              frequencia: "mensal",
              meses_com_documentos: [1, 2],
              meses_pendentes: [3],
            },
          ],
          error: null,
        };
      },
    } as unknown as SupabaseClient;

    const pendencias = await levantarPendenciasEquipamentos(2026, supabase);

    expect(pendencias).toEqual([
      {
        equipamento_id: "eq-1",
        loja_id: "loja-1",
        loja_nome: "Loja Teste",
        tipo_equipamento: "Gerador",
        identificacao: "Gerador 01",
        frequencia: "mensal",
        meses_com_documentos: [1, 2],
        meses_pendentes: [3],
        total_esperado: 3,
        total_recebido: 2,
        total_faltante: 1,
      },
    ]);
  });

  it("propaga erro da RPC", async () => {
    const supabase = {
      rpc: async () => ({ data: null, error: new Error("falhou") }),
    } as unknown as SupabaseClient;

    await expect(levantarPendenciasEquipamentos(2026, supabase)).rejects.toThrow(
      "falhou",
    );
  });

  it("trata data/meses nulos da RPC como vazios", async () => {
    const supabase = {
      rpc: async () => ({
        data: [
          {
            equipamento_id: "eq-2",
            loja_id: "loja-1",
            loja_nome: "Loja Teste",
            tipo_equipamento: "Ar Condicionado",
            identificacao: null,
            frequencia: "mensal",
            meses_com_documentos: null,
            meses_pendentes: null,
          },
        ],
        error: null,
      }),
    } as unknown as SupabaseClient;

    const [pendencia] = await levantarPendenciasEquipamentos(2026, supabase);
    expect(pendencia.meses_com_documentos).toEqual([]);
    expect(pendencia.meses_pendentes).toEqual([]);
    expect(pendencia.total_esperado).toBe(0);
  });
});
