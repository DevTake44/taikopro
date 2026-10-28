import { NextRequest, NextResponse } from "next/server";
import { hashPassword, AUTH_COOKIE_NAME } from "./lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/login") || pathname.startsWith("/api/login")) {
    return NextResponse.next();
  }

  // 社内の共有フォルダからCSVを自動取込するための窓口。ログイン画面を経由しない
  // 定期実行スクリプトから呼ばれるため、ここでは合言葉クッキーのチェックを素通りさせ、
  // 各エンドポイント自身がヘッダーのトークンで個別に認証する(全体を素通りにはしない)。
  if (pathname.startsWith("/api/scheduled-import/")) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const expected = await hashPassword(process.env.SITE_PASSWORD ?? "");
  if (cookie && cookie === expected) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
