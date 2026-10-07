import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { ProfitOrderLineDetail } from "@/lib/profitTypes";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// 売上利益(/sales/profit)の「詳細」ボタン用。1受注番号あたりの明細は数行〜数十行程度
// (v_profit_by_orderのline_countの実績値)で、profit-ordersのようなチャンク分割読み込みは
// 不要なため、クリック時にこのAPIを1回呼ぶだけで完結させる。
const MAX_ROWS = 500;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orderNo = searchParams.get("order_no")?.trim();

  if (!orderNo) {
    return NextResponse.json({ error: "order_no が指定されていません。" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_profit_lines")
    .select(
      "sales_line_id, order_line, item_code, item_name, arrange_type, delivery_date, qty, sell_price, revenue, cost, profit, cost_source"
    )
    .eq("order_no", orderNo)
    .order("order_line", { ascending: true })
    .limit(MAX_ROWS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: (data ?? []) as ProfitOrderLineDetail[] });
}
