import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fiscalYearStartOf } from "@/lib/period";
import PurchaseSupplierReport from "@/components/PurchaseSupplierReport";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const metadata = { title: "仕入先別 仕入額 昨対比" };

export default async function PurchaseBySupplierPage() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_purchase_supplier_quarter_periods")
    .select("quarter_end")
    .order("quarter_end", { ascending: false });

  if (error) {
    return (
      <div style={{ maxWidth: 640, margin: "80px auto", padding: 24, fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>データの読み込みでエラーが発生しました</h1>
        <p style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.6 }}>{error.message}</p>
      </div>
    );
  }

  // quarter_end("YYYY-MM-DD")から会計年度(10月始まりの西暦年)の一覧を作る(新しい年度が先)。
  const years = Array.from(
    new Set(
      (data ?? []).map((r) => {
        const quarterEnd = r.quarter_end as string;
        const [y, m] = quarterEnd.split("-");
        return fiscalYearStartOf(`${y}${m}`);
      })
    )
  ).sort((a, b) => b - a);

  return <PurchaseSupplierReport years={years} />;
}
