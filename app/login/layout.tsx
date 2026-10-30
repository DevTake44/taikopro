// page.tsx自体が"use client"のため、ここ(サーバーコンポーネント)でtitleを設定する。
export const metadata = { title: "ログイン" };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
