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
