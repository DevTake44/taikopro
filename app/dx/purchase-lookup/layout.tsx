// page.tsx自体が"use client"のため、ここ(サーバーコンポーネント)でtitleを設定する。
export const metadata = { title: "仕入価格検索" };

export default function PurchaseLookupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
