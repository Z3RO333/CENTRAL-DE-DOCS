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
    throw error;
  }
}
