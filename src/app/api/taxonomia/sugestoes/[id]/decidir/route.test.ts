import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiAuth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/apiAuth")>("@/lib/apiAuth");
  return { ...actual, getActorFromRequest: vi.fn() };
});
vi.mock("@/lib/supabaseAdminClient", () => ({ createSupabaseAdminClient: vi.fn() }));

import { getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { POST } from "./route";

const mockedActor = vi.mocked(getActorFromRequest);
const mockedCreateSupabase = vi.mocked(createSupabaseAdminClient);

const admin = {
  userId: "admin-1",
  email: "admin@empresa.com",
  isAdmin: true,
  realUserId: "admin-1",
  realEmail: "admin@empresa.com",
  realIsAdmin: true,
  isSimulating: false,
};

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/taxonomia/sugestoes/sug-1/decidir", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function makeParams(id = "sug-1") {
  return { params: Promise.resolve({ id }) };
}

type Chamada = { tabela: string; metodo: string; payload?: unknown };

function makeSupabase(sugestao: { id: string; variacao: string; status: string } | null) {
  const chamadas: Chamada[] = [];
  const supabase = {
    from(tabela: string) {
      if (tabela === "taxonomia_sugestoes") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                chamadas.push({ tabela, metodo: "select" });
                return { data: sugestao, error: null };
              },
            }),
          }),
          update: (payload: unknown) => ({
            eq: async () => {
              chamadas.push({ tabela, metodo: "update", payload });
              return { error: null };
            },
          }),
        };
      }
      if (tabela === "taxonomia_termos") {
        return {
          insert: (payload: unknown) => ({
            select: () => ({
              single: async () => {
                chamadas.push({ tabela, metodo: "insert", payload });
                return { data: { id: "termo-novo-1" }, error: null };
              },
            }),
          }),
        };
      }
      if (tabela === "taxonomia_sinonimos") {
        return {
          insert: async (payload: unknown) => {
            chamadas.push({ tabela, metodo: "insert", payload });
            return { error: null };
          },
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  };
  return { supabase, chamadas };
}

beforeEach(() => {
  mockedActor.mockReset();
  mockedCreateSupabase.mockReset();
});

describe("POST /api/taxonomia/sugestoes/[id]/decidir", () => {
  it("rejeita quem nao e admin", async () => {
    mockedActor.mockResolvedValueOnce({ ...admin, isAdmin: false, realIsAdmin: false });
    mockedCreateSupabase.mockReturnValueOnce(makeSupabase(null).supabase as never);

    const response = await POST(makeRequest({ decisao: "rejeitar" }), makeParams());
    expect(response.status).toBe(403);
  });

  it("404 quando a sugestao nao existe", async () => {
    mockedActor.mockResolvedValueOnce(admin);
    mockedCreateSupabase.mockReturnValueOnce(makeSupabase(null).supabase as never);

    const response = await POST(makeRequest({ decisao: "rejeitar" }), makeParams());
    expect(response.status).toBe(404);
  });

  it("400 quando a sugestao ja foi revisada", async () => {
    mockedActor.mockResolvedValueOnce(admin);
    mockedCreateSupabase.mockReturnValueOnce(
      makeSupabase({ id: "sug-1", variacao: "termovisao", status: "aprovada" }).supabase as never,
    );

    const response = await POST(makeRequest({ decisao: "rejeitar" }), makeParams());
    expect(response.status).toBe(400);
  });

  it("rejeitar marca status rejeitada", async () => {
    mockedActor.mockResolvedValueOnce(admin);
    const { supabase, chamadas } = makeSupabase({ id: "sug-1", variacao: "termovisao", status: "pendente" });
    mockedCreateSupabase.mockReturnValueOnce(supabase as never);

    const response = await POST(makeRequest({ decisao: "rejeitar" }), makeParams());
    expect(response.status).toBe(200);
    const update = chamadas.find((c) => c.tabela === "taxonomia_sugestoes" && c.metodo === "update");
    expect(update?.payload).toMatchObject({ status: "rejeitada" });
  });

  it("aprovar_existente cria sinonimo apontando para o termo informado", async () => {
    mockedActor.mockResolvedValueOnce(admin);
    const { supabase, chamadas } = makeSupabase({ id: "sug-1", variacao: "termovisao", status: "pendente" });
    mockedCreateSupabase.mockReturnValueOnce(supabase as never);

    const response = await POST(
      makeRequest({ decisao: "aprovar_existente", termoId: "termo-eletrica" }),
      makeParams(),
    );
    expect(response.status).toBe(200);
    const insert = chamadas.find((c) => c.tabela === "taxonomia_sinonimos" && c.metodo === "insert");
    expect(insert?.payload).toMatchObject({
      termo_id: "termo-eletrica",
      variacao: "termovisao",
      origem: "aprovado",
    });
    const update = chamadas.find((c) => c.tabela === "taxonomia_sugestoes" && c.metodo === "update");
    expect(update?.payload).toMatchObject({ status: "aprovada" });
  });

  it("aprovar_novo cria termo e sinonimo, e marca a sugestao aprovada", async () => {
    mockedActor.mockResolvedValueOnce(admin);
    const { supabase, chamadas } = makeSupabase({ id: "sug-1", variacao: "termovisao", status: "pendente" });
    mockedCreateSupabase.mockReturnValueOnce(supabase as never);

    const response = await POST(
      makeRequest({
        decisao: "aprovar_novo",
        termo: "termografia",
        categoria: "Eletrica",
        tipo: "assunto",
      }),
      makeParams(),
    );
    const payload = (await response.json()) as { ok: boolean; termoId: string };
    expect(response.status).toBe(200);
    expect(payload.termoId).toBe("termo-novo-1");

    const insertTermo = chamadas.find((c) => c.tabela === "taxonomia_termos" && c.metodo === "insert");
    expect(insertTermo?.payload).toMatchObject({
      termo: "termografia",
      categoria: "Eletrica",
      tipo: "assunto",
    });
    const insertSinonimo = chamadas.find((c) => c.tabela === "taxonomia_sinonimos" && c.metodo === "insert");
    expect(insertSinonimo?.payload).toMatchObject({ termo_id: "termo-novo-1", variacao: "termovisao" });
  });

  it("aprovar_novo sem categoria devolve 400", async () => {
    mockedActor.mockResolvedValueOnce(admin);
    const { supabase } = makeSupabase({ id: "sug-1", variacao: "termovisao", status: "pendente" });
    mockedCreateSupabase.mockReturnValueOnce(supabase as never);

    const response = await POST(
      makeRequest({ decisao: "aprovar_novo", termo: "termografia" }),
      makeParams(),
    );
    expect(response.status).toBe(400);
  });
});
