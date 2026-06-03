export type NfseField<T> = {
  value: T;
  confidence: number; // 0-1
  source: "xml" | "ocr" | "ai" | "calculated";
};

export type NfseRisco = "baixo" | "medio" | "alto";
export type NfseStatus =
  | "aprovavel"
  | "revisar"
  | "bloquear"
  | "consultar_contabilidade";
export type RegimeTributario =
  | "simples_nacional"
  | "mei"
  | "lucro_presumido"
  | "lucro_real"
  | "pessoa_fisica"
  | "desconhecido";

export type NfseExtracted = {
  numero: NfseField<string | null>;
  serie: NfseField<string | null>;
  codigoVerificacao: NfseField<string | null>;
  dataEmissao: NfseField<string | null>;
  dataVencimento: NfseField<string | null>;
  emitente: {
    razaoSocial: NfseField<string | null>;
    cnpj: NfseField<string | null>;
    inscricaoMunicipal: NfseField<string | null>;
    cep: NfseField<string | null>;
    logradouro: NfseField<string | null>;
    numero: NfseField<string | null>;
    complemento: NfseField<string | null>;
    bairro: NfseField<string | null>;
    uf: NfseField<string | null>;
    municipio: NfseField<string | null>;
    fone: NfseField<string | null>;
    regimeTributario: NfseField<RegimeTributario>;
  };
  tomador: {
    razaoSocial: NfseField<string | null>;
    cnpj: NfseField<string | null>;
    logradouro: NfseField<string | null>;
    numero: NfseField<string | null>;
    complemento: NfseField<string | null>;
    bairro: NfseField<string | null>;
    uf: NfseField<string | null>;
    municipio: NfseField<string | null>;
  };
  servico: {
    discriminacao: NfseField<string | null>;
    itemListaServico: NfseField<string | null>;
    cfop: NfseField<string | null>;
    ncm: NfseField<string | null>;
    valorServicos: NfseField<number | null>;
    baseCalculo: NfseField<number | null>;
    aliquotaIss: NfseField<number | null>;
    valorIss: NfseField<number | null>;
    issRetido: NfseField<boolean | null>;
  };
  retencoes: {
    valorPis: NfseField<number | null>;
    valorCofins: NfseField<number | null>;
    valorCsll: NfseField<number | null>;
    valorIr: NfseField<number | null>;
    valorInss: NfseField<number | null>;
    outrasRetencoes: NfseField<number | null>;
    totalRetencoes: NfseField<number | null>;
    // ZFM-specific: foram destacados mesmo sendo operação ZFM?
    pisDestacado: NfseField<number | null>;
    cofinsDestacado: NfseField<number | null>;
  };
  valorLiquidoNfse: NfseField<number | null>;
  municipioEmissao: NfseField<string | null>;
  ufEmissao: NfseField<string | null>;
  // ── Análise fiscal ──────────────────────────────────────────────────────────
  zmfDestino: NfseField<boolean | null>; // operação destinada à Bemol/ZFM?
  alertaZmf: NfseField<string | null>;   // mensagem sobre PIS/COFINS e ZFM
  risco: NfseField<NfseRisco>;
  statusConferencia: NfseField<NfseStatus>;
  alertas: string[];
  acaoRecomendada: NfseField<string | null>;
  validacoes: string[]; // divergências matemáticas
};

function field<T>(value: T, confidence: number, source: NfseField<T>["source"]): NfseField<T> {
  return { value, confidence, source };
}

function parseVal(s: string | undefined | null): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? null : n;
}

function getXmlText(el: Element | null | undefined, ...tags: string[]): string | null {
  if (!el) return null;
  for (const tag of tags) {
    const found = el.querySelector(tag);
    if (found?.textContent?.trim()) return found.textContent.trim();
  }
  return null;
}

function detectRegimeXml(el: Element | null): RegimeTributario {
  if (!el) return "desconhecido";
  const text = el.textContent?.toLowerCase() ?? "";
  if (text.includes("mei") || text.includes("microempreendedor")) return "mei";
  if (text.includes("simples nacional") || text.includes("simples")) return "simples_nacional";
  if (text.includes("lucro real")) return "lucro_real";
  if (text.includes("lucro presumido")) return "lucro_presumido";
  const tipoPessoa = el.querySelector("TipoPessoa, CpfCnpj");
  if (tipoPessoa?.textContent?.trim().length === 11) return "pessoa_fisica";
  return "desconhecido";
}

function isZmfDestino(
  tomadorUf: string | null,
  tomadorMunicipio: string | null,
  tomadorRazao: string | null,
  prestacaoMunicipio: string | null,
): boolean {
  const fields = [tomadorUf, tomadorMunicipio, tomadorRazao, prestacaoMunicipio]
    .filter(Boolean)
    .map((s) => s!.toLowerCase());
  return fields.some(
    (f) =>
      f.includes("am") ||
      f.includes("manaus") ||
      f.includes("zona franca") ||
      f.includes("zmf") ||
      f.includes("suframa") ||
      f.includes("bemol"),
  );
}

function buildZmfAlerta(
  zmf: boolean,
  pisVal: number | null,
  cofinsVal: number | null,
): string | null {
  if (!zmf) return null;
  const hasPis = pisVal != null && pisVal > 0;
  const hasCofins = cofinsVal != null && cofinsVal > 0;
  if (hasPis || hasCofins) {
    return (
      "Possível inconsistência fiscal: esta NF possui " +
      [hasPis && "PIS", hasCofins && "COFINS"].filter(Boolean).join(" e ") +
      " destacado(s) ou retido(s), mas a operação aparenta ser destinada à Bemol/Zona Franca de Manaus. " +
      "Conforme orientação fiscal interna e Tema 1.239 do STJ, pode haver não incidência dessas contribuições. " +
      "Recomende validação com a contabilidade/fiscal antes de lançar ou pagar."
    );
  }
  return (
    "A NF não apresenta PIS/COFINS destacado. " +
    "Isso pode estar coerente com a orientação de não incidência para operações destinadas à Bemol/Zona Franca de Manaus."
  );
}

function classifyRisk(
  zmf: boolean,
  pisVal: number | null,
  cofinsVal: number | null,
  hasXml: boolean,
  hasValidacoes: boolean,
  regime: RegimeTributario,
  inssVal: number | null,
): NfseRisco {
  if (
    (zmf && (pisVal ?? 0) + (cofinsVal ?? 0) > 0) ||
    hasValidacoes ||
    (regime === "simples_nacional" && ((pisVal ?? 0) + (cofinsVal ?? 0) > 0)) ||
    (regime === "mei" && ((inssVal ?? 0) > 0))
  ) {
    return "alto";
  }
  if (!hasXml || regime === "desconhecido") return "medio";
  return "baixo";
}

function classifyStatus(risco: NfseRisco, zmfAlert: string | null): NfseStatus {
  if (risco === "alto") {
    if (zmfAlert?.includes("inconsistência")) return "bloquear";
    return "consultar_contabilidade";
  }
  if (risco === "medio") return "revisar";
  return "aprovavel";
}

export function parseNfseXml(xmlContent: string): NfseExtracted {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const parser = new (require("@xmldom/xmldom").DOMParser)() as DOMParser;
  const doc = parser.parseFromString(xmlContent, "text/xml");

  const ns = doc.documentElement;
  const nfse = ns.querySelector("Nfse, NFSe, CompNfse, nfse") ?? ns;
  const infNfse = nfse.querySelector("InfNfse, infNfse") ?? nfse;

  const prestador =
    infNfse.querySelector("PrestadorServico, Prestador") ??
    infNfse.querySelector("prestadorServico, prestador");
  const tomadorEl =
    infNfse.querySelector("TomadorServico, Tomador") ??
    infNfse.querySelector("tomadorServico, tomador");
  const servEl =
    infNfse.querySelector("Servico, DeclaracaoPrestacaoServico") ??
    infNfse.querySelector("servico");
  const valoresEl = servEl?.querySelector("Valores, valores") ?? servEl;

  const issRetidoText = getXmlText(valoresEl, "IssRetido, issRetido");
  const issRetido = issRetidoText === "1" || issRetidoText?.toLowerCase() === "true";

  const valorPis = parseVal(getXmlText(valoresEl, "ValorPis, valorPis"));
  const valorCofins = parseVal(getXmlText(valoresEl, "ValorCofins, valorCofins"));
  const valorCsll = parseVal(getXmlText(valoresEl, "ValorCsll, valorCsll"));
  const valorIr = parseVal(getXmlText(valoresEl, "ValorIr, valorIr"));
  const valorInss = parseVal(getXmlText(valoresEl, "ValorInss, valorInss"));
  const outrasRetencoes = parseVal(getXmlText(valoresEl, "OutrasRetencoes, outrasRetencoes"));
  const valorIss = parseVal(getXmlText(valoresEl, "ValorIss, valorIss"));
  const valorServicos = parseVal(getXmlText(valoresEl, "ValorServicos, valorServicos"));

  // Retenções de fonte = apenas o que SAIR do bolso do tomador (Bemol)
  const retencoesFonte =
    (valorPis ?? 0) +
    (valorCofins ?? 0) +
    (valorCsll ?? 0) +
    (valorIr ?? 0) +
    (valorInss ?? 0) +
    (outrasRetencoes ?? 0) +
    (issRetido ? (valorIss ?? 0) : 0);

  const valorLiquidoXml = parseVal(getXmlText(infNfse, "ValorLiquidoNfse, valorLiquidoNfse"));
  const valorLiquido = valorLiquidoXml ?? (valorServicos != null ? valorServicos - retencoesFonte : null);

  const validacoes: string[] = [];
  if (valorServicos != null && valorLiquidoXml != null) {
    const diff = Math.abs(valorServicos - retencoesFonte - valorLiquidoXml);
    if (diff > 0.02) {
      validacoes.push(
        `Divergência no valor líquido: ${valorServicos} - ${retencoesFonte} = ${(valorServicos - retencoesFonte).toFixed(2)}, mas XML informa ${valorLiquidoXml}`,
      );
    }
  }

  const tomadorUf = getXmlText(tomadorEl, "Uf, uf");
  const tomadorMunicipio = getXmlText(tomadorEl, "Municipio NomeMunicipio, nomeMunicipio");
  const tomadorRazao = getXmlText(tomadorEl, "RazaoSocial, razaoSocial");
  const prestacaoMunicipio = getXmlText(
    infNfse,
    "MunicipioPrestacaoServico NomeMunicipio, municipioPrestacao",
  );
  const regime = detectRegimeXml(prestador);
  const zmf = isZmfDestino(tomadorUf, tomadorMunicipio, tomadorRazao, prestacaoMunicipio);
  const alertaZmf = buildZmfAlerta(zmf, valorPis, valorCofins);
  const risco = classifyRisk(zmf, valorPis, valorCofins, true, validacoes.length > 0, regime, valorInss);
  const status = classifyStatus(risco, alertaZmf);

  const alertas: string[] = [...validacoes];
  if (alertaZmf?.includes("inconsistência")) alertas.push(alertaZmf);
  if (regime === "simples_nacional" && (valorPis ?? 0) + (valorCofins ?? 0) > 0)
    alertas.push("Prestador optante pelo Simples Nacional com PIS/COFINS retidos. Validar exceções.");
  if (regime === "mei" && (valorInss ?? 0) > 0)
    alertas.push("Prestador aparenta ser MEI com INSS retido. Revisar antes de lançar.");

  return {
    numero: field(getXmlText(infNfse, "Numero, numero"), 1, "xml"),
    serie: field(getXmlText(infNfse, "Serie, serie"), 1, "xml"),
    codigoVerificacao: field(
      getXmlText(infNfse, "CodigoVerificacao, codigoVerificacao, Chave"),
      1,
      "xml",
    ),
    dataEmissao: field(getXmlText(infNfse, "DataEmissao, dataEmissao, DataEmissaoRps"), 1, "xml"),
    dataVencimento: field(getXmlText(infNfse, "DataVencimento, dataVencimento"), 0.9, "xml"),
    emitente: {
      razaoSocial: field(getXmlText(prestador, "RazaoSocial, razaoSocial, Nome"), 1, "xml"),
      cnpj: field(getXmlText(prestador, "Cnpj, cnpj, CpfCnpj Cnpj"), 1, "xml"),
      inscricaoMunicipal: field(getXmlText(prestador, "InscricaoMunicipal, inscricaoMunicipal"), 1, "xml"),
      cep: field(getXmlText(prestador, "Cep, cep"), 1, "xml"),
      logradouro: field(getXmlText(prestador, "Endereco Logradouro, logradouro"), 1, "xml"),
      numero: field(getXmlText(prestador, "Endereco Numero, Numero, numero"), 1, "xml"),
      complemento: field(getXmlText(prestador, "Endereco Complemento, complemento"), 1, "xml"),
      bairro: field(getXmlText(prestador, "Endereco Bairro, bairro"), 1, "xml"),
      uf: field(getXmlText(prestador, "Uf, uf"), 1, "xml"),
      municipio: field(
        getXmlText(prestador, "Municipio NomeMunicipio, nomeMunicipio, Municipio"),
        1,
        "xml",
      ),
      fone: field(getXmlText(prestador, "Telefone, telefone, Fone"), 1, "xml"),
      regimeTributario: field(regime, regime !== "desconhecido" ? 0.85 : 0.4, "xml"),
    },
    tomador: {
      razaoSocial: field(getXmlText(tomadorEl, "RazaoSocial, razaoSocial, Nome"), 1, "xml"),
      cnpj: field(getXmlText(tomadorEl, "Cnpj, cnpj, CpfCnpj Cnpj"), 1, "xml"),
      logradouro: field(getXmlText(tomadorEl, "Endereco Logradouro, logradouro"), 1, "xml"),
      numero: field(getXmlText(tomadorEl, "Endereco Numero, Numero, numero"), 1, "xml"),
      complemento: field(getXmlText(tomadorEl, "Endereco Complemento, complemento"), 1, "xml"),
      bairro: field(getXmlText(tomadorEl, "Endereco Bairro, bairro"), 1, "xml"),
      uf: field(tomadorUf, 1, "xml"),
      municipio: field(tomadorMunicipio, 1, "xml"),
    },
    servico: {
      discriminacao: field(getXmlText(servEl, "Discriminacao, discriminacao"), 1, "xml"),
      itemListaServico: field(getXmlText(servEl, "ItemListaServico, itemListaServico"), 1, "xml"),
      cfop: field(getXmlText(servEl, "Cfop, cfop"), 1, "xml"),
      ncm: field(getXmlText(servEl, "CodigoNbs, codigoNbs, Ncm, ncm"), 1, "xml"),
      valorServicos: field(valorServicos, 1, "xml"),
      // Base de cálculo = valor dos serviços. Tributos (ISS/ISSQN) incidem
      // sobre a base, não a reduzem; só o valor líquido é reduzido por retenções.
      baseCalculo: field(valorServicos, 1, "calculated"),
      aliquotaIss: field(parseVal(getXmlText(valoresEl, "Aliquota, aliquota")), 1, "xml"),
      valorIss: field(valorIss, 1, "xml"),
      issRetido: field(issRetido, 1, "xml"),
    },
    retencoes: {
      valorPis: field(valorPis, 1, "xml"),
      valorCofins: field(valorCofins, 1, "xml"),
      valorCsll: field(valorCsll, 1, "xml"),
      valorIr: field(valorIr, 1, "xml"),
      valorInss: field(valorInss, 1, "xml"),
      outrasRetencoes: field(outrasRetencoes, 1, "xml"),
      totalRetencoes: field(retencoesFonte > 0 ? retencoesFonte : null, 1, "calculated"),
      pisDestacado: field(valorPis, 1, "xml"),
      cofinsDestacado: field(valorCofins, 1, "xml"),
    },
    valorLiquidoNfse: field(valorLiquido, valorLiquidoXml ? 1 : 0.9, valorLiquidoXml ? "xml" : "calculated"),
    municipioEmissao: field(prestacaoMunicipio, 1, "xml"),
    ufEmissao: field(getXmlText(infNfse, "MunicipioPrestacaoServico Uf, uf"), 1, "xml"),
    zmfDestino: field(zmf, 0.9, "ai"),
    alertaZmf: field(alertaZmf, 0.9, "ai"),
    risco: field(risco, 0.85, "calculated"),
    statusConferencia: field(status, 0.85, "calculated"),
    alertas,
    acaoRecomendada: field(
      status === "bloquear"
        ? "Bloquear lançamento e validar com fiscal/contabilidade"
        : status === "consultar_contabilidade"
          ? "Consultar contabilidade antes de lançar"
          : status === "revisar"
            ? "Revisar campos marcados antes de salvar"
            : "NF pode ser lançada normalmente",
      0.85,
      "calculated",
    ),
    validacoes,
  };
}

// ─── OpenAI schema para PDF/imagem — com análise fiscal ZFM ──────────────────

export const NFSE_ANALISE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "numero", "serie", "codigoVerificacao", "dataEmissao", "dataVencimento",
    "emitente", "tomador", "servico", "retencoes",
    "valorLiquidoNfse", "municipioEmissao", "ufEmissao",
    "zmfDestino", "alertaZmf", "risco", "statusConferencia",
    "alertas", "acaoRecomendada", "observacoes",
  ],
  properties: {
    numero: { anyOf: [{ type: "string" }, { type: "null" }] },
    serie: { anyOf: [{ type: "string" }, { type: "null" }] },
    codigoVerificacao: { anyOf: [{ type: "string" }, { type: "null" }] },
    dataEmissao: { anyOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, { type: "null" }] },
    dataVencimento: { anyOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, { type: "null" }] },
    emitente: {
      type: "object",
      additionalProperties: false,
      required: ["razaoSocial", "cnpj", "inscricaoMunicipal", "cep", "logradouro", "numero", "complemento", "bairro", "uf", "municipio", "fone", "regimeTributario"],
      properties: {
        razaoSocial: { anyOf: [{ type: "string" }, { type: "null" }] },
        cnpj: { anyOf: [{ type: "string" }, { type: "null" }] },
        inscricaoMunicipal: { anyOf: [{ type: "string" }, { type: "null" }] },
        cep: { anyOf: [{ type: "string" }, { type: "null" }] },
        logradouro: { anyOf: [{ type: "string" }, { type: "null" }] },
        numero: { anyOf: [{ type: "string" }, { type: "null" }] },
        complemento: { anyOf: [{ type: "string" }, { type: "null" }] },
        bairro: { anyOf: [{ type: "string" }, { type: "null" }] },
        uf: { anyOf: [{ type: "string" }, { type: "null" }] },
        municipio: { anyOf: [{ type: "string" }, { type: "null" }] },
        fone: { anyOf: [{ type: "string" }, { type: "null" }] },
        regimeTributario: {
          type: "string",
          enum: ["simples_nacional", "mei", "lucro_presumido", "lucro_real", "pessoa_fisica", "desconhecido"],
        },
      },
    },
    tomador: {
      type: "object",
      additionalProperties: false,
      required: ["razaoSocial", "cnpj", "logradouro", "numero", "complemento", "bairro", "uf", "municipio"],
      properties: {
        razaoSocial: { anyOf: [{ type: "string" }, { type: "null" }] },
        cnpj: { anyOf: [{ type: "string" }, { type: "null" }] },
        logradouro: { anyOf: [{ type: "string" }, { type: "null" }] },
        numero: { anyOf: [{ type: "string" }, { type: "null" }] },
        complemento: { anyOf: [{ type: "string" }, { type: "null" }] },
        bairro: { anyOf: [{ type: "string" }, { type: "null" }] },
        uf: { anyOf: [{ type: "string" }, { type: "null" }] },
        municipio: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
    servico: {
      type: "object",
      additionalProperties: false,
      required: ["discriminacao", "itemListaServico", "cfop", "ncm", "valorServicos", "baseCalculo", "aliquotaIss", "valorIss", "issRetido"],
      properties: {
        discriminacao: { anyOf: [{ type: "string" }, { type: "null" }] },
        itemListaServico: { anyOf: [{ type: "string" }, { type: "null" }] },
        cfop: { anyOf: [{ type: "string" }, { type: "null" }] },
        ncm: { anyOf: [{ type: "string" }, { type: "null" }] },
        valorServicos: { anyOf: [{ type: "number" }, { type: "null" }] },
        baseCalculo: { anyOf: [{ type: "number" }, { type: "null" }] },
        aliquotaIss: { anyOf: [{ type: "number" }, { type: "null" }] },
        valorIss: { anyOf: [{ type: "number" }, { type: "null" }] },
        issRetido: { anyOf: [{ type: "boolean" }, { type: "null" }] },
      },
    },
    retencoes: {
      type: "object",
      additionalProperties: false,
      required: ["valorPis", "valorCofins", "valorCsll", "valorIr", "valorInss", "outrasRetencoes", "pisDestacado", "cofinsDestacado"],
      properties: {
        valorPis: { anyOf: [{ type: "number" }, { type: "null" }] },
        valorCofins: { anyOf: [{ type: "number" }, { type: "null" }] },
        valorCsll: { anyOf: [{ type: "number" }, { type: "null" }] },
        valorIr: { anyOf: [{ type: "number" }, { type: "null" }] },
        valorInss: { anyOf: [{ type: "number" }, { type: "null" }] },
        outrasRetencoes: { anyOf: [{ type: "number" }, { type: "null" }] },
        pisDestacado: { anyOf: [{ type: "number" }, { type: "null" }] },
        cofinsDestacado: { anyOf: [{ type: "number" }, { type: "null" }] },
      },
    },
    valorLiquidoNfse: { anyOf: [{ type: "number" }, { type: "null" }] },
    municipioEmissao: { anyOf: [{ type: "string" }, { type: "null" }] },
    ufEmissao: { anyOf: [{ type: "string" }, { type: "null" }] },
    zmfDestino: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    alertaZmf: { anyOf: [{ type: "string" }, { type: "null" }] },
    risco: { type: "string", enum: ["baixo", "medio", "alto"] },
    statusConferencia: {
      type: "string",
      enum: ["aprovavel", "revisar", "bloquear", "consultar_contabilidade"],
    },
    alertas: { type: "array", items: { type: "string" } },
    acaoRecomendada: { anyOf: [{ type: "string" }, { type: "null" }] },
    observacoes: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
};

export const NFSE_SYSTEM_PROMPT = `Você é um Assistente Fiscal e Contábil especializado em análise de Notas Fiscais brasileiras, com foco em conferir tributos, retenções, valores e benefícios fiscais aplicáveis à Zona Franca de Manaus (ZFM). Analise o documento e retorne SOMENTE JSON válido, sem markdown, conforme o schema fornecido.

REGRAS DE EXTRAÇÃO:
- Datas: formato YYYY-MM-DD
- Valores financeiros: número decimal com ponto (ex: 1730.00)
- CNPJ: mantenha pontuação original do documento
- issRetido: true se ISS é retido pelo tomador; false se pago pelo prestador à prefeitura
- pisDestacado / cofinsDestacado: valor que aparece destacado no documento, mesmo que seja 0
- valorLiquidoNfse: valor real a pagar = valorServicos − retenções de fonte (ISS NÃO retido NÃO desconta)
- Nunca aceite o campo "valor líquido" sem recalcular: bruto − (pis+cofins+csll+ir+inss+outrasRetencoes + issRetido? iss: 0)
- Se valor líquido informado ≠ calculado, gere alerta em "alertas"

IDENTIFICAÇÃO DE REGIME TRIBUTÁRIO:
- "simples_nacional": mencionar Simples Nacional, Supersimples, LC 123
- "mei": microempreendedor individual, CCMEI, emitente MEI
- "lucro_real" / "lucro_presumido": quando explícito
- "pessoa_fisica": CPF como identificador do emitente
- "desconhecido": quando não identificável

REGRA ESPECIAL — BEMOL / ZONA FRANCA DE MANAUS (obrigatória):
A Bemol S/A possui mandado de segurança (proc. 1003277-78.2019.4.01.3200) e decisão transitada em julgado reconhecendo a NÃO INCIDÊNCIA de PIS e COFINS em operações realizadas no âmbito da Zona Franca de Manaus, com base no Tema 1.239 do STJ.

zmfDestino = true quando:
- Tomador for Bemol S/A, Bemol Farma, ou CNPJ com raiz 04.565.289
- Município do tomador for Manaus/AM ou qualquer município do Amazonas
- Prestação de serviço dentro da ZFM
- Menção a SUFRAMA, ZFM, Zona Franca, incentivo fiscal AM

Se zmfDestino = true:
- alertaZmf com PIS/COFINS: "Possível inconsistência fiscal: PIS/COFINS destacado em operação aparentemente destinada à Bemol/ZFM. Conforme Tema 1.239 do STJ e orientação fiscal interna (proc. 1003277-78.2019.4.01.3200), pode haver não incidência. Validar com fiscal/contabilidade antes de lançar."
- alertaZmf sem PIS/COFINS: "NF sem PIS/COFINS destacado, coerente com possível não incidência para operações Bemol/ZFM. Confirmar enquadramento."

CLASSIFICAÇÃO DE RISCO:
- "alto": zmfDestino + PIS/COFINS > 0 | valor líquido divergente | Simples Nacional com PIS/COFINS retido sem justificativa | INSS retido sem evidência de cessão de mão de obra
- "medio": apenas PDF/imagem | regime desconhecido | ISS com regra municipal incerta | campos ambíguos
- "baixo": XML com dados completos, retenções coerentes, regime identificado, valor líquido confere

STATUS DE CONFERÊNCIA:
- "bloquear": zmf com PIS/COFINS, valor líquido divergente relevante
- "consultar_contabilidade": Simples com retencoes federais, INSS duvidoso, MEI com retencoes
- "revisar": risco médio, campos ausentes
- "aprovavel": risco baixo, tudo confere

CASOS ESPECIAIS:
- Simples Nacional: não presumir PIS/COFINS/CSLL retidos. Gerar alerta obrigatório se houver.
- MEI: analisar retenções com cautela. Alertar se INSS retido sem justificativa.
- Pessoa física/liberal: IRRF e INSS regra própria, não aplicar PCC de PJ.
- INSS: alertar se retido sem evidência de cessão de mão de obra, empreitada ou serviço continuado no local do tomador.
- ISS: nunca tratar como regra única nacional. Depende do município e código de serviço. Se incerto, alertar.
- Campo "valor líquido" igual ao bruto com retenções: gerar alerta de campo ambíguo.
- PIS 0,65% + COFINS 3,00% + CSLL 1,00% = PCC 4,65% (retenção federal conjunta comum).
- IRRF sobre serviços profissionais/técnicos: alíquota varia (1,5% a 4,8%). Validar separadamente do PCC.

LAYOUT DE MANAUS: NFS-e de Manaus pode usar layout antigo municipal ou padrão nacional. Não presumir posição visual dos campos. Priorizar XML.

Retorne SOMENTE JSON válido sem comentários ou markdown.`;

// ─── Converter resultado da IA para NfseExtracted ────────────────────────────

type AiNfseResult = {
  numero: string | null;
  serie: string | null;
  codigoVerificacao: string | null;
  dataEmissao: string | null;
  dataVencimento: string | null;
  emitente: Record<string, unknown>;
  tomador: Record<string, unknown>;
  servico: {
    discriminacao: string | null;
    itemListaServico: string | null;
    cfop: string | null;
    ncm: string | null;
    valorServicos: number | null;
    baseCalculo: number | null;
    aliquotaIss: number | null;
    valorIss: number | null;
    issRetido: boolean | null;
  };
  retencoes: {
    valorPis: number | null;
    valorCofins: number | null;
    valorCsll: number | null;
    valorIr: number | null;
    valorInss: number | null;
    outrasRetencoes: number | null;
    pisDestacado: number | null;
    cofinsDestacado: number | null;
  };
  valorLiquidoNfse: number | null;
  municipioEmissao: string | null;
  ufEmissao: string | null;
  zmfDestino: boolean | null;
  alertaZmf: string | null;
  risco: NfseRisco;
  statusConferencia: NfseStatus;
  alertas: string[];
  acaoRecomendada: string | null;
  observacoes: string | null;
};

export function aiResultToNfseExtracted(ai: AiNfseResult, src: "ocr" | "ai"): NfseExtracted {
  const f = <T>(v: T, conf = 0.8) => field(v, conf, src);

  const r = ai.retencoes;
  const issRetido = ai.servico.issRetido ?? false;
  const retencoesFonte =
    (r.valorPis ?? 0) +
    (r.valorCofins ?? 0) +
    (r.valorCsll ?? 0) +
    (r.valorIr ?? 0) +
    (r.valorInss ?? 0) +
    (r.outrasRetencoes ?? 0) +
    (issRetido ? (ai.servico.valorIss ?? 0) : 0);

  const valorLiquido =
    ai.valorLiquidoNfse ??
    (ai.servico.valorServicos != null ? ai.servico.valorServicos - retencoesFonte : null);

  const validacoes: string[] = [];
  if (ai.servico.valorServicos != null && ai.valorLiquidoNfse != null) {
    const diff = Math.abs(ai.servico.valorServicos - retencoesFonte - ai.valorLiquidoNfse);
    if (diff > 0.02) {
      validacoes.push(
        `Valor líquido divergente: esperado ${(ai.servico.valorServicos - retencoesFonte).toFixed(2)}, informado ${ai.valorLiquidoNfse}`,
      );
    }
  }

  const alertas = [...(ai.alertas ?? []), ...validacoes];

  const em = ai.emitente as Record<string, string | null>;
  const to = ai.tomador as Record<string, string | null>;

  return {
    numero: f(ai.numero),
    serie: f(ai.serie),
    codigoVerificacao: f(ai.codigoVerificacao),
    dataEmissao: f(ai.dataEmissao),
    dataVencimento: f(ai.dataVencimento, 0.7),
    emitente: {
      razaoSocial: f(em.razaoSocial),
      cnpj: f(em.cnpj),
      inscricaoMunicipal: f(em.inscricaoMunicipal, 0.7),
      cep: f(em.cep, 0.7),
      logradouro: f(em.logradouro, 0.75),
      numero: f(em.numero, 0.75),
      complemento: f(em.complemento, 0.65),
      bairro: f(em.bairro, 0.65),
      uf: f(em.uf),
      municipio: f(em.municipio),
      fone: f(em.fone, 0.6),
      regimeTributario: f(
        (em.regimeTributario as RegimeTributario) ?? "desconhecido",
        em.regimeTributario ? 0.8 : 0.3,
      ),
    },
    tomador: {
      razaoSocial: f(to.razaoSocial),
      cnpj: f(to.cnpj),
      logradouro: f(to.logradouro, 0.75),
      numero: f(to.numero, 0.75),
      complemento: f(to.complemento, 0.65),
      bairro: f(to.bairro, 0.65),
      uf: f(to.uf),
      municipio: f(to.municipio),
    },
    servico: {
      discriminacao: f(ai.servico.discriminacao, 0.9),
      itemListaServico: f(ai.servico.itemListaServico, 0.8),
      cfop: f(ai.servico.cfop, 0.8),
      ncm: f(ai.servico.ncm, 0.8),
      valorServicos: f(ai.servico.valorServicos, 0.95),
      // Base de cálculo = valor dos serviços (tributos incidem sobre ela, não a reduzem).
      baseCalculo: field(ai.servico.valorServicos, 0.95, "calculated"),
      aliquotaIss: f(ai.servico.aliquotaIss, 0.85),
      valorIss: f(ai.servico.valorIss, 0.9),
      issRetido: f(ai.servico.issRetido, 0.8),
    },
    retencoes: {
      valorPis: f(r.valorPis, 0.85),
      valorCofins: f(r.valorCofins, 0.85),
      valorCsll: f(r.valorCsll, 0.8),
      valorIr: f(r.valorIr, 0.85),
      valorInss: f(r.valorInss, 0.8),
      outrasRetencoes: f(r.outrasRetencoes, 0.75),
      totalRetencoes: field(retencoesFonte > 0 ? retencoesFonte : null, 0.9, "calculated"),
      pisDestacado: f(r.pisDestacado, 0.85),
      cofinsDestacado: f(r.cofinsDestacado, 0.85),
    },
    valorLiquidoNfse: f(valorLiquido, ai.valorLiquidoNfse ? 0.9 : 0.8),
    municipioEmissao: f(ai.municipioEmissao),
    ufEmissao: f(ai.ufEmissao),
    zmfDestino: f(ai.zmfDestino, 0.85),
    alertaZmf: f(ai.alertaZmf, 0.9),
    risco: f(ai.risco ?? "medio", 0.8),
    statusConferencia: f(ai.statusConferencia ?? "revisar", 0.8),
    alertas,
    acaoRecomendada: f(ai.acaoRecomendada, 0.8),
    validacoes,
  };
}
