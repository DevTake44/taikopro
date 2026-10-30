import "./globals.css";

// タブが増えても何を開いているか区別できるよう、各ページでtitleを設定すると
// 「{ページ名} - 太幸 統合版アプリ」という形でタブに表示される(未設定のページは
// このdefaultのまま)。
export const metadata = {
  title: { default: "太幸 統合版アプリ", template: "%s - 太幸 統合版アプリ" },
  description: "売上管理・社内DX 統合アプリ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
