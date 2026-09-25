import SalesDashboardLoader from "@/components/SalesDashboardLoader";

// このページ自体はサーバー側でのデータ取得を一切行わない(SalesDashboardLoaderが
// ブラウザ側で/api/sales-dashboardを呼び出す)。これにより、メニューから戻って
// 再度開いた時にNext.jsのローディング画面(loading.tsx)が挟まらず、ブラウザ内に
// キャッシュ済みのデータがあれば即座に表示できる(売上利益・拠点別利益ページと同じ方式)。
export default function SalesPage() {
  return <SalesDashboardLoader variant="monthly" />;
}
