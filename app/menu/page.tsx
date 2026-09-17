import Link from "next/link";

export const dynamic = "force-dynamic";

type MenuLink = {
  href: string;
  title: string;
  description: string;
};

const SALES_LINKS: MenuLink[] = [
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
  {
    href: "/sales/profit-summary",
    title: "拠点・営業・得意先 利益",
    description: "運賃実費まで引いた最終利益・最終粗利率を、拠点別・営業担当別・得意先別に確認します。",
  },
];

const DX_LINKS: MenuLink[] = [
  {
    href: "/dx",
    title: "社内DX ツール一覧",
    description: "仕入価格検索・不動在庫チェックなど、社員が日々使う実務ツールです。",
  },
];

export default function MenuPage() {
  return (
    <div className="wrap" style={{ maxWidth: 900 }}>
      <header className="top" style={{ marginBottom: 28 }}>
        <div className="title">
          <h1>太幸 統合版アプリ</h1>
          <p>売上管理・社内DXをまとめたメインメニューです。</p>
        </div>
      </header>

      <h2 className="blk" style={{ marginTop: 0 }}>売上管理</h2>
      <MenuGrid links={SALES_LINKS} />

      <h2 className="blk">社内DX(社員が日々使う実務ツール)</h2>
      <MenuGrid links={DX_LINKS} />
    </div>
  );
}

function MenuGrid({ links }: { links: MenuLink[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 14,
        marginBottom: 8,
      }}
    >
      {links.map((l) => (
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
  );
}
