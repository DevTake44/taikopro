import ProfitDashboardLoader from "@/components/ProfitDashboardLoader";

// Vercelのキャッシュに古い結果が残らないよう、毎回サーバーで実行する
export const dynamic = "force-dynamic";

// 受注件数が多いため、このページ自体はサーバー側でのデータ取得を行わず、
// components/ProfitDashboardLoader.tsx がブラウザ側で /api/profit-orders を
// 何回かに分けて呼び出し、全件を組み立ててから表示する(rieki-check-appから移植)。
export default function SalesProfitPage() {
  return <ProfitDashboardLoader />;
}
