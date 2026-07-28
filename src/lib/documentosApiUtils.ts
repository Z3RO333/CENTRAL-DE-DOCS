export const MAX_LIMIT = 1000;
export const DEFAULT_LIMIT = 200;

export const sanitizeId = (value: string) => value.replace(/[^a-zA-Z0-9-]/g, "");

export const normalizeIds = (values: string[]) =>
  Array.from(
    new Set(values.map((value) => sanitizeId(value.trim())).filter(Boolean)),
  );

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const safeParseDados = (
  value: unknown,
): Record<string, unknown> | null => {
  if (typeof value !== "string") {
    return isPlainObject(value) ? value : null;
  }
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch (error) {
    console.error("Falha ao interpretar campo dados:", error);
    return null;
  }
};

export const resolveLimit = (raw: string | null) => {
  const limitParam = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(limitParam)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(limitParam, 1), MAX_LIMIT);
};

const DOCUMENTOS_TEXT_SEARCH_COLUMNS = [
  "dados->>empresa",
  "dados->>prestador",
  "dados->>responsavel",
  "dados->>numero_pedido",
  "dados->>numero_nf",
  "dados->>cnpj",
  "dados->>cnpj_emitente",
  "dados->>descricao",
  "dados->>observacoes",
  "dados->>tipo_laudo",
  "dados->>loja_nome",
  "dados->anexos->0->>nome",
  "arquivo_path",
  "arquivo_assinado_path",
];

const normalizeSearchTerm = (value: string) =>
  value.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();

export const buildDocumentosTextSearchOr = (term: string) => {
  const sanitized = normalizeSearchTerm(term);
  if (!sanitized) {
    return null;
  }

  const variants = new Set([sanitized]);
  const digitsOnly = sanitized.replace(/\D/g, "");
  if (digitsOnly.length >= 3) {
    variants.add(digitsOnly);
  }

  return Array.from(variants).flatMap((variant) => {
    const pattern = `%${variant}%`;
    return DOCUMENTOS_TEXT_SEARCH_COLUMNS.map(
      (column) => `${column}.ilike.${pattern}`,
    );
  });
};

export const getValorOrcamento = (
  dados: Record<string, unknown> | null,
): number | null => {
  const raw = dados?.valor;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim()) {
    const normalized = raw
      .trim()
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const formatCurrencyBRL = (value: number | null): string | null => {
  if (value === null) {
    return null;
  }
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};
