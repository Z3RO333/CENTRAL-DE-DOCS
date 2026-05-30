import { NextResponse } from "next/server";
import { processarCobrancas } from "@/lib/cobrancasService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Protegido por token secreto – configure CRON_SECRET nas variáveis de ambiente
function autorizarRequisicao(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  const { searchParams } = new URL(request.url);
  return searchParams.get("secret") === secret;
}

export async function POST(request: Request) {
  if (!autorizarRequisicao(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const body = (await request.json().catch(() => ({}))) as {
      ano?: number;
      dryRun?: boolean;
    };
    const ano = typeof body.ano === "number" ? body.ano : undefined;
    const dryRun =
      body.dryRun === true || searchParams.get("dryRun") === "true";

    const resultado = await processarCobrancas(ano, { dryRun });

    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    console.error("[cobrancas/disparar] Erro:", err);
    const message =
      err instanceof Error ? err.message : "Erro ao processar cobranças.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET para validação manual (browser/curl). Use ?dryRun=true para simular sem enviar.
export async function GET(request: Request) {
  if (!autorizarRequisicao(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const anoParam = searchParams.get("ano");
    const anoNum = anoParam ? Number(anoParam) : NaN;
    const ano = Number.isFinite(anoNum) ? anoNum : undefined;
    const dryRun = searchParams.get("dryRun") === "true";

    const resultado = await processarCobrancas(ano, { dryRun });

    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    console.error("[cobrancas/disparar] Erro:", err);
    const message =
      err instanceof Error ? err.message : "Erro ao processar cobranças.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
