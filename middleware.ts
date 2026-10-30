import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isManagementOnlyPath, resolveAuthRole } from "./lib/auth";

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
  const role = await resolveAuthRole(cookie);
  if (!role) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // 「hanbai」合言葉(restricted)は営業アプリ・社内アプリのみ利用可。経営管理関連の
  // ページに来た場合はメインメニューに戻す。
  if (role === "restricted" && isManagementOnlyPath(pathname)) {
    return NextResponse.redirect(new URL("/menu", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
