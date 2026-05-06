import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";

export type DocumentoAuditEventType =
  | "documento_criado"
  | "documento_editado"
  | "status_alterado"
  | "loja_alterada"
  | "prestador_alterado"
  | "assinado"
  | "baixado";

export type DocumentoAuditEvent = {
  id: string;
  documento_id: string;
  event_type: DocumentoAuditEventType | string;
  actor_id: string | null;
  actor_email: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export function isDocumentoAuditUnavailable(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as { code?: unknown; message?: unknown };
  const code = typeof maybeError.code === "string" ? maybeError.code : "";
  const message =
    typeof maybeError.message === "string"
      ? maybeError.message.toLowerCase()
      : "";

  return (
    code === "42P01" ||
    message.includes("documentos_auditoria") ||
    message.includes("could not find the table")
  );
}

export async function logDocumentoAuditEvent(input: {
  supabaseAdmin?: ReturnType<typeof createSupabaseAdminClient>;
  documentoId: string;
  eventType: DocumentoAuditEventType;
  actorId?: string | null;
  actorEmail?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const supabaseAdmin = input.supabaseAdmin ?? createSupabaseAdminClient();
  const { error } = await supabaseAdmin.from("documentos_auditoria").insert({
    documento_id: input.documentoId,
    event_type: input.eventType,
    actor_id: input.actorId ?? null,
    actor_email: input.actorEmail ?? null,
    metadata: input.metadata ?? {},
  });

  if (error) {
    if (isDocumentoAuditUnavailable(error)) {
      return;
    }
    throw error;
  }
}
