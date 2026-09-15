import "./globals.css";

export const metadata = {
  title: "太幸 統合版アプリ",
  description: "売上管理・社内DX 統合アプリ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
