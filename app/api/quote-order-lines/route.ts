import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// 見積書・請求書の明細行「受注番号から一括追加」用。指定した受注番号(order_no)の
// 売上明細(sales_lines)を全行まとめて返す。1件ずつ探す「過去売上から追加」と違い、
// 同じ受注の明細をそのまま丸ごと転記したい場合に使う。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orderNo = (searchParams.get("order_no") ?? "").trim();
  if (!orderNo) return NextResponse.json({ error: "受注番号を入力してください。" }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("sales_lines")
    .select("order_line, item_code, item_name, qty, sell_price, assumed_cost, supplier_code, supplier_name, customer_name, customer_code, delivery_date")
    .eq("order_no", orderNo)
    .order("order_line", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map((r) => ({
    product_code: r.item_code as string | null,
    product_name: r.item_name as string,
    qty: (r.qty as number | null) ?? 1,
    unit_price: (r.sell_price as number | null) ?? 0,
    cost_price: r.assumed_cost as number | null,
    supplier_code: r.supplier_code as string | null,
    supplier_name: r.supplier_name as string | null,
    customer_name: r.customer_name as string | null,
    customer_code: r.customer_code as string | null,
    delivery_date: r.delivery_date as string | null,
  }));

  return NextResponse.json({ rows });
}
