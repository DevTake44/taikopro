import SalesDashboardLoader from "@/components/SalesDashboardLoader";

export const metadata = { title: "経営報告(メーカー直送のみ)" };

// 経営報告と同じ画面構成で、手配区分がメーカー直送・手配の商品行だけを集計する
// (在庫出荷・運賃・値引・運送会社の実費は含まない)。データ取得はブラウザ側から
// /api/sales-dashboard-direct を呼ぶ(app/sales/page.tsx と同じ方式)。
export default function SalesDirectPage() {
  return <SalesDashboardLoader variant="direct" />;
}
