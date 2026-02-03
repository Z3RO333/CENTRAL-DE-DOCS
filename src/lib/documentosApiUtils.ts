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
