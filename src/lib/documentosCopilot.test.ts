import { describe, expect, it, vi } from "vitest";
import { queryDocumentoCandidates } from "@/lib/documentosCopilot";
import type { SupabaseClient } from "@supabase/supabase-js";

function createFormulariosBuilder(result: { data: unknown[]; count: number }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: Record<string, any> = {};
  const self = () => builder;
  builder.select = vi.fn(self);
  builder.order = vi.fn(self);
  builder.eq = vi.fn(self);
  builder.in = vi.fn(self);
  builder.or = vi.fn(self);
  builder.ilike = vi.fn(self);
  builder.neq = vi.fn(self);
  builder.gte = vi.fn(self);
  builder.lt = vi.fn(self);
  builder.range = vi.fn(async () => ({
    data: result.data,
    error: null,
    count: result.count,
  }));
  return builder;
}

function createSupabaseAdmin(builder: ReturnType<typeof createFormulariosBuilder>) {
  return {
    from: vi.fn((table: string) => {
      if (table === "formularios") {
        return builder;
      }
      throw new Error(`Tabela inesperada no mock: ${table}`);
    }),
  } as unknown as SupabaseClient;
}

describe("queryDocumentoCandidates - filtro de loja/prestador aplicado na query", () => {
  it("aplica .eq('prestador_id', ...) quando prestadorId e informado, com canAccess=true", async () => {
    const builder = createFormulariosBuilder({ data: [], count: 0 });
    const supabaseAdmin = createSupabaseAdmin(builder);

    await queryDocumentoCandidates({
      filters: { prestadorId: "prestador-1" },
      userId: "user-1",
      allowedPrestadores: [],
      gerenteEntries: [],
      canAccess: true,
      supabaseAdmin,
    });

    expect(builder.eq).toHaveBeenCalledWith("prestador_id", "prestador-1");
  });

  it('aplica .eq("dados->>loja_id", ...) quando lojaId e informado, com canAccess=true', async () => {
    const builder = createFormulariosBuilder({ data: [], count: 0 });
    const supabaseAdmin = createSupabaseAdmin(builder);

    await queryDocumentoCandidates({
      filters: { lojaId: "loja-302" },
      userId: "user-1",
      allowedPrestadores: [],
      gerenteEntries: [],
      canAccess: true,
      supabaseAdmin,
    });

    expect(builder.eq).toHaveBeenCalledWith("dados->>loja_id", "loja-302");
  });

  it("continua aplicando o filtro de loja/prestador quando canAccess=false (usuario com acesso restrito)", async () => {
    const builder = createFormulariosBuilder({ data: [], count: 0 });
    const supabaseAdmin = createSupabaseAdmin(builder);

    await queryDocumentoCandidates({
      filters: { lojaId: "loja-302", prestadorId: "prestador-1" },
      userId: "user-1",
      allowedPrestadores: ["prestador-1"],
      gerenteEntries: [
        { loja_id: "loja-302", prestador_id: null, can_view_all: true },
      ],
      canAccess: false,
      supabaseAdmin,
    });

    expect(builder.eq).toHaveBeenCalledWith("prestador_id", "prestador-1");
    expect(builder.eq).toHaveBeenCalledWith("dados->>loja_id", "loja-302");
  });

  it("nao aplica filtro de loja/prestador quando nenhum e informado", async () => {
    const builder = createFormulariosBuilder({ data: [], count: 0 });
    const supabaseAdmin = createSupabaseAdmin(builder);

    await queryDocumentoCandidates({
      filters: {},
      userId: "user-1",
      allowedPrestadores: [],
      gerenteEntries: [],
      canAccess: true,
      supabaseAdmin,
    });

    expect(builder.eq).not.toHaveBeenCalledWith("prestador_id", expect.anything());
    expect(builder.eq).not.toHaveBeenCalledWith("dados->>loja_id", expect.anything());
  });
});
