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
    href: "/dx/upload",
    title: "データ更新",
    description: "各画面のもとになる売上・仕入・商品マスタ・仕入先マスタのCSVをアップロードして反映します。",
  },
  {
    href: "/dx/room-reservation",
    title: "会議室予約",
    description: "東京の会議室の週間予約状況を確認し、予約・変更・削除ができます。",
  },
  {
    href: "/dx/unsold-orders",
    title: "未売上受注チェック",
    description: "受注はあるが売上未計上の案件を、担当者・得意先・締め日ごとに一覧化します。",
  },
  {
    href: "/dx/detail-check",
    title: "集計・明細 対比",
    description: "売上ダッシュボード(集計)と売上ダッシュボード明細を、拠点別・月別に突き合わせて差を確認します。",
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
