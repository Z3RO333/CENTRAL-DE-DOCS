import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { saveNfseToBtracker, type SaveNfseInput } from "@/lib/btrackerApi";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const jwt = cookieStore.get("btracker_jwt")?.value;
  if (!jwt) return NextResponse.json({ error: "Nao autenticado no BTracker." }, { status: 401 });

  try {
    const payload = (await req.json()) as SaveNfseInput;
    const result = await saveNfseToBtracker(payload, jwt);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao salvar NFS-e";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
