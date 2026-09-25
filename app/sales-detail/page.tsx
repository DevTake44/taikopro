import SalesDashboardLoader from "@/components/SalesDashboardLoader";

// 売上ダッシュボード明細: 売上ダッシュボード(/sales)と全く同じ画面構成(経営レポート・
// 月別マトリクス・在庫)を、明細データ(profit_summary、sales_lines由来)で組み立てる。
// このページ自体はサーバー側でのデータ取得を一切行わない(app/sales/page.tsxと同じ
// 理由。SalesDashboardLoaderがブラウザ側で/api/sales-dashboard-detailを呼び出す)。
export default function SalesDetailPage() {
  return <SalesDashboardLoader variant="detail" />;
}
