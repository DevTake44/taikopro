export const maxDuration = 60;

import { fetchAllMonthlyRows } from "@/lib/fetchMonthly";
import { buildDashboard } from "@/lib/buildDashboard";
import { ymFromDate } from "@/lib/fiscal";
import SalesDashboardClient from "@/components/SalesDashboardClient";

// 常に最新データを取得する(キャッシュしない)
export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams?: { until?: string };
}) {
  try {
    const rows = await fetchAllMonthlyRows();

    // 「何月度まで見るか」の絞り込み機能。
    // 例えば8月分の仕入データがまだ入力途中で確定していない時、8月を除いて
    // 「7月度まで確定した状態で見たらどうだったか」を見られるようにするためのもの。
    const fullDataset = buildDashboard(rows);
    const availableMonths = fullDataset.trend_cur.filter((t) => t.sales > 0).map((t) => t.ym);

    const untilRaw = searchParams?.until;
    const selectedUntil = untilRaw && availableMonths.includes(untilRaw) ? untilRaw : null;
    const rowsForDashboard = selectedUntil
      ? rows.filter((r) => ymFromDate(r.month) <= selectedUntil)
      : rows;

    const data = selectedUntil ? buildDashboard(rowsForDashboard) : fullDataset;

    return (
      <SalesDashboardClient data={data} availableMonths={availableMonths} selectedUntil={selectedUntil} />
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラーが発生しました。";
    return (
      <div style={{ maxWidth: 640, margin: "80px auto", padding: 24, fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
          データの読み込みでエラーが発生しました
        </h1>
        <p style={{ fontSize: 14, color: "#555", lineHeight: 1.6 }}>{message}</p>
        <p style={{ fontSize: 13, color: "#888", marginTop: 16 }}>
          Vercelの環境変数(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)が正しく設定されているか、
          Supabase側でデータが正しく入っているかを確認してください。
        </p>
      </div>
    );
  }
}
