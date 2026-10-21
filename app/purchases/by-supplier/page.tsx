import { getSupabaseServerClient } from "@/lib/supabaseServer";
import PurchaseSupplierReport from "@/components/PurchaseSupplierReport";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function PurchaseBySupplierPage() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_purchase_supplier_quarter")
    .select("quarter_end")
    .order("quarter_end", { ascending: false });

  if (error) {
    return (
      <div style={{ maxWidth: 640, margin: "80px auto", padding: 24, fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>データの読み込みでエラーが発生しました</h1>
        <p style={{ fontSize: 14, color: "#555", lineHeight: 1.6 }}>{error.message}</p>
      </div>
    );
  }

  // 実在する四半期末日を新しい順に一覧化する(前年同期分が無い四半期は選んでも
  // 前期側が0円になるだけなので、特に除外はしない)。
  const quarterEnds = Array.from(new Set((data ?? []).map((r) => r.quarter_end as string))).sort((a, b) =>
    a < b ? 1 : -1
  );

  return <PurchaseSupplierReport quarterEnds={quarterEnds} />;
}
