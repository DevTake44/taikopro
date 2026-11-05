import PrintUsageSummary from "@/components/PrintUsageSummary";

// このページはブラウザ内だけで完結する(サーバー/DBを使わない)ため、
// 他ページのようなSupabaseからのデータ取得は不要。
export const dynamic = "force-dynamic";
export const metadata = { title: "複合機利用集計" };

export default function PrintUsagePage() {
  return <PrintUsageSummary />;
}
