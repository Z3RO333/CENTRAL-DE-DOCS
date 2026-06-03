import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import {
  runDocumentoCopilot,
  type DocumentoCopilotFilters,
} from "@/lib/documentosCopilot";

export async function POST(request: Request) {
  try {
    const actor = await getActorFromRequest(request);
    const body = (await request.json().catch(() => ({}))) as {
      message?: string;
      currentFilters?: DocumentoCopilotFilters;
    };

    const message = typeof body.message === "string" ? body.message : "";
    if (!message.trim()) {
      throw new HttpError(400, "Informe uma pergunta para o copilot.");
    }

    const payload = await runDocumentoCopilot(
      {
        message,
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
