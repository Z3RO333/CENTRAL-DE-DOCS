import { describe, expect, it } from "vitest";
import { buildInsightItems, buildTrendItems } from "@/lib/assistenteInsights";

type Row = { status: string; created_at: string };

describe("buildInsightItems", () => {
  it("agrupa por chave, ordena por total e calcula percentual", () => {
    const rows: Row[] = [
      { status: "pendente", created_at: "2026-01-01" },
      { status: "pendente", created_at: "2026-01-02" },
      { status: "assinado", created_at: "2026-01-03" },
    ];

    const result = buildInsightItems(
      rows,
      (row) => row.status,
      (row) => row.status,
      rows.length,
    );

    expect(result).toEqual([
      { key: "pendente", label: "pendente", total: 2, percentual: 66.7 },
      { key: "assinado", label: "assinado", total: 1, percentual: 33.3 },
    ]);
  });

  it("usa 'Não informado' quando a chave é nula/vazia", () => {
    const rows = [{ status: "", created_at: "2026-01-01" }];
    const result = buildInsightItems(
      rows,
      () => null,
      () => "ignorado",
      1,
    );
    expect(result[0].key).toBe("Não informado");
  });

  it("respeita o limite e ordena empates por label", () => {
    const rows: Row[] = [
      { status: "b", created_at: "2026-01-01" },
      { status: "a", created_at: "2026-01-01" },
      { status: "c", created_at: "2026-01-01" },
    ];
    const result = buildInsightItems(rows, (r) => r.status, (r) => r.status, 3, 2);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.key)).toEqual(["a", "b"]);
  });
});

describe("buildTrendItems", () => {
  it("retorna vazio quando não há linhas", () => {
    expect(buildTrendItems<Row>([], (r) => r.created_at)).toEqual([]);
  });

  it("agrupa por mês/ano a partir da primeira linha, preenchendo meses sem dados com zero", () => {
    const rows: Row[] = [
      { status: "x", created_at: "2026-03-15T00:00:00.000Z" },
      { status: "x", created_at: "2026-03-20T00:00:00.000Z" },
      { status: "x", created_at: "2026-01-05T00:00:00.000Z" },
    ];
    const result = buildTrendItems(rows, (r) => r.created_at, 3);
    expect(result).toHaveLength(3);
    expect(result[result.length - 1].total).toBe(2);
    expect(result.reduce((acc, item) => acc + item.total, 0)).toBe(3);
  });
});
