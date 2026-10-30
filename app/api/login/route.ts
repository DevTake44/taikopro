import { NextRequest, NextResponse } from "next/server";
import { hashPassword, resolveAuthRole, AUTH_COOKIE_NAME } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  let matched: string | null = null;
  if (password === process.env.SITE_PASSWORD) matched = process.env.SITE_PASSWORD ?? "";
  else if (process.env.SITE_PASSWORD_HANBAI && password === process.env.SITE_PASSWORD_HANBAI) {
    matched = process.env.SITE_PASSWORD_HANBAI;
  }

  if (matched !== null) {
    const token = await hashPassword(matched);
    // 念のため、実際にどちらの権限になるかをresolveAuthRoleでも確認してから発行する。
    const role = await resolveAuthRole(token);
    if (!role) return NextResponse.json({ ok: false }, { status: 401 });

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
