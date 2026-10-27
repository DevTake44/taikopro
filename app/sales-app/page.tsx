import Link from "next/link";

export const dynamic = "force-dynamic";

type MenuLink = {
  href: string;
  title: string;
  description: string;
};

const SALES_APP_LINKS: MenuLink[] = [
  {
    href: "/dx/customer-performance",
    title: "顧客実績",
    description: "会社名・顧客コードから、過去の売上実績(月別・よく買う商品・直近明細)をすぐに確認します。",
  },
  {
    href: "/dx/purchase-lookup",
    title: "仕入価格検索",
    description: "品番・品名から、仕入先ごとの最新価格や仕入実績の履歴を検索します。",
  },
  {
    href: "/dx/price-alerts",
    title: "値上げ検知ダッシュボード",
    description: "仕入・売上データから値上げの兆候を検知して一覧表示します。",
  },
  {
    href: "/dx/room-reservation",
    title: "会議室予約",
    description: "東京の会議室の週間予約状況を確認し、予約・変更・削除ができます。",
  },
];

export default function SalesAppMenuPage() {
  return (
    <div className="wrap" style={{ maxWidth: 1000 }}>
      <header className="top" style={{ marginBottom: 28 }}>
        <div className="title">
          <h1>営業アプリ</h1>
          <p>営業担当が日々使うツールです。</p>
        </div>
        <Link href="/menu" className="ghost-btn-inline">
          ← メインメニュー
        </Link>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 14,
        }}
      >
        {SALES_APP_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="card"
            style={{ textDecoration: "none", color: "inherit", display: "block", padding: 20 }}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>{l.title}</h3>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-faint)", lineHeight: 1.6 }}>
              {l.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
