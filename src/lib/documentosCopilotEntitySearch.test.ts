import { describe, expect, it, vi } from "vitest";
import {
  buscarLojasPorNome,
  buscarPrestadoresPorNome,
} from "@/lib/documentosCopilotEntitySearch";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("buscarLojasPorNome", () => {
  it("busca por nome ou codigo parecido e devolve id/nome/codigo", async () => {
    const or = vi.fn(() => ({
      limit: async () => ({
        data: [{ id: "loja-302", nome: "302 - Avenida Paulista", codigo: "302" }],
        error: null,
      }),
    }));
    const supabase = {
      from: () => ({ select: () => ({ or }) }),
    } as unknown as SupabaseClient;

    const resultado = await buscarLojasPorNome("avenida", supabase);

    expect(resultado).toEqual([
      { id: "loja-302", nome: "302 - Avenida Paulista", codigo: "302" },
    ]);
    expect(or).toHaveBeenCalledWith(
      "nome.ilike.%avenida%,codigo.ilike.%avenida%",
    );
  });

  it("remove virgulas e parenteses do termo antes de montar o filtro", async () => {
    const or = vi.fn(() => ({ limit: async () => ({ data: [], error: null }) }));
    const supabase = {
      from: () => ({ select: () => ({ or }) }),
    } as unknown as SupabaseClient;

    await buscarLojasPorNome("avenida, (matriz)", supabase);

    expect(or).toHaveBeenCalledWith(
      "nome.ilike.%avenida  matriz%,codigo.ilike.%avenida  matriz%",
    );
  });

  it("devolve lista vazia para termo em branco sem consultar o banco", async () => {
    const from = vi.fn();
    const supabase = { from } as unknown as SupabaseClient;

    expect(await buscarLojasPorNome("   ", supabase)).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("propaga erro do supabase", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          or: () => ({ limit: async () => ({ data: null, error: new Error("falha") }) }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(buscarLojasPorNome("avenida", supabase)).rejects.toThrow("falha");
  });
});

describe("buscarPrestadoresPorNome", () => {
  it("busca por nome parecido e devolve id/nome", async () => {
    const ilike = vi.fn(() => ({
      limit: async () => ({
        data: [{ id: "prestador-1", nome: "Dinâmica Serviços" }],
        error: null,
      }),
    }));
    const supabase = {
      from: () => ({ select: () => ({ ilike }) }),
    } as unknown as SupabaseClient;

    const resultado = await buscarPrestadoresPorNome("dinamica", supabase);

    expect(resultado).toEqual([{ id: "prestador-1", nome: "Dinâmica Serviços" }]);
    expect(ilike).toHaveBeenCalledWith("nome", "%dinamica%");
  });

  it("devolve lista vazia para termo em branco sem consultar o banco", async () => {
    const from = vi.fn();
    const supabase = { from } as unknown as SupabaseClient;

    expect(await buscarPrestadoresPorNome("", supabase)).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});
