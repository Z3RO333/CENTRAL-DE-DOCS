import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/orcamentosInternos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/orcamentosInternos")>(
    "@/lib/orcamentosInternos",
  );
  return { ...actual, isAprovadorInterno: vi.fn(async () => false) };
});
vi.mock("@/lib/cobrancasService", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cobrancasService")>(
    "@/lib/cobrancasService",
  );
  return { ...actual, levantarPendencias: vi.fn(async () => []) };
});

import { isAprovadorInterno } from "@/lib/orcamentosInternos";
import { levantarPendencias } from "@/lib/cobrancasService";
import { dominioCobrancas } from "@/lib/assistenteDominioCobrancas";
import type { AssistenteContext } from "@/lib/assistenteTypes";

const mockedAprovador = vi.mocked(isAprovadorInterno);
const mockedPendencias = vi.mocked(levantarPendencias);

function makeCtx(overrides: Partial<AssistenteContext> = {}): AssistenteContext {
  return {
    supabaseAdmin: {} as never,
    userId: "user-1",
    email: "user@empresa.com",
    isAdmin: false,
    cache: new Map(),
    ...overrides,
  };
}

beforeEach(() => {
  mockedAprovador.mockReset().mockResolvedValue(false);
  mockedPendencias.mockReset().mockResolvedValue([]);
});

describe("dominioCobrancas.podeAcessar", () => {
  it("nega acesso a usuario comum (nao admin, nao aprovador)", async () => {
    await expect(dominioCobrancas.podeAcessar(makeCtx())).resolves.toBe(false);
  });

  it("permite acesso a admin", async () => {
    await expect(dominioCobrancas.podeAcessar(makeCtx({ isAdmin: true }))).resolves.toBe(true);
  });

  it("permite acesso a aprovador interno", async () => {
    mockedAprovador.mockResolvedValueOnce(true);
    await expect(dominioCobrancas.podeAcessar(makeCtx())).resolves.toBe(true);
  });
});

describe("dominioCobrancas.executarTool consultar_pendencias_cobranca", () => {
  const rows = [
    {
      prestador_id: "prestador-1",
      prestador_nome: "Fornecedor A",
      prestador_emails: ["contato@fornecedora.com"],
      loja_id: "loja-1",
      loja_nome: "Loja 1",
      ano_referencia: 2026,
      meses_com_documentos: [1],
      meses_com_documentos_laudos: [1],
      meses_com_documentos_retencao: [1],
      meses_pendentes: [2, 3],
      meses_pendentes_laudos: [2],
      meses_pendentes_retencao: [3],
      total_esperado: 4,
      total_recebido: 2,
      total_faltante: 2,
    },
    {
      prestador_id: "prestador-1",
      prestador_nome: "Fornecedor A",
      prestador_emails: ["contato@fornecedora.com"],
      loja_id: "loja-2",
      loja_nome: "Loja 2",
      ano_referencia: 2026,
      meses_com_documentos: [],
      meses_com_documentos_laudos: [],
      meses_com_documentos_retencao: [],
      meses_pendentes: [1],
      meses_pendentes_laudos: [1],
      meses_pendentes_retencao: [],
      total_esperado: 1,
      total_recebido: 0,
      total_faltante: 1,
    },
    {
      prestador_id: "prestador-2",
      prestador_nome: "Fornecedor B",
      prestador_emails: ["contato@fornecedorb.com"],
      loja_id: "loja-1",
      loja_nome: "Loja 1",
      ano_referencia: 2026,
      meses_com_documentos: [1, 2],
      meses_com_documentos_laudos: [1, 2],
      meses_com_documentos_retencao: [1, 2],
      meses_pendentes: [],
      meses_pendentes_laudos: [],
      meses_pendentes_retencao: [],
      total_esperado: 2,
      total_recebido: 2,
      total_faltante: 0,
    },
  ];

  it("chama levantarPendencias com o ano informado", async () => {
    await dominioCobrancas.executarTool(
      "consultar_pendencias_cobranca",
      { ano: "2025" },
      makeCtx({ isAdmin: true }),
    );
    expect(mockedPendencias).toHaveBeenCalledWith(2025, expect.anything());
  });

  it("usa o ano padrao (undefined) quando nao informado ou invalido", async () => {
    await dominioCobrancas.executarTool(
      "consultar_pendencias_cobranca",
      { ano: "abc" },
      makeCtx({ isAdmin: true }),
    );
    expect(mockedPendencias).toHaveBeenCalledWith(undefined, expect.anything());
  });

  it("agrupa por prestador (soma total_faltante entre lojas) nos resultados", async () => {
    mockedPendencias.mockResolvedValueOnce(rows);
    const result = await dominioCobrancas.executarTool(
      "consultar_pendencias_cobranca",
      {},
      makeCtx({ isAdmin: true }),
    );
    expect(result.outcome).toBeDefined();
    const outcome = result.outcome!;
    expect(outcome.dominio).toBe("cobrancas");
    expect(outcome.total).toBe(3);
    expect(outcome.results[0]).toEqual({
      id: "prestador-1",
      titulo: "Fornecedor A",
      subtitulo: "2 pendência(s) / 3 faltante(s)",
      url: "/documentos/cobrancas",
    });
  });

  it("calcula insights.totais e a distribuicao por prestador/por loja", async () => {
    mockedPendencias.mockResolvedValueOnce(rows);
    const result = await dominioCobrancas.executarTool(
      "consultar_pendencias_cobranca",
      {},
      makeCtx({ isAdmin: true }),
    );
    const insights = result.outcome!.insights;
    expect(insights.totais).toEqual(
      expect.arrayContaining([
        { key: "totalFornecedores", label: "Fornecedores", valor: 2 },
        { key: "totalLojasPendentes", label: "Lojas pendentes", valor: 2 },
        { key: "totalFaltante", label: "Documentos faltantes", valor: 3 },
      ]),
    );
    expect(insights.porStatus[0]).toMatchObject({ label: "Fornecedor A", total: 3 });
    expect(insights.tendenciaMensal).toEqual([]);
  });

  it("mascara os e-mails no resumo enviado ao modelo", async () => {
    mockedPendencias.mockResolvedValueOnce(rows);
    const result = await dominioCobrancas.executarTool(
      "consultar_pendencias_cobranca",
      {},
      makeCtx({ isAdmin: true }),
    );
    const resumo = JSON.parse(result.content) as {
      amostra: { emails_contato: string[] }[];
    };
    expect(resumo.amostra[0].emails_contato[0]).not.toBe("contato@fornecedora.com");
    expect(resumo.amostra[0].emails_contato[0]).toContain("@fornecedora.com");
  });

  it("bloqueia usuario sem acesso mesmo se chamado diretamente", async () => {
    const result = await dominioCobrancas.executarTool(
      "consultar_pendencias_cobranca",
      {},
      makeCtx(),
    );
    expect(mockedPendencias).not.toHaveBeenCalled();
    const resumo = JSON.parse(result.content) as { erro?: string };
    expect(resumo.erro).toBe("Sem acesso a cobranças.");
  });
});

describe("dominioCobrancas.descricaoPrompt", () => {
  it("reforca que o agente nunca dispara cobranca", () => {
    const prompt = dominioCobrancas.descricaoPrompt(makeCtx());
    expect(prompt.toLowerCase()).toContain("nunca dispara");
  });
});
