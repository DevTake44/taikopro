import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export type FreightProfitBreakdownRow = {
  code: string;
  branch_code: string | null;
  rep_code: string | null;
  customer_code: string | null;
  customer_name: string | null;
  order_count: number;
  freight_revenue: number;
  supplier_freight_cost: number;
  carrier_freight_cost: number;
  total_freight_cost: number;
  freight_profit: number;
};

const VALID_DIMS = new Set(["branch", "rep", "customer"]);

// 「運賃 売上・仕入」画面用。月(period)×表示軸(dim: 拠点/担当/得意先)を切り替えるたびに
// 呼ばれる。v_freight_profit_by_order_mv(受注番号単位、マテリアライズドビュー)を
// DB側のRPC(freight_profit_breakdown)でオンデマンドに集計するため、画面には必要な
// 粒度の結果だけが返る(全件を事前にクライアントへ送らない)。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period"); // "YYYY-MM-DD" または "all"
  const dim = searchParams.get("dim");

  if (!dim || !VALID_DIMS.has(dim)) {
    return NextResponse.json({ error: "dim は branch/rep/customer のいずれかを指定してください。" }, { status: 400 });
  }
  if (period && period !== "all" && !/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: "period の形式が不正です。" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("freight_profit_breakdown", {
    p_period_end: !period || period === "all" ? null : period,
    p_dim: dim,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: (data ?? []) as FreightProfitBreakdownRow[] });
}
