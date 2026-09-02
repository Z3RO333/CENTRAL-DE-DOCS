import { describe, it, expect, vi, beforeEach } from "vitest";
import { interpretarConsulta } from "@/lib/documentosInterpretacao";

vi.mock("@/lib/azureOpenAi", () => ({
  callAzureOpenAiChat: vi.fn(),
}));
import { callAzureOpenAiChat } from "@/lib/azureOpenAi";

const TERMOS = ["gerador", "ar condicionado", "elevador", "extintor", "subestacao"];

describe("interpretarConsulta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("extrai tipo e assunto de uma pergunta objetiva", async () => {
    vi.mocked(callAzureOpenAiChat).mockResolvedValueOnce({
      content: JSON.stringify({
        consultaSemantica: "laudo grupo gerador Matriz",
        tipo: "registro_laudos",
        assunto: "gerador",
        lojaTermo: "Matriz",
        ordenar: "relevancia",
      }),
      toolCalls: [],
    });
    const result = await interpretarConsulta(
      "qual é o laudo do gerador da Matriz?",
      TERMOS
    );
    expect(result.tipo).toBe("registro_laudos");
    expect(result.assunto).toBe("gerador");
    expect(result.lojaTermo).toBe("Matriz");
    expect(result.ordenar).toBe("relevancia");
    expect(result.consultaSemantica).toBeTruthy();
  });

  it("nao define filtro de assunto quando o termo nao esta na taxonomia", async () => {
    vi.mocked(callAzureOpenAiChat).mockResolvedValueOnce({
      content: JSON.stringify({
        consultaSemantica: "problemas com o telhado loja Norte",
        lojaTermo: "Norte",
        ordenar: "relevancia",
      }),
      toolCalls: [],
    });
    const result = await interpretarConsulta(
      "tem algum problema no telhado da loja Norte?",
      TERMOS
    );
    expect(result.assunto).toBeUndefined();
    expect(result.consultaSemantica).toBeTruthy();
  });

  it("define ordenar mais_recente para perguntas de listagem", async () => {
    vi.mocked(callAzureOpenAiChat).mockResolvedValueOnce({
      content: JSON.stringify({
        consultaSemantica: "notas fiscais marco 2026",
        tipo: "notas_fiscais",
        mes: "03",
        ano: "2026",
        ordenar: "mais_recente",
      }),
      toolCalls: [],
    });
    const result = await interpretarConsulta("me lista as notas fiscais de março", TERMOS);
    expect(result.tipo).toBe("notas_fiscais");
    expect(result.mes).toBe("03");
    expect(result.ordenar).toBe("mais_recente");
  });

  it("usa relevancia como padrao quando ordenar esta ausente na resposta do LLM", async () => {
    vi.mocked(callAzureOpenAiChat).mockResolvedValueOnce({
      content: JSON.stringify({ consultaSemantica: "alguma coisa" }),
      toolCalls: [],
    });
    const result = await interpretarConsulta("alguma coisa", TERMOS);
    expect(result.ordenar).toBe("relevancia");
  });

  it("retorna consulta original quando LLM devolve JSON invalido", async () => {
    vi.mocked(callAzureOpenAiChat).mockResolvedValueOnce({
      content: "nao e json",
      toolCalls: [],
    });
    const result = await interpretarConsulta("minha pergunta", TERMOS);
    expect(result.consultaSemantica).toBe("minha pergunta");
    expect(result.ordenar).toBe("relevancia");
  });

  it("retorna fallback quando callAzureOpenAiChat lanca erro", async () => {
    vi.mocked(callAzureOpenAiChat).mockRejectedValueOnce(new Error("rate limit"));
    const result = await interpretarConsulta("minha pergunta", TERMOS);
    expect(result.consultaSemantica).toBe("minha pergunta");
    expect(result.ordenar).toBe("relevancia");
  });
});
