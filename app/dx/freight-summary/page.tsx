import { getSupabaseServerClient } from "@/lib/supabaseServer";
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
        <p style={{ fontSize: 14, color: "#555", lineHeight: 1.6 }}>{error.message}</p>
      </div>
    );
  }

  const availablePeriods = (data ?? []).map((r) => r.period_end as string);
  return <FreightProfitDashboard availablePeriods={availablePeriods} />;
}
