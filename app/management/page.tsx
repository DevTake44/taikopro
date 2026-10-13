import Link from "next/link";

export const dynamic = "force-dynamic";

type MenuLink = {
  href: string;
  title: string;
  description: string;
};

const MANAGEMENT_LINKS: MenuLink[] = [
  {
    href: "/sales",
    title: "経営報告・全体サマリー・月次マトリクス・目標対比",
    description: "売上・利益の全社状況を確認します。",
  },
  {
    href: "/sales-detail",
    title: "売上ダッシュボード明細",
    description: "上と同じ画面構成で、売上は明細(sales_lines)、原価は仕入・在庫出荷・運送会社の実費まで含めて集計します。",
  },
  {
    href: "/sales/profit",
    title: "売上利益",
    description: "受注番号単位の売上・原価・利益を、得意先・物件・担当などで切り替えて確認します。",
  },
];

export default function ManagementMenuPage() {
  return (
    <div className="wrap" style={{ maxWidth: 1000 }}>
      <header className="top" style={{ marginBottom: 28 }}>
        <div className="title">
          <h1>経営管理</h1>
          <p>売上・利益の全社状況を確認する画面です。</p>
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
        {MANAGEMENT_LINKS.map((l) => (
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
