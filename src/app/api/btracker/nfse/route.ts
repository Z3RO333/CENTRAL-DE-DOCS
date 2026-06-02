import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { saveNfseToBtracker, type SaveNfseInput } from "@/lib/btrackerApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const jwt = cookieStore.get("btracker_jwt")?.value;
    if (!jwt) {
      return NextResponse.json({ error: "Nao autenticado no BTracker." }, { status: 401 });
    }

    const payload = (await req.json()) as SaveNfseInput;
    const result = await saveNfseToBtracker(payload, jwt);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao salvar NFS-e";
    // Erro tratado (inclui validações do BTracker) → 422, não 502, para
    // distinguir de uma falha real de gateway/crash do processo.
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
