import Link from "next/link";

export const dynamic = "force-dynamic";

type MenuLink = {
  href: string;
  title: string;
  description: string;
};

// 経営管理: 全社の売上・利益を見るための3画面。
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

// 営業アプリ: 営業担当が日々使うツール。
const SALES_APP_LINKS: MenuLink[] = [
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

// 社内アプリ: 経営管理・営業アプリ以外の実務ツール(経理・照合・データ更新など)。
const INTERNAL_APP_LINKS: MenuLink[] = [
  {
    href: "/dx/stock",
    title: "不動在庫チェック",
    description: "在庫仕入(拠点90・91)の内訳と、出荷実績との突き合わせによる不動在庫候補を確認します。",
  },
  {
    href: "/dx/internal-transfer",
    title: "社内間金額",
    description: "拠点間の社内間取引額を、確定分・未納品を合わせて拠点×場所別に集計します。",
  },
  {
    href: "/dx/order-supplier-summary",
    title: "受注 仕入先別発注金額",
    description: "受注出力CSVから、仕入先ごとの発注金額(受注総数量×原価)を多い順に集計します(手配区分が空白・在庫の行は対象外)。",
  },
  {
    href: "/dx/receivables-report",
    title: "売掛残高月報",
    description: "拠点別の売掛残高CSVから、当月売上・入金額・当月残高の集計と簡易仕訳を作成します。",
  },
  {
    href: "/dx/benrinet-check",
    title: "べんりネット照合",
    description: "べんりネットのCSVと自社請求データをその場で突き合わせ、差異を確認します。",
  },
  {
    href: "/dx/payable-check",
    title: "買掛月報照合",
    description: "営業所別買掛残高と買掛残高(全社)のCSVを支払先単位で突き合わせます。",
  },
  {
    href: "/dx/life-check",
    title: "ライフ照合(受注番号さがし)",
    description: "ライフの受領実績CSVの各明細が、太幸のどの受注番号に対応するかを探します。",
  },
  {
    href: "/dx/life-billing-check",
    title: "ライフ請求金額照合",
    description: "ライフの受領実績CSVと太幸の請求出力CSVの月次請求金額を突き合わせます。",
  },
  {
    href: "/dx/freight-check",
    title: "運賃照合",
    description: "運送会社の請求データと得意先への運賃請求額を突き合わせ、運賃利益を確認します。",
  },
  {
    href: "/dx/freight-summary",
    title: "運賃 売上・仕入",
    description: "品番コード99(運賃)の売上・仕入を、合計・拠点別・担当別・得意先別に確認します。",
  },
  {
    href: "/dx/upload",
    title: "データ更新",
    description: "各画面のもとになる売上・仕入・商品マスタ・仕入先マスタのCSVをアップロードして反映します。",
  },
  {
    href: "/dx/detail-check",
    title: "集計・明細 対比",
    description: "売上ダッシュボード(集計)と売上ダッシュボード明細を、拠点別・月別に突き合わせて差を確認します。",
  },
];

export default function MenuPage() {
  return (
    <div className="wrap" style={{ maxWidth: 1320 }}>
      <header className="top" style={{ marginBottom: 28 }}>
        <div className="title">
          <h1>太幸 統合版アプリ</h1>
          <p>経営管理・営業アプリ・社内アプリをまとめたメインメニューです。</p>
        </div>
      </header>

      <h2 className="blk" style={{ marginTop: 0 }}>経営管理</h2>
      <MenuGrid links={MANAGEMENT_LINKS} />

      <h2 className="blk">営業アプリ</h2>
      <MenuGrid links={SALES_APP_LINKS} />

      <h2 className="blk">社内アプリ</h2>
      <MenuGrid links={INTERNAL_APP_LINKS} />
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
        marginBottom: 28,
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
