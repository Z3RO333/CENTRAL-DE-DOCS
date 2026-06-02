import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { jwt } = (await req.json()) as { jwt: string };

    if (!jwt || !jwt.startsWith("eyJ") || jwt.split(".").length !== 3) {
      return NextResponse.json({ error: "Token JWT inválido." }, { status: 400 });
    }

    // Decode payload to validate expiry
    try {
      const payload = JSON.parse(
        Buffer.from(jwt.split(".")[1], "base64").toString("utf-8"),
      ) as { exp?: number };
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        return NextResponse.json({ error: "Token expirado. Gere um novo no BTracker." }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Não foi possível ler o token." }, { status: 400 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set("btracker_jwt", jwt, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 82800, // 23h
      path: "/",
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Erro ao processar token." }, { status: 500 });
  }
}
