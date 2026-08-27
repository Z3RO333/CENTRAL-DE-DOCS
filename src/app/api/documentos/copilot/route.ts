import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import {
  runDocumentoCopilotAgent,
  type DocumentoCopilotAgentMessage,
} from "@/lib/documentosCopilotAgent";
import type { DocumentoCopilotFilters } from "@/lib/documentosCopilot";

export async function POST(request: Request) {
  try {
    const actor = await getActorFromRequest(request);
    const body = (await request.json().catch(() => ({}))) as {
      messages?: { role?: string; text?: string }[];
      currentFilters?: DocumentoCopilotFilters;
    };

    const messages: DocumentoCopilotAgentMessage[] = Array.isArray(body.messages)
      ? body.messages
          .filter(
            (item): item is { role: "user" | "assistant"; text: string } =>
              (item?.role === "user" || item?.role === "assistant") &&
              typeof item?.text === "string" &&
              item.text.trim().length > 0,
          )
          .map((item) => ({ role: item.role, text: item.text.trim() }))
      : [];

    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      throw new HttpError(400, "Informe uma pergunta para o copilot.");
    }

    const payload = await runDocumentoCopilotAgent(
      {
        messages,
        currentFilters: body.currentFilters,
      },
      {
        userId: actor.userId,
        email: actor.email,
      },
    );

    return NextResponse.json(payload);
  } catch (err) {
    console.error("Erro no copilot de documentos:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error
        ? err.message
        : "Não foi possível consultar o copilot de documentos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
