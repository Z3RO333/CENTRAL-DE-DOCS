export type DocumentoAnaliseIa = {
  tipo_documento:
    | "notas_fiscais"
    | "registro_laudos"
    | "retencao_trabalhista"
    | "contratos"
    | "orcamentos"
    | "desconhecido";
  competencias: string[];
  lojas: Array<{
    codigo: string | null;
    nome: string | null;
    confianca: number;
  }>;
  prestador: string | null;
  cnpj: string | null;
  numero_orcamento: string | null;
  numero_nf: string | null;
  numero_pedido: string | null;
  numero_contrato: string | null;
  valor_total: number | null;
  descricao: string | null;
  objeto: string | null;
  tipo_servico: string | null;
  data_assinatura: string | null;
  data_vencimento: string | null;
  data_validade: string | null;
  itens: Array<{
    descricao: string;
    competencia: string | null;
    loja_codigo: string | null;
    valor: number | null;
  }>;
  alertas: string[];
  confianca_geral: number;
  observacoes: string | null;
  recomendacoes: string[];
  equipamento_tipo: string | null;
  equipamento_identificacao: string | null;
  equipamento_numero_serie: string | null;
};

type AnalyzeInput = {
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
  dadosAtuais?: Record<string, unknown> | null;
  tipoDocumento?: string | null;
};

type AzureDocumentIntelligenceConfig = {
  endpoint: string;
  key: string;
  apiVersion: string;
};

const ANALISE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "tipo_documento",
    "competencias",
    "lojas",
    "prestador",
    "cnpj",
    "numero_orcamento",
    "numero_nf",
    "numero_pedido",
    "numero_contrato",
    "valor_total",
    "descricao",
    "objeto",
    "tipo_servico",
    "data_assinatura",
    "data_vencimento",
    "data_validade",
    "itens",
    "alertas",
    "confianca_geral",
    "observacoes",
    "recomendacoes",
    "equipamento_tipo",
    "equipamento_identificacao",
    "equipamento_numero_serie",
  ],
  properties: {
    tipo_documento: {
      type: "string",
      enum: [
        "notas_fiscais",
        "registro_laudos",
        "retencao_trabalhista",
        "contratos",
        "orcamentos",
        "desconhecido",
      ],
    },
    competencias: {
      type: "array",
      items: { type: "string", pattern: "^(0[1-9]|1[0-2])/[0-9]{4}$" },
    },
    lojas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["codigo", "nome", "confianca"],
        properties: {
          codigo: { anyOf: [{ type: "string" }, { type: "null" }] },
          nome: { anyOf: [{ type: "string" }, { type: "null" }] },
          confianca: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    prestador: { anyOf: [{ type: "string" }, { type: "null" }] },
    cnpj: { anyOf: [{ type: "string" }, { type: "null" }] },
    numero_orcamento: { anyOf: [{ type: "string" }, { type: "null" }] },
    numero_nf: { anyOf: [{ type: "string" }, { type: "null" }] },
    numero_pedido: { anyOf: [{ type: "string" }, { type: "null" }] },
    numero_contrato: { anyOf: [{ type: "string" }, { type: "null" }] },
    valor_total: { anyOf: [{ type: "number" }, { type: "null" }] },
    descricao: { anyOf: [{ type: "string" }, { type: "null" }] },
    objeto: { anyOf: [{ type: "string" }, { type: "null" }] },
    tipo_servico: { anyOf: [{ type: "string" }, { type: "null" }] },
    data_assinatura: {
      anyOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, { type: "null" }],
    },
    data_vencimento: {
      anyOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, { type: "null" }],
    },
    data_validade: {
      anyOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, { type: "null" }],
    },
    itens: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["descricao", "competencia", "loja_codigo", "valor"],
        properties: {
          descricao: { type: "string" },
          competencia: {
            anyOf: [
              { type: "string", pattern: "^(0[1-9]|1[0-2])/[0-9]{4}$" },
              { type: "null" },
            ],
          },
          loja_codigo: { anyOf: [{ type: "string" }, { type: "null" }] },
          valor: { anyOf: [{ type: "number" }, { type: "null" }] },
        },
      },
    },
    alertas: { type: "array", items: { type: "string" } },
    confianca_geral: { type: "number", minimum: 0, maximum: 1 },
    observacoes: { anyOf: [{ type: "string" }, { type: "null" }] },
    recomendacoes: { type: "array", items: { type: "string" } },
    equipamento_tipo: { anyOf: [{ type: "string" }, { type: "null" }] },
    equipamento_identificacao: { anyOf: [{ type: "string" }, { type: "null" }] },
    equipamento_numero_serie: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
};

function getAzureOpenAiConfig() {
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT?.trim();
  const apiVersion =
    process.env.AZURE_OPENAI_API_VERSION?.trim() || "2025-01-01-preview";

  if (!apiKey || !endpoint || !deployment) {
    throw new Error(
      "Configure AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT e AZURE_OPENAI_DEPLOYMENT no .env.",
    );
  }

  const url = endpoint.includes("/chat/completions")
    ? endpoint
    : `${endpoint.replace(/\/+$/, "")}/openai/deployments/${encodeURIComponent(
        deployment,
      )}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  return { apiKey, deployment, url };
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64");
}

function getAzureDocumentIntelligenceConfig(): AzureDocumentIntelligenceConfig {
  const endpoint =
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.trim() ||
    process.env.AZURE_OCR_DOCUMENT_ENDPOINT?.trim() ||
    process.env.AZURE_OCR_ENDPOINT?.trim();
  const key =
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY?.trim() ||
    process.env.AZURE_OCR_DOCUMENT_KEY?.trim() ||
    process.env.AZURE_OCR_DOCUMENT?.trim();
  const apiVersion =
    process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION?.trim() || "2024-11-30";

  if (!endpoint || !key) {
    throw new Error(
      "Configure AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT e AZURE_OCR_DOCUMENT no .env para analisar PDF por OCR.",
    );
  }

  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    key,
    apiVersion,
  };
}

function getAnalyzeUrl(config: AzureDocumentIntelligenceConfig) {
  return `${config.endpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=${encodeURIComponent(
    config.apiVersion,
  )}`;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function extrairTextoComDocumentIntelligence(input: AnalyzeInput) {
  const config = getAzureDocumentIntelligenceConfig();
  const response = await fetch(getAnalyzeUrl(config), {
    method: "POST",
    headers: {
      "Content-Type": input.mimeType,
      "Ocp-Apim-Subscription-Key": config.key,
    },
    body: Buffer.from(input.bytes),
  });

  if (response.status !== 202) {
    const raw = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(
      raw?.error?.message ??
        `Document Intelligence retornou status ${response.status}.`,
    );
  }

  const operationLocation = response.headers.get("operation-location");
  if (!operationLocation) {
    throw new Error("Document Intelligence nao retornou Operation-Location.");
  }

  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(1000);
    const resultResponse = await fetch(operationLocation, {
      headers: {
        "Ocp-Apim-Subscription-Key": config.key,
      },
    });
    const result = (await resultResponse.json().catch(() => null)) as
      | {
          status?: string;
          error?: { message?: string };
          analyzeResult?: {
            content?: string;
            pages?: Array<{
              lines?: Array<{ content?: string }>;
            }>;
          };
        }
      | null;

    if (!resultResponse.ok) {
      throw new Error(
        result?.error?.message ??
          `Document Intelligence retornou status ${resultResponse.status}.`,
      );
    }

    if (result?.status === "succeeded") {
      const content = result.analyzeResult?.content?.trim();
      if (content) {
        return content;
      }

      const lines = result.analyzeResult?.pages
        ?.flatMap((page) => page.lines ?? [])
        .map((line) => line.content)
        .filter((line): line is string => Boolean(line?.trim()))
        .join("\n")
        .trim();

      if (!lines) {
        throw new Error("OCR concluido, mas nenhum texto foi extraido.");
      }

      return lines;
    }

    if (result?.status === "failed") {
      throw new Error(result.error?.message ?? "OCR falhou.");
    }
  }

  throw new Error("OCR demorou demais para concluir.");
}

function resolveAzureContentPart(input: AnalyzeInput) {
  const base64 = arrayBufferToBase64(input.bytes);

  if (input.mimeType === "application/pdf") {
    throw new Error(
      "A configuracao atual usa Azure OpenAI Chat, que nao aceita PDF direto. Envie PNG/JPEG ou configure um OCR de PDF.",
    );
  }

  if (input.mimeType.startsWith("image/")) {
    return {
      type: "image_url",
      image_url: {
        url: `data:${input.mimeType};base64,${base64}`,
      },
    };
  }

  throw new Error(`Tipo de arquivo nao suportado para analise: ${input.mimeType}`);
}

function extractAzureOutputText(payload: unknown): string {
  const response = payload as {
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
  };

  const content = response.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Azure OpenAI nao retornou texto de analise.");
  }

  return content;
}

function parseJsonObject(text: string): DocumentoAnaliseIa {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(cleaned) as DocumentoAnaliseIa;
}

export async function analisarDocumentoComOpenAi(
  input: AnalyzeInput,
): Promise<{ provider: string; model: string; resultado: DocumentoAnaliseIa }> {
  const { apiKey, deployment, url } = getAzureOpenAiConfig();
  const textoExtraido =
    input.mimeType === "application/pdf"
      ? await extrairTextoComDocumentIntelligence(input)
      : null;
  const filePart = textoExtraido ? null : resolveAzureContentPart(input);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content:
            "Voce analisa documentos administrativos brasileiros, incluindo orcamentos, propostas comerciais, laudos tecnicos, checklists de manutencao, notas fiscais e contratos. Extraia apenas dados presentes ou fortemente inferiveis no arquivo. Se houver mais de uma loja, competencia ou item, liste todos separadamente. Retorne somente JSON valido, sem markdown. Use competencias sempre como MM/AAAA. Se houver divergencia com os dados atuais, coloque em alertas. Para 'observacoes': extraia o texto literal da secao de observacoes ou comentarios finais do documento. Para 'recomendacoes': extraia como lista de acoes especificas recomendadas ou itens que precisam de atencao; se nao houver, retorne array vazio. IMPORTANTE — Para documentos do tipo 'orcamentos': (1) Classifique tipo_documento como 'orcamentos'. (2) Em 'prestador', extraia a razao social ou nome da empresa que EMITIU o orcamento, nunca o cliente destinatario. (3) Em 'cnpj', extraia o CNPJ dessa empresa emissora. (4) Em 'numero_orcamento', extraia o numero da proposta, cotacao ou orcamento. (5) Em 'valor_total', extraia o total final proposto em reais. (6) Em 'data_validade', extraia a data final de validade no formato AAAA-MM-DD; quando o documento informar apenas uma quantidade de dias, calcule a partir da data de emissao se ela estiver presente. (7) Em 'descricao', resuma objetivamente o servico ou produto oferecido. (8) Nao avalie se o preco esta bom e nao recomende aprovacao ou rejeicao. IMPORTANTE — Para documentos do tipo 'contratos': (1) Classifique tipo_documento como 'contratos', nao como nota fiscal ou laudo. (2) Em 'numero_contrato', extraia o numero ou codigo do contrato. (3) Em 'objeto', extraia a descricao completa do servico contratado. (4) Em 'data_assinatura', extraia a data de assinatura no formato AAAA-MM-DD. (5) Em 'data_vencimento', extraia a data de termino de vigencia; se houver renovacao automatica sem data fixa, deixe null e mencione em alertas. (6) Em 'tipo_servico', classifique o servico numa categoria curta. (7) Em 'prestador', coloque o nome da empresa contratada. (8) Em 'valor_total', extraia o valor total do contrato. (9) Em 'numero_nf' e 'numero_pedido', retorne null para contratos. IMPORTANTE — Para documentos do tipo 'registro_laudos' ou 'notas_fiscais': (1) Em 'equipamento_tipo', extraia o tipo do equipamento mencionado no documento (ex.: Gerador, Ar Condicionado, Elevador), em texto livre, só quando explicitamente identificável; senao retorne null. (2) Em 'equipamento_identificacao', extraia a identificacao ou apelido do equipamento citado (ex.: \"Gerador 01\", \"Unidade 2\"), quando houver; senao null. (3) Em 'equipamento_numero_serie', extraia o numero de serie ou patrimonio do equipamento, quando citado; senao null. (4) Para qualquer outro tipo de documento, sempre retorne null nos tres campos — nao tente adivinhar.",
        },
        {
          role: "user",
          content: textoExtraido
            ? `TIPO DO DOCUMENTO NO SISTEMA: ${input.tipoDocumento ?? "desconhecido"}\n\nTexto extraido por OCR do arquivo ${input.fileName}:\n\n${textoExtraido.slice(
                0,
                45000,
              )}\n\nDados atuais do cadastro, se existirem: ${JSON.stringify(
                input.dadosAtuais ?? {},
              )}\n\nSchema esperado: ${JSON.stringify(ANALISE_SCHEMA)}`
            : [
                filePart,
                {
                  type: "text",
                  text: `TIPO DO DOCUMENTO NO SISTEMA: ${input.tipoDocumento ?? "desconhecido"}\n\nDados atuais do cadastro, se existirem: ${JSON.stringify(
                    input.dadosAtuais ?? {},
                  )}\n\nSchema esperado: ${JSON.stringify(ANALISE_SCHEMA)}`,
                },
              ],
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 4000,
    }),
  });

  const raw = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (raw as { error?: { message?: string } } | null)?.error?.message ??
      `Azure OpenAI retornou status ${response.status}.`;
    throw new Error(message);
  }

  return {
    provider: "azure-openai",
    model: deployment,
    resultado: parseJsonObject(extractAzureOutputText(raw)),
  };
}
