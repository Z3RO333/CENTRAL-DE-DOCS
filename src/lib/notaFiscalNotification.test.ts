import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./notaFiscalNotificationService", () => ({
  NOTA_FISCAL_DESTINATARIO: "ordensmanutencao@bemol.com.br",
  enviarEmailNovaNotaFiscal: vi.fn(async () => ({ status: "sent" })),
}));
vi.mock("./documentosAudit", () => ({ logDocumentoAuditEvent: vi.fn() }));
import { enviarEmailNovaNotaFiscal } from "./notaFiscalNotificationService";
import { logDocumentoAuditEvent } from "./documentosAudit";
import { notificarNovaNotaFiscal } from "./notaFiscalNotification";

function database(tipo: string, enviado = false) {
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      contains: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ error: null, data: table === "formularios"
        ? { id: "nf-1", tipo, prestador_id: "p-1", dados: { numero_nf: "42", loja_nome: "Centro", valor: 50 } }
        : table === "prestadores" ? { nome: "Fornecedor cadastrado" }
        : enviado ? { id: "audit-1" } : null })),
    };
    return query;
  });
  return { from } as unknown as SupabaseClient;
}

beforeEach(() => { vi.clearAllMocks(); });

describe("notificarNovaNotaFiscal", () => {
  it.each(["notas_fiscais", "notas_fiscais_conservacao"])("notifica %s e registra o resultado", async (tipo) => {
    expect(await notificarNovaNotaFiscal(database(tipo), "nf-1")).toEqual({ status: "sent" });
    expect(enviarEmailNovaNotaFiscal).toHaveBeenCalledWith(expect.objectContaining({
      id: "nf-1", prestadorNome: "Fornecedor cadastrado", numeroNf: "42", valor: 50,
      conservacao: tipo === "notas_fiscais_conservacao",
    }));
    expect(logDocumentoAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      documentoId: "nf-1", metadata: expect.objectContaining({
        notification_status: "sent", notification_recipient: "ordensmanutencao@bemol.com.br",
      }),
    }));
  });

  it("não envia para outros documentos", async () => {
    expect(await notificarNovaNotaFiscal(database("registro_laudos"), "nf-1"))
      .toEqual({ status: "skipped", reason: "not_invoice" });
    expect(enviarEmailNovaNotaFiscal).not.toHaveBeenCalled();
  });

  it("não repete envio já registrado", async () => {
    expect(await notificarNovaNotaFiscal(database("notas_fiscais", true), "nf-1"))
      .toEqual({ status: "skipped", reason: "already_sent" });
    expect(enviarEmailNovaNotaFiscal).not.toHaveBeenCalled();
  });
});
