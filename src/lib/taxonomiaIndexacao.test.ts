import { beforeEach, describe, expect, it, vi } from "vitest";
import { classificarDocumento } from "@/lib/taxonomiaIndexacao";

type Chamada = { tabela: string; metodo: string; payload?: unknown };

function makeSupabase(opts: {
  termos?: { id: string; termo: string }[];
  sinonimos?: { termo_id: string; variacao: string }[];
  sugestaoExistente?: { id: string; ocorrencias: number; status: string } | null;
}) {
  const chamadas: Chamada[] = [];
  const termos = opts.termos ?? [{ id: "t-gerador", termo: "gerador" }];
  const sinonimos = opts.sinonimos ?? [];
  const sugestaoExistente = opts.sugestaoExistente ?? null;

  const supabase = {
    from(tabela: string) {
      if (tabela === "taxonomia_termos") {
        return {
          select: () => ({
            eq: async () => {
              chamadas.push({ tabela, metodo: "select" });
              return { data: termos, error: null };
            },
          }),
        };
      }
      if (tabela === "taxonomia_sinonimos") {
        return {
          select: async () => {
            chamadas.push({ tabela, metodo: "select" });
            return { data: sinonimos, error: null };
          },
          insert: async (payload: unknown) => {
            chamadas.push({ tabela, metodo: "insert", payload });
            return { error: null };
          },
        };
      }
      if (tabela === "documento_conteudo") {
        return {
          update: (payload: unknown) => ({
            eq: async () => {
              chamadas.push({ tabela, metodo: "update", payload });
              return { error: null };
            },
          }),
        };
      }
      if (tabela === "taxonomia_sugestoes") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                chamadas.push({ tabela, metodo: "select" });
                return { data: sugestaoExistente, error: null };
              },
            }),
          }),
          insert: async (payload: unknown) => {
            chamadas.push({ tabela, metodo: "insert", payload });
            return { error: null };
          },
          update: (payload: unknown) => ({
            eq: async () => {
              chamadas.push({ tabela, metodo: "update", payload });
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  };

  return { supabase, chamadas };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("classificarDocumento", () => {
  it("pula quando nao ha texto, sem tocar em taxonomia_sugestoes", async () => {
    const { supabase, chamadas } = makeSupabase({});
    const resultado = await classificarDocumento(supabase as never, {
      documentoId: "doc-1",
      texto: null,
      equipamentoTipo: null,
      equipamentoIdentificacao: null,
    });
    expect(resultado).toEqual({ status: "pulado", termos: [], detalhe: "sem_texto" });
    expect(chamadas.some((c) => c.tabela === "taxonomia_sugestoes")).toBe(false);
  });

  it("classifica o texto e grava termos + termos_classificado_em", async () => {
    const { supabase, chamadas } = makeSupabase({});
    const resultado = await classificarDocumento(supabase as never, {
      documentoId: "doc-1",
      texto: "Laudo de manutencao do gerador da loja Matriz.",
      equipamentoTipo: null,
      equipamentoIdentificacao: null,
    });
    expect(resultado.status).toBe("classificado");
    expect(resultado.termos).toEqual(["gerador"]);
    const update = chamadas.find((c) => c.tabela === "documento_conteudo" && c.metodo === "update");
    expect(update?.payload).toMatchObject({ termos: ["gerador"] });
    expect(
      (update?.payload as { termos_classificado_em?: string }).termos_classificado_em,
    ).toEqual(expect.any(String));
  });

  it("registra sugestao quando equipamentoTipo nao bate com nenhum termo conhecido", async () => {
    const { supabase, chamadas } = makeSupabase({});
    await classificarDocumento(supabase as never, {
      documentoId: "doc-2",
      texto: "Relatorio de inspecao.",
      equipamentoTipo: "Termovisao Predial",
      equipamentoIdentificacao: "Painel 3",
    });
    const insert = chamadas.find((c) => c.tabela === "taxonomia_sugestoes" && c.metodo === "insert");
    expect(insert?.payload).toMatchObject({
      variacao: "termovisao predial",
      termo_sugerido: "Termovisao Predial",
      documento_id: "doc-2",
      trecho: "Painel 3",
      ocorrencias: 1,
    });
  });

  it("nao registra sugestao quando equipamentoTipo ja bate com um termo/sinonimo conhecido", async () => {
    const { supabase, chamadas } = makeSupabase({});
    await classificarDocumento(supabase as never, {
      documentoId: "doc-3",
      texto: "Relatorio.",
      equipamentoTipo: "Gerador",
      equipamentoIdentificacao: null,
    });
    expect(chamadas.some((c) => c.tabela === "taxonomia_sugestoes" && c.metodo === "insert")).toBe(
      false,
    );
  });

  it("incrementa ocorrencias em vez de duplicar quando a sugestao pendente ja existe", async () => {
    const { supabase, chamadas } = makeSupabase({
      sugestaoExistente: { id: "sug-1", ocorrencias: 2, status: "pendente" },
    });
    await classificarDocumento(supabase as never, {
      documentoId: "doc-4",
      texto: "Relatorio.",
      equipamentoTipo: "Termovisao Predial",
      equipamentoIdentificacao: null,
    });
    const update = chamadas.find((c) => c.tabela === "taxonomia_sugestoes" && c.metodo === "update");
    expect(update?.payload).toMatchObject({ ocorrencias: 3 });
    expect(chamadas.some((c) => c.tabela === "taxonomia_sugestoes" && c.metodo === "insert")).toBe(
      false,
    );
  });

  it("nao reabre sugestao ja revisada (aprovada ou rejeitada)", async () => {
    const { supabase, chamadas } = makeSupabase({
      sugestaoExistente: { id: "sug-1", ocorrencias: 5, status: "rejeitada" },
    });
    await classificarDocumento(supabase as never, {
      documentoId: "doc-5",
      texto: "Relatorio.",
      equipamentoTipo: "Termovisao Predial",
      equipamentoIdentificacao: null,
    });
    expect(chamadas.some((c) => c.tabela === "taxonomia_sugestoes" && c.metodo !== "select")).toBe(
      false,
    );
  });

  it("falha ao gravar termos: devolve status erro sem lancar", async () => {
    const { chamadas } = makeSupabase({});
    const supabaseComErro = {
      from(tabela: string) {
        if (tabela === "taxonomia_termos") {
          return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
        }
        if (tabela === "taxonomia_sinonimos") {
          return { select: async () => ({ data: [], error: null }) };
        }
        if (tabela === "documento_conteudo") {
          return {
            update: () => ({
              eq: async () => ({ error: new Error("conexao perdida") }),
            }),
          };
        }
        throw new Error(`tabela inesperada: ${tabela}`);
      },
    };
    const resultado = await classificarDocumento(supabaseComErro as never, {
      documentoId: "doc-6",
      texto: "Relatorio.",
      equipamentoTipo: null,
      equipamentoIdentificacao: null,
    });
    expect(resultado.status).toBe("erro");
    expect(resultado.detalhe).toContain("conexao perdida");
    void chamadas;
  });
});
