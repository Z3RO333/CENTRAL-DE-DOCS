import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { searchOpenNfsesByPrestador } from "@/lib/btrackerApi";

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const jwt = cookieStore.get("btracker_jwt")?.value;
  if (!jwt) return NextResponse.json({ error: "Nao autenticado no BTracker." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const cnpj = searchParams.get("cnpj");
  if (!cnpj) return NextResponse.json({ error: "cnpj obrigatorio." }, { status: 400 });

  try {
    const nfses = await searchOpenNfsesByPrestador(cnpj, jwt);
    return NextResponse.json({ results: nfses });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao buscar pedidos";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
