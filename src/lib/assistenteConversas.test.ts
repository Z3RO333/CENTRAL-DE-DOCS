import { describe, expect, it, vi } from "vitest";
import {
  MAX_STORED_MESSAGES,
  appendConversaTurno,
  getConversaMensagens,
  limparConversa,
  type AssistenteMensagem,
} from "@/lib/assistenteConversas";

function makeFakeSupabase(initialMensagens: AssistenteMensagem[] | null) {
  const upsertCalls: unknown[] = [];
  const deleteCalls: string[] = [];

  const supabase = {
    from(table: string) {
      expect(table).toBe("assistente_conversas");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: initialMensagens ? { mensagens: initialMensagens } : null,
              error: null,
            }),
          }),
        }),
        upsert: async (payload: unknown) => {
          upsertCalls.push(payload);
          return { error: null };
        },
        delete: () => ({
          eq: async (_col: string, userId: string) => {
            deleteCalls.push(userId);
            return { error: null };
          },
        }),
      };
    },
  };

  return { supabase, upsertCalls, deleteCalls };
}

const msg = (text: string): AssistenteMensagem => ({
  role: "user",
  text,
  criado_em: "2026-01-01T00:00:00.000Z",
});

describe("getConversaMensagens", () => {
  it("devolve [] quando o usuario ainda nao tem conversa", async () => {
    const { supabase } = makeFakeSupabase(null);
    const result = await getConversaMensagens("user-1", supabase as never);
    expect(result).toEqual([]);
  });

  it("devolve as mensagens salvas", async () => {
    const { supabase } = makeFakeSupabase([msg("oi")]);
    const result = await getConversaMensagens("user-1", supabase as never);
    expect(result).toEqual([msg("oi")]);
  });
});

describe("appendConversaTurno", () => {
  it("faz upsert acrescentando pergunta e resposta ao final", async () => {
    const { supabase, upsertCalls } = makeFakeSupabase([msg("mensagem antiga")]);
    await appendConversaTurno(
      "user-1",
      { pergunta: msg("pergunta nova"), resposta: msg("resposta nova") },
      supabase as never,
    );
    expect(upsertCalls).toHaveLength(1);
    const payload = upsertCalls[0] as { user_id: string; mensagens: AssistenteMensagem[] };
    expect(payload.user_id).toBe("user-1");
    expect(payload.mensagens.map((m) => m.text)).toEqual([
      "mensagem antiga",
      "pergunta nova",
      "resposta nova",
    ]);
  });

  it("mantem no maximo MAX_STORED_MESSAGES mensagens (corta as mais antigas)", async () => {
    const antigas = Array.from({ length: MAX_STORED_MESSAGES }, (_, i) => msg(`m${i}`));
    const { supabase, upsertCalls } = makeFakeSupabase(antigas);
    await appendConversaTurno(
      "user-1",
      { pergunta: msg("nova pergunta"), resposta: msg("nova resposta") },
      supabase as never,
    );
    const payload = upsertCalls[0] as { mensagens: AssistenteMensagem[] };
    expect(payload.mensagens).toHaveLength(MAX_STORED_MESSAGES);
    expect(payload.mensagens[payload.mensagens.length - 1].text).toBe("nova resposta");
    expect(payload.mensagens[0].text).not.toBe("m0");
  });
});

describe("limparConversa", () => {
  it("apaga a linha do usuario", async () => {
    const { supabase, deleteCalls } = makeFakeSupabase([msg("oi")]);
    await limparConversa("user-1", supabase as never);
    expect(deleteCalls).toEqual(["user-1"]);
  });
});
