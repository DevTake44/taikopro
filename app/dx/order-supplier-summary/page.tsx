import OrderSupplierSummary from "@/components/OrderSupplierSummary";

// このページはブラウザ内だけで完結する(サーバー/DBを使わない)ため、
// 他ページのようなSupabaseからのデータ取得は不要。
export const dynamic = "force-dynamic";
export const metadata = { title: "受注 仕入先別発注金額" };

export default function OrderSupplierSummaryPage() {
  return <OrderSupplierSummary />;
}
