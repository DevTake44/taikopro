import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;
const SELECT_COLUMNS =
  "purchase_number, purchase_line, order_no, purchase_date, staff_code, customer_code, customer_name, product_code, product_name, amount";

// v_unsold_purchasesは16,000件超あり、1回のレスポンスに全件詰め込むとVercelの
// レスポンスサイズ上限に近づくため、ブラウザ側でページ単位に分けて取得させる
// (?from=0 から呼び、hasMoreがtrueの間、次のfromで呼び直す方式)。
export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = Number(url.searchParams.get("from") ?? "0");
  const supabase = getSupabaseServerClient();

  const { data, error, count } = await supabase
    .from("v_unsold_purchases")
    .select(SELECT_COLUMNS, { count: "exact" })
    .order("purchase_number", { ascending: true })
    .order("purchase_line", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = count ?? 0;
  const nextFrom = from + PAGE_SIZE;
  return NextResponse.json({
    rows: data ?? [],
    total,
    hasMore: nextFrom < total,
    nextFrom,
  });
}
