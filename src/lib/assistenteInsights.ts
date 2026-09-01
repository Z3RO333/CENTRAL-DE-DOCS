import type { AssistenteInsightItem, AssistenteTrendItem } from "@/lib/assistenteTypes";

const getInsightLabel = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return "Não informado";
  }
  const trimmed = value.trim();
  return trimmed || "Não informado";
};

export function buildInsightItems<T>(
  rows: T[],
  getKey: (row: T) => string | null | undefined,
  getLabel: (row: T) => string,
  totalBase: number,
  limit = 5,
): AssistenteInsightItem[] {
  const grouped = new Map<string, { key: string; label: string; total: number }>();

  rows.forEach((row) => {
    const key = getInsightLabel(getKey(row));
    const current = grouped.get(key);
    if (current) {
      current.total += 1;
      return;
    }
    grouped.set(key, { key, label: getLabel(row), total: 1 });
  });

  return Array.from(grouped.values())
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((item) => ({
      key: item.key,
      label: item.label,
      total: item.total,
      percentual:
        totalBase > 0 ? Number(((item.total / totalBase) * 100).toFixed(1)) : 0,
    }));
}

export function buildTrendItems<T>(
  rows: T[],
  getDate: (row: T) => string,
  limit = 6,
): AssistenteTrendItem[] {
  if (rows.length === 0) {
    return [];
  }

  const grouped = new Map<string, number>();
  rows.forEach((row) => {
    const date = new Date(getDate(row));
    if (Number.isNaN(date.getTime())) {
      return;
    }
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  });

  const baseDate = new Date(getDate(rows[0]));
  if (Number.isNaN(baseDate.getTime())) {
    return [];
  }

  const points: { key: string; label: string }[] = [];
  const cursor = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  for (let index = 0; index < limit; index += 1) {
    const monthDate = new Date(
      cursor.getFullYear(),
      cursor.getMonth() - (limit - 1 - index),
      1,
    );
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
    points.push({
      key,
      label: monthDate
        .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
        .replace(".", ""),
    });
  }

  return points.map((point) => ({ ...point, total: grouped.get(point.key) ?? 0 }));
}
