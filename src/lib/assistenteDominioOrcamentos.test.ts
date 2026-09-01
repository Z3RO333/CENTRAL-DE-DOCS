import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiAuth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/apiAuth")>("@/lib/apiAuth");
  return {
    ...actual,
    getAuthorizedPrestadorIds: vi.fn(async () => []),
    getGerenteAccessEntries: vi.fn(async () => []),
  };
});
vi.mock("@/lib/orcamentosInternos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/orcamentosInternos")>(
    "@/lib/orcamentosInternos",
  );
  return { ...actual, isAprovadorInterno: vi.fn(async () => false) };
});

import { getAuthorizedPrestadorIds, getGerenteAccessEntries } from "@/lib/apiAuth";
import { isAprovadorInterno } from "@/lib/orcamentosInternos";
import { dominioOrcamentos } from "@/lib/assistenteDominioOrcamentos";
import type { AssistenteContext } from "@/lib/assistenteTypes";

const mockedPrestadores = vi.mocked(getAuthorizedPrestadorIds);
const mockedGerente = vi.mocked(getGerenteAccessEntries);
const mockedAprovador = vi.mocked(isAprovadorInterno);

type FakeCall = { method: string; args: unknown[] };

function makeFakeQuery(result: { data: unknown[]; error: null; count: number }) {
  const calls: FakeCall[] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["select", "eq", "in", "gte", "lte", "or", "order"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.range = async () => result;
  return { builder, calls };
}

function makeCtx(overrides: Partial<AssistenteContext> = {}) {
  const { builder, calls } = makeFakeQuery({ data: [], error: null, count: 0 });
  const fromSpy = vi.fn(() => builder);
  const ctx: AssistenteContext = {
    supabaseAdmin: { from: fromSpy } as never,
    userId: "user-1",
    email: "user@empresa.com",
    isAdmin: false,
    cache: new Map(),
    ...overrides,
  };
  return { ctx, fromSpy, calls };
}

beforeEach(() => {
  mockedPrestadores.mockReset().mockResolvedValue([]);
  mockedGerente.mockReset().mockResolvedValue([]);
  mockedAprovador.mockReset().mockResolvedValue(false);
});

describe("dominioOrcamentos.podeAcessar", () => {
  it("nega acesso a fornecedor externo (so tem prestador, sem gerente/admin)", async () => {
    mockedPrestadores.mockResolvedValueOnce(["prestador-1"]);
    const { ctx } = makeCtx();
    await expect(dominioOrcamentos.podeAcessar(ctx)).resolves.toBe(false);
  });

  it("permite acesso a colaborador interno comum (sem prestador nem gerente)", async () => {
    const { ctx } = makeCtx();
    await expect(dominioOrcamentos.podeAcessar(ctx)).resolves.toBe(true);
  });

  it("permite acesso a quem tem escopo de gerente", async () => {
    mockedGerente.mockResolvedValueOnce([
      { loja_id: "loja-1", prestador_id: null, can_view_all: false },
    ]);
    const { ctx } = makeCtx();
    await expect(dominioOrcamentos.podeAcessar(ctx)).resolves.toBe(true);
  });

  it("permite acesso a admin mesmo com prestador vinculado", async () => {
    mockedPrestadores.mockResolvedValueOnce(["prestador-1"]);
    const { ctx } = makeCtx({ isAdmin: true });
    await expect(dominioOrcamentos.podeAcessar(ctx)).resolves.toBe(true);
  });
});

describe("dominioOrcamentos.executarTool buscar_orcamentos", () => {
  it("usuario comum nunca recebe resultado de outro solicitante mesmo pedindo escopo todos", async () => {
    const { ctx, fromSpy } = makeCtx();
    const result = await dominioOrcamentos.executarTool("buscar_orcamentos", { escopo: "todos" }, ctx);
    expect(fromSpy).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toHaveProperty("erro");
    expect(result.outcome).toBeUndefined();
  });

  it("escopo padrao 'meus' restringe por solicitante_id mesmo sem pedir explicitamente", async () => {
    const { ctx, calls } = makeCtx();
    await dominioOrcamentos.executarTool("buscar_orcamentos", {}, ctx);
    const eqSolicitante = calls.filter(
      (c) => c.method === "eq" && c.args[0] === "solicitante_id" && c.args[1] === "user-1",
    );
    expect(eqSolicitante.length).toBeGreaterThan(0);
  });

  it("rejeita status invalido sem rodar a query", async () => {
    const { ctx, fromSpy } = makeCtx();
    const result = await dominioOrcamentos.executarTool(
      "buscar_orcamentos",
      { status: "nao_existe" },
      ctx,
    );
    expect(fromSpy).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toHaveProperty("erro");
  });

  it("aplica filtros de valor e data corretamente", async () => {
    const { ctx, calls } = makeCtx();
    await dominioOrcamentos.executarTool(
      "buscar_orcamentos",
      { valorMin: "100", valorMax: 500, dataInicio: "2026-01-01", dataFim: "2026-01-31" },
      ctx,
    );
    expect(calls).toContainEqual({ method: "gte", args: ["valor_total", 100] });
    expect(calls).toContainEqual({ method: "lte", args: ["valor_total", 500] });
    expect(calls).toContainEqual({ method: "gte", args: ["created_at", "2026-01-01"] });
    expect(calls).toContainEqual({ method: "lte", args: ["created_at", "2026-01-31T23:59:59"] });
  });

  it("retorna insights com soma de valor_total e mapeia resultados", async () => {
    const { builder, calls } = makeFakeQuery({
      data: [
        {
          id: "orc-1",
          numero_orcamento: "ORC-10",
          prestador_nome: "Fornecedor Teste",
          loja_id: "loja-1",
          loja_nome: "Loja 1",
          status: "aguardando_aprovacao",
          valor_total: 150.5,
          created_at: "2026-01-05T00:00:00.000Z",
          arquivo_original_path: "orc/original.pdf",
          arquivo_assinado_path: null,
          solicitante_id: "user-1",
          gestor_email: "gestor@empresa.com",
        },
      ],
      error: null,
      count: 1,
    });
    const fromSpy = vi.fn(() => builder);
    const ctx: AssistenteContext = {
      supabaseAdmin: { from: fromSpy } as never,
      userId: "user-1",
      email: "user@empresa.com",
      isAdmin: false,
      cache: new Map(),
    };

    const result = await dominioOrcamentos.executarTool("buscar_orcamentos", {}, ctx);

    expect(result.outcome).toBeDefined();
    const outcome = result.outcome!;
    expect(outcome.dominio).toBe("orcamentos");
    expect(outcome.total).toBe(1);
    expect(outcome.results).toEqual([
      {
        id: "orc-1",
        titulo: "ORC-10 — Fornecedor Teste",
        subtitulo: expect.stringContaining("Aguardando aprovação"),
        abrirArquivoPath: "orc/original.pdf",
      },
    ]);
    expect(outcome.insights.totais).toEqual(
      expect.arrayContaining([
        { key: "valorTotal", label: "Valor total", valor: 150.5, formato: "moeda" },
      ]),
    );
    void calls;
  });
});

describe("dominioOrcamentos.descricaoPrompt", () => {
  it("inclui os filtros atuais da tela quando o dominio do contexto e orcamentos", () => {
    const { ctx } = makeCtx({
      currentContext: { dominio: "orcamentos", filtros: { lojaId: "loja-marcador-999" } },
    });
    const prompt = dominioOrcamentos.descricaoPrompt(ctx);
    expect(prompt).toContain("loja-marcador-999");
  });

  it("nao inclui filtros quando o contexto e de outro dominio", () => {
    const { ctx } = makeCtx({
      currentContext: { dominio: "documentos", filtros: { lojaId: "loja-marcador-999" } },
    });
    const prompt = dominioOrcamentos.descricaoPrompt(ctx);
    expect(prompt).not.toContain("loja-marcador-999");
  });
});
