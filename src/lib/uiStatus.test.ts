import { describe, expect, it } from "vitest";
import { getStatusPresentation } from "@/lib/uiStatus";

describe("getStatusPresentation", () => {
  it("retorna label e tom corretos para recebido", () => {
    const presentation = getStatusPresentation("recebido");
    expect(presentation.label).toBe("Aguardando análise");
    expect(presentation.tone).toBe("neutral");
  });

  it("retorna label e tom corretos para necessita_revisao", () => {
    const presentation = getStatusPresentation("necessita_revisao");
    expect(presentation.label).toBe("Necessita revisão");
    expect(presentation.tone).toBe("warning");
  });

  it("retorna label e tom corretos para duplicado", () => {
    const presentation = getStatusPresentation("duplicado");
    expect(presentation.label).toBe("Duplicado");
    expect(presentation.tone).toBe("neutral");
  });

  it("continua funcionando para valores ja existentes (sem regressao)", () => {
    expect(getStatusPresentation("erro").label).toBe("Erro");
    expect(getStatusPresentation("erro").tone).toBe("danger");
    expect(getStatusPresentation("concluida").label).toBe("Concluída");
    expect(getStatusPresentation("concluida").tone).toBe("success");
    expect(getStatusPresentation("em_analise").label).toBe("Em análise");
    expect(getStatusPresentation("em_analise").tone).toBe("info");
  });

  it("usa fallback humanizado para valor desconhecido", () => {
    const presentation = getStatusPresentation("valor_nao_mapeado");
    expect(presentation.label).toBe("Valor Nao Mapeado");
    expect(presentation.tone).toBe("neutral");
  });
});
