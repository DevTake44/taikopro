import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fiscalYearStartOf } from "@/lib/period";
import FreightProfitDashboard from "@/components/FreightProfitDashboard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function FreightSummaryPage() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_freight_profit_periods")
    .select("period_end")
    .order("period_end", { ascending: false });

  if (error) {
    return (
      <div style={{ maxWidth: 640, margin: "80px auto", padding: 24, fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>データの読み込みでエラーが発生しました</h1>
        <p style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.6 }}>{error.message}</p>
      </div>
    );
  }

  // period_end("YYYY-MM-DD")から会計年度(10月始まりの西暦年)の一覧を作る(新しい年度が先)。
  const years = Array.from(
    new Set(
      (data ?? []).map((r) => {
        const periodEnd = r.period_end as string;
        const [y, m] = periodEnd.split("-");
        return fiscalYearStartOf(`${y}${m}`);
      })
    )
  ).sort((a, b) => b - a);

  return <FreightProfitDashboard availableYears={years} />;
}
