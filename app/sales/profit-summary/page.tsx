import ProfitSummary from "@/components/ProfitSummary";

// Vercelのキャッシュに古い結果が残らないよう、毎回サーバーで実行する
export const dynamic = "force-dynamic";
export const revalidate = 0;

// profit_summaryは件数が増え続けるため、このページ自体はサーバー側でのデータ取得を
// 行わず、ProfitSummaryコンポーネントがブラウザ側で/api/profit-summaryを
// 何回かに分けて呼び出し、全件を組み立ててから表示する(rieki-check-appから移植)。
export default function ProfitSummaryPage() {
  return <ProfitSummary />;
}
