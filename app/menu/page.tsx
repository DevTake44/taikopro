import Link from "next/link";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, resolveAuthRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

type PanelLink = {
  href: string;
  title: string;
  description: string;
};

const PANELS: PanelLink[] = [
  {
    href: "/management",
    title: "経営管理",
    description: "売上・利益の全社状況を確認します。",
  },
  {
    href: "/sales-app",
    title: "営業アプリ",
    description: "仕入価格検索・値上げ検知・会議室予約など、営業担当が日々使うツールです。",
  },
  {
    href: "/dx",
    title: "社内アプリ",
    description: "社内間金額・各種照合・データ更新など、経理・事務が日々使う実務ツールです。",
  },
];

export default async function MenuPage() {
  const cookieStore = await cookies();
  const role = await resolveAuthRole(cookieStore.get(AUTH_COOKIE_NAME)?.value);
  // 「hanbai」合言葉(restricted)では経営管理は使えないため、カードごと出さない。
  const panels = role === "restricted" ? PANELS.filter((p) => p.href !== "/management") : PANELS;

  return (
    <div className="wrap" style={{ maxWidth: 900 }}>
      <header className="top" style={{ marginBottom: 28 }}>
        <div className="title">
          <h1>太幸 統合版アプリ</h1>
          <p>用途に合わせて、下のパネルから進んでください。</p>
        </div>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 18,
        }}
      >
        {panels.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            target="_blank"
            className="card"
            style={{ textDecoration: "none", color: "inherit", display: "block", padding: 28 }}
          >
            <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>{p.title}</h2>
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-faint)", lineHeight: 1.7 }}>
              {p.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
