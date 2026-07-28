import { describe, expect, it } from "vitest";
import { detectDocumentFile } from "@/lib/fileValidation";

describe("detectDocumentFile", () => {
  it("detecta PDF pela assinatura binaria", () => {
    expect(detectDocumentFile(new TextEncoder().encode("%PDF-1.7"))).toEqual({
      mime: "application/pdf",
      extension: "pdf",
    });
  });

  it("detecta PNG pela assinatura binaria", () => {
    expect(
      detectDocumentFile(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toEqual({ mime: "image/png", extension: "png" });
  });

  it("detecta JPEG pela assinatura binaria", () => {
    expect(detectDocumentFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      mime: "image/jpeg",
      extension: "jpg",
    });
  });

  it("rejeita conteudo que apenas finge ser um arquivo aceito", () => {
    expect(detectDocumentFile(new TextEncoder().encode("arquivo.exe"))).toBeNull();
  });
});

