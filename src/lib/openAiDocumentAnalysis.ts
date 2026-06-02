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
  numero_nf: string | null;
  numero_pedido: string | null;
  valor_total: number | null;
  descricao: string | null;
  itens: Array<{
    descricao: string;
    competencia: string | null;
    loja_codigo: string | null;
    valor: number | null;
  }>;
  alertas: string[];
  confianca_geral: number;
};

type AnalyzeInput = {
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
  dadosAtuais?: Record<string, unknown> | null;
};

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const ANALISE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "tipo_documento",
    "competencias",
    "lojas",
    "prestador",
    "numero_nf",
    "numero_pedido",
    "valor_total",
    "descricao",
    "itens",
    "alertas",
    "confianca_geral",
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
    numero_nf: { anyOf: [{ type: "string" }, { type: "null" }] },
    numero_pedido: { anyOf: [{ type: "string" }, { type: "null" }] },
    valor_total: { anyOf: [{ type: "number" }, { type: "null" }] },
    descricao: { anyOf: [{ type: "string" }, { type: "null" }] },
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
  },
};

function getOpenAiConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  if (!apiKey) {
    throw new Error("Configure OPENAI_API_KEY no .env.");
  }

  return { apiKey, model };
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64");
}

function resolveContentPart(input: AnalyzeInput) {
  const base64 = arrayBufferToBase64(input.bytes);

  if (input.mimeType === "application/pdf") {
    return {
      type: "input_file",
      filename: input.fileName,
      file_data: `data:application/pdf;base64,${base64}`,
    };
  }

  if (input.mimeType.startsWith("image/")) {
    return {
      type: "input_image",
      image_url: `data:${input.mimeType};base64,${base64}`,
    };
  }

  throw new Error(`Tipo de arquivo nao suportado para analise: ${input.mimeType}`);
}

function extractOutputText(payload: unknown): string {
  const response = payload as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const text = response.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("OpenAI nao retornou texto de analise.");
  }

  return text;
}

export async function analisarDocumentoComOpenAi(
  input: AnalyzeInput,
): Promise<{ model: string; resultado: DocumentoAnaliseIa }> {
  const { apiKey, model } = getOpenAiConfig();
  const filePart = resolveContentPart(input);

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "Voce analisa documentos administrativos brasileiros. Extraia apenas dados presentes ou fortemente inferiveis no arquivo. Se houver mais de uma loja, competencia ou item, liste todos separadamente. Retorne JSON no schema solicitado. Use competencias sempre como MM/AAAA. Se houver divergencia com os dados atuais, coloque em alertas.",
            },
          ],
        },
        {
          role: "user",
          content: [
            filePart,
            {
              type: "input_text",
              text: `Dados atuais do cadastro, se existirem: ${JSON.stringify(
                input.dadosAtuais ?? {},
              )}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "analise_documento",
          strict: true,
          schema: ANALISE_SCHEMA,
        },
      },
    }),
  });

  const raw = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (raw as { error?: { message?: string } } | null)?.error?.message ??
      `OpenAI retornou status ${response.status}.`;
    throw new Error(message);
  }

  return {
    model,
    resultado: JSON.parse(extractOutputText(raw)) as DocumentoAnaliseIa,
  };
}
