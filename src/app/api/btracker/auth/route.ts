import { NextResponse } from "next/server";
import { exchangeMicrosoftForBtrackerJwt } from "@/lib/btrackerApi";

export async function POST(req: Request) {
  try {
    const { idToken, accessToken, name, email } = (await req.json()) as {
      idToken: string;
      accessToken: string;
      name: string;
      email: string;
    };

    if (!idToken || !accessToken || !email) {
      return NextResponse.json({ error: "idToken, accessToken e email sao obrigatorios." }, { status: 400 });
    }

    const tokens = await exchangeMicrosoftForBtrackerJwt({ idToken, accessToken, name, email });

    const res = NextResponse.json({ ok: true });
    // Store access token in httpOnly cookie (~23h, matching BTracker token expiry)
    res.cookies.set("btracker_jwt", tokens.access, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 82800, // 23h
      path: "/",
    });
    res.cookies.set("btracker_refresh", tokens.refresh, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 3600, // 7 days
      path: "/",
    });

    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("btracker_jwt");
  res.cookies.delete("btracker_refresh");
  return res;
}

export async function GET(req: Request) {
  const jwt = req.headers.get("cookie")
    ?.split(";")
    .find((c) => c.trim().startsWith("btracker_jwt="))
    ?.split("=")[1]?.trim();

  return NextResponse.json({ connected: Boolean(jwt) });
}
