import { NextResponse } from "next/server";

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("btracker_jwt");
  res.cookies.delete("btracker_refresh");
  return res;
}

export async function GET(req: Request) {
  const jwt = req.headers
    .get("cookie")
    ?.split(";")
    .find((c) => c.trim().startsWith("btracker_jwt="))
    ?.split("=")[1]
    ?.trim();

  return NextResponse.json({ connected: Boolean(jwt) });
}
