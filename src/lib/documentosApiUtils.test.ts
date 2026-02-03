import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  normalizeIds,
  resolveLimit,
  safeParseDados,
} from "@/lib/documentosApiUtils";

describe("documentosApiUtils", () => {
  it("safeParseDados retorna objeto valido quando JSON e valido", () => {
    expect(safeParseDados('{"valor": 42}')).toEqual({ valor: 42 });
  });

  it("safeParseDados retorna null para JSON invalido", () => {
    expect(safeParseDados("{invalid")).toBeNull();
  });

  it("safeParseDados retorna null para valores nao-objeto", () => {
    expect(safeParseDados(["a"])).toBeNull();
  });

  it("safeParseDados retorna o proprio objeto quando ja eh objeto", () => {
    expect(safeParseDados({ item: "ok" })).toEqual({ item: "ok" });
  });

  it("resolveLimit respeita limites e fallback", () => {
    expect(resolveLimit(null)).toBe(DEFAULT_LIMIT);
    expect(resolveLimit("0")).toBe(1);
    expect(resolveLimit("10")).toBe(10);
    expect(resolveLimit("999999")).toBe(MAX_LIMIT);
    expect(resolveLimit("abc")).toBe(DEFAULT_LIMIT);
  });

  it("normalizeIds remove caracteres invalidos e deduplica", () => {
    expect(normalizeIds(["  abc ", "a@b", "abc", "", "a-b"])).toEqual([
      "abc",
      "ab",
      "a-b",
    ]);
  });
});
