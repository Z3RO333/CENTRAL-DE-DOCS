import type { SupabaseClient } from "@supabase/supabase-js";
import { safeParseDados } from "@/lib/documentosApiUtils";
import { logDocumentoAuditEvent } from "@/lib/documentosAudit";
import {
  enviarEmailNovaNotaFiscal,
  NOTA_FISCAL_DESTINATARIO,
  type NotaFiscalNotificationResult,
} from "@/lib/notaFiscalNotificationService";

const EVENT_TYPE = "nota_fiscal_notificacao";

export async function notificarNovaNotaFiscal(
  supabaseAdmin: SupabaseClient,
  documentoId: string,
): Promise<NotaFiscalNotificationResult> {
  try {
    const { data: documento, error } = await supabaseAdmin.from("formularios")
      .select("id,tipo,dados,user_id,prestador_id").eq("id", documentoId).maybeSingle();
    if (error) throw error;
    if (!documento || !["notas_fiscais", "notas_fiscais_conservacao"].includes(documento.tipo)) {
      return { status: "skipped", reason: "not_invoice" };
    }

    // O webhook pode ser entregue novamente; não repetir avisos já enviados.
    const { data: enviado, error: auditError } = await supabaseAdmin.from("documentos_auditoria")
      .select("id").eq("documento_id", documentoId).eq("event_type", EVENT_TYPE)
      .contains("metadata", { notification_status: "sent" }).limit(1).maybeSingle();
    if (auditError) throw auditError;
    if (enviado) return { status: "skipped", reason: "already_sent" };

    const dados = safeParseDados(documento.dados) ?? {};
    const stringValue = (value: unknown) => typeof value === "string" ? value : null;
    let prestadorNome = stringValue(dados.prestador);
    if (!prestadorNome && documento.prestador_id) {
      const { data: prestador, error: prestadorError } = await supabaseAdmin.from("prestadores")
        .select("nome").eq("id", documento.prestador_id).maybeSingle();
      if (prestadorError) throw prestadorError;
      prestadorNome = prestador?.nome ?? null;
    }
    const valor = dados.valor ?? dados.valor_total;
    const notification = await enviarEmailNovaNotaFiscal({
      id: documentoId,
      conservacao: documento.tipo === "notas_fiscais_conservacao",
      prestadorNome,
      lojaNome: stringValue(dados.loja_nome),
      numeroNf: stringValue(dados.numero_nf),
      numeroPedido: stringValue(dados.numero_pedido),
      competencia: stringValue(dados.competencia),
      valor: typeof valor === "number" || typeof valor === "string" ? valor : null,
    });
    await logDocumentoAuditEvent({
      supabaseAdmin,
      documentoId,
      eventType: EVENT_TYPE,
      metadata: {
        notification: "email_nova_nota_fiscal",
        notification_recipient: NOTA_FISCAL_DESTINATARIO,
        notification_status: notification.status,
        ...("reason" in notification ? { notification_reason: notification.reason } : {}),
      },
    });
    return notification;
  } catch (error) {
    // Falhas no aviso não devem impedir o cadastro nem a análise do documento.
    console.error("Falha ao notificar nova nota fiscal:", error);
    return { status: "failed", reason: error instanceof Error ? error.message : "Falha ao preparar aviso" };
  }
}
