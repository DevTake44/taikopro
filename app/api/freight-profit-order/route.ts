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

const SEARCH_MAX_ROWS = 50;
const LIST_MAX_ROWS = 2000;

const SELECT_COLUMNS =
  "order_no, branch_code, rep_code, customer_code, customer_name, period_end, freight_revenue, supplier_freight_cost, carrier_freight_cost, total_freight_cost, freight_profit, carriers";

// 「運賃 売上・仕入」画面の受注明細用。v_freight_profit_by_order_mv
// (受注番号単位、マテリアライズドビュー)を、
// ・order_no が指定された場合は部分一致検索(最大50件)
// ・指定されなければ、拠点/担当/得意先/月の絞り込み条件で一覧表示(最大2000件、
//   各担当にそのまま渡せるレベルの受注明細を想定。月の指定が無いと件数が
//   膨大になるため、month必須とする)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("order_no")?.trim();
  const branch = searchParams.get("branch") || null;
  const rep = searchParams.get("rep") || null;
  const customer = searchParams.get("customer")?.trim() || null;
  const month = searchParams.get("month") || null;

  const supabase = getSupabaseServerClient();

  if (q) {
    const { data, error } = await supabase
      .from("v_freight_profit_by_order_mv")
      .select(SELECT_COLUMNS)
      .ilike("order_no", `%${q}%`)
      .order("period_end", { ascending: false })
      .limit(SEARCH_MAX_ROWS);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: (data ?? []) as FreightProfitOrderRow[] });
  }

  if (!month) {
    return NextResponse.json(
      { error: "受注明細の一覧表示には月の指定が必要です(order_noでの検索は月指定なしでも可能です)。" },
      { status: 400 }
    );
  }

  let query = supabase.from("v_freight_profit_by_order_mv").select(SELECT_COLUMNS).eq("period_end", month);
  if (branch) query = query.eq("branch_code", branch);
  if (rep) query = query.eq("rep_code", rep);
  if (customer) query = query.or(`customer_code.eq.${customer},customer_name.ilike.%${customer}%`);

  const { data, error } = await query
    .order("branch_code", { ascending: true })
    .order("customer_code", { ascending: true })
    .order("order_no", { ascending: true })
    .limit(LIST_MAX_ROWS);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: (data ?? []) as FreightProfitOrderRow[], truncated: (data ?? []).length >= LIST_MAX_ROWS });
}
