import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseAdminClient", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/notaFiscalNotification", () => ({ notificarNovaNotaFiscal: vi.fn() }));
vi.mock("@/lib/documentAnalysisPipeline", () => ({
  verificarSegredoWebhook: (header: string, secret: string) => header === `Bearer ${secret}`,
  processarDocumentoComIa: vi.fn(),
}));
import { notificarNovaNotaFiscal } from "@/lib/notaFiscalNotification";
import { processarDocumentoComIa } from "@/lib/documentAnalysisPipeline";
import { POST } from "./route";

function request(type = "INSERT", token = "secret") {
  return new Request("http://localhost/api/documentos/ia/processar", {
    method: "POST", headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, table: "formularios", record: { id: "nf-1" } }),
  });
}

describe("aviso de nota fiscal no webhook de recebimento", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("DOCUMENTOS_IA_WEBHOOK_SECRET", "secret");
    vi.mocked(processarDocumentoComIa).mockResolvedValue({ status: "ignorado" });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("avisa mesmo quando a análise falha", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(processarDocumentoComIa).mockRejectedValue(new Error("IA indisponível"));
    expect((await POST(request())).status).toBe(500);
    expect(notificarNovaNotaFiscal).toHaveBeenCalledWith({}, "nf-1");
  });

  it("continua a análise quando o envio falha", async () => {
    vi.mocked(notificarNovaNotaFiscal).mockResolvedValue({ status: "failed", reason: "SendGrid indisponível" });
    expect((await POST(request())).status).toBe(200);
    expect(processarDocumentoComIa).toHaveBeenCalledWith({}, "nf-1");
  });

  it("não avisa para atualizações ou chamadas não autorizadas", async () => {
    expect((await POST(request("UPDATE"))).status).toBe(200);
    expect((await POST(request("INSERT", "invalid"))).status).toBe(401);
    expect(notificarNovaNotaFiscal).not.toHaveBeenCalled();
    expect(processarDocumentoComIa).not.toHaveBeenCalled();
  });
});
