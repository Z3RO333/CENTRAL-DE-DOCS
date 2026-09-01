import type { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import type { AssistenteDominioId } from "@/lib/assistenteTypes";

export type AssistenteMensagem = {
  role: "user" | "assistant";
  text: string;
  dominio?: AssistenteDominioId;
  criado_em: string;
};

export const MAX_STORED_MESSAGES = 10;

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export async function getConversaMensagens(
  userId: string,
  supabaseAdmin: SupabaseAdmin,
): Promise<AssistenteMensagem[]> {
  const { data, error } = await supabaseAdmin
    .from("assistente_conversas")
    .select("mensagens")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data?.mensagens as AssistenteMensagem[] | null) ?? [];
}

export async function appendConversaTurno(
  userId: string,
  turno: { pergunta: AssistenteMensagem; resposta: AssistenteMensagem },
  supabaseAdmin: SupabaseAdmin,
): Promise<void> {
  const atuais = await getConversaMensagens(userId, supabaseAdmin);
  const proximas = [...atuais, turno.pergunta, turno.resposta].slice(
    -MAX_STORED_MESSAGES,
  );

  const { error } = await supabaseAdmin.from("assistente_conversas").upsert(
    {
      user_id: userId,
      mensagens: proximas,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw error;
  }
}

export async function limparConversa(
  userId: string,
  supabaseAdmin: SupabaseAdmin,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("assistente_conversas")
    .delete()
    .eq("user_id", userId);

  if (error) {
    throw error;
  }
}
