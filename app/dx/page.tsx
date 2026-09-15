import Link from "next/link";

export const dynamic = "force-dynamic";

type ToolLink = {
  href: string;
  title: string;
  description: string;
};

const TOOLS: ToolLink[] = [
  {
    href: "/dx/purchase-lookup",
    title: "仕入価格検索",
    description: "品番・品名から、仕入先ごとの最新価格や仕入実績の履歴を検索します。",
  },
  {
    href: "/dx/stock",
    title: "不動在庫チェック",
    description: "在庫仕入(拠点90・91)の内訳と、出荷実績との突き合わせによる不動在庫候補を確認します。",
  },
  {
    href: "/dx/price-alerts",
    title: "値上げ検知ダッシュボード",
    description: "仕入・売上データから値上げの兆候を検知して一覧表示します。",
  },
  {
    href: "/dx/internal-transfer",
    title: "社内間金額",
    description: "拠点間の社内間取引額を、確定分・未納品を合わせて拠点×場所別に集計します。",
  },
  {
    href: "/dx/upload",
    title: "データ更新",
    description: "各画面のもとになる売上・仕入・商品マスタ・仕入先マスタのCSVをアップロードして反映します。",
  },
];

export default function DxMenuPage() {
  return (
    <div className="wrap" style={{ maxWidth: 900 }}>
      <header className="top" style={{ marginBottom: 28 }}>
        <div className="title">
          <h1>社内DX</h1>
          <p>社員が日々使う実務ツールです。</p>
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
        {TOOLS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="card"
            style={{ textDecoration: "none", color: "inherit", display: "block", padding: 20 }}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>{t.title}</h3>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-faint)", lineHeight: 1.6 }}>
              {t.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
