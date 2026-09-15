import { NextRequest, NextResponse } from "next/server";
import { hashPassword, AUTH_COOKIE_NAME } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (password === process.env.SITE_PASSWORD) {
    const token = await hashPassword(process.env.SITE_PASSWORD ?? "");
    const res = NextResponse.json({ ok: true, redirect: "/menu" });
    res.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  }

  return NextResponse.json({ ok: false }, { status: 401 });
}
