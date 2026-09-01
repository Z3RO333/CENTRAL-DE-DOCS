import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { runAssistenteAgent } from "@/lib/assistenteAgent";
import type { AssistenteDominioId } from "@/lib/assistenteTypes";

const DOMINIOS_VALIDOS: AssistenteDominioId[] = ["documentos", "orcamentos", "cobrancas"];

export async function POST(request: Request) {
  try {
    const actor = await getActorFromRequest(request);
    if (!actor.userId) {
      throw new HttpError(400, "Assistente indisponível durante simulação de usuário.");
    }

    const body = (await request.json().catch(() => ({}))) as {
      pergunta?: string;
      currentContext?: { dominio?: string; filtros?: Record<string, unknown> };
    };

    const pergunta = typeof body.pergunta === "string" ? body.pergunta.trim() : "";
    if (!pergunta) {
      throw new HttpError(400, "Informe uma pergunta para o assistente.");
    }

    const dominioContexto = body.currentContext?.dominio;
    const currentContext =
      dominioContexto && DOMINIOS_VALIDOS.includes(dominioContexto as AssistenteDominioId)
        ? {
            dominio: dominioContexto as AssistenteDominioId,
            filtros: body.currentContext?.filtros ?? {},
          }
        : undefined;

    const payload = await runAssistenteAgent(
      { pergunta, currentContext },
      { userId: actor.userId, email: actor.email, isAdmin: actor.isAdmin },
    );

    return NextResponse.json(payload);
  } catch (err) {
    console.error("Erro no assistente virtual:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Não foi possível consultar o assistente.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
