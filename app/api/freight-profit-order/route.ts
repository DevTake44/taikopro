import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export type FreightProfitOrderRow = {
  order_no: string;
  branch_code: string | null;
  rep_code: string | null;
  customer_code: string | null;
  customer_name: string | null;
  period_end: string | null;
  freight_revenue: number;
  supplier_freight_cost: number;
  carrier_freight_cost: number;
  total_freight_cost: number;
  freight_profit: number;
  carriers: string | null;
};

const MAX_ROWS = 50;

// 「運賃 売上・仕入」画面の受注番号検索用。v_freight_profit_by_order_mv
// (受注番号単位、マテリアライズドビュー)を部分一致で検索する。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("order_no")?.trim();
  if (!q) return NextResponse.json({ error: "order_no が指定されていません。" }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_freight_profit_by_order_mv")
    .select(
      "order_no, branch_code, rep_code, customer_code, customer_name, period_end, freight_revenue, supplier_freight_cost, carrier_freight_cost, total_freight_cost, freight_profit, carriers"
    )
    .ilike("order_no", `%${q}%`)
    .order("period_end", { ascending: false })
    .limit(MAX_ROWS);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: (data ?? []) as FreightProfitOrderRow[] });
}
