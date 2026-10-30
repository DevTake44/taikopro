const encoder = new TextEncoder();

// 合言葉をそのままクッキーに保存すると危険なので、
// 合言葉から「指紋」のようなもの(ハッシュ値)を作って、それだけをクッキーに入れる。
export async function hashPassword(password: string): Promise<string> {
  const data = encoder.encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const AUTH_COOKIE_NAME = "site_auth";

// 合言葉を2種類に分け、使える範囲を変える。
// ・SITE_PASSWORD(従来通り): 全アプリ利用可("full")
// ・SITE_PASSWORD_HANBAI: 営業アプリ・社内アプリのみ利用可、経営管理は不可("restricted")
export type AuthRole = "full" | "restricted";

// クッキーの値(ハッシュ)がどちらの合言葉と一致するかを調べ、権限を返す。
// どちらとも一致しなければnull(未ログイン扱い)。
export async function resolveAuthRole(cookieValue: string | undefined | null): Promise<AuthRole | null> {
  if (!cookieValue) return null;
  if (cookieValue === (await hashPassword(process.env.SITE_PASSWORD ?? ""))) return "full";
  const restrictedPassword = process.env.SITE_PASSWORD_HANBAI;
  if (restrictedPassword && cookieValue === (await hashPassword(restrictedPassword))) return "restricted";
  return null;
}

// "restricted"権限では使えない(経営管理の)パス。
// 先頭一致で判定するが、"/sales-app"は別アプリ(営業アプリ)なので"/sales"とは
// 区別する必要がある(文字列としては"/sales"で始まってしまうため)。
const RESTRICTED_ONLY_PATH_PREFIXES = ["/management", "/sales-detail", "/purchases"];

export function isManagementOnlyPath(pathname: string): boolean {
  if (pathname === "/sales" || pathname.startsWith("/sales/")) return true;
  return RESTRICTED_ONLY_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
