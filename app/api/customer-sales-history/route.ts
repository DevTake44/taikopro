import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// コールセンター対応中など、得意先の直近の取引実績をすぐに呼び出すための専用API。
// 経営レポート(/sales)のような事前集計・キャッシュは使わず、customer_code(+delivery_date)の
// インデックスを使った直接検索で都度取得する(応答速度を優先するため)。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerCode = (searchParams.get("customer_code") ?? "").trim();
  if (!customerCode) return NextResponse.json({ error: "customer_codeを指定してください。" }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("sales_lines")
    .select("delivery_date, order_no, item_code, item_name, qty, sell_price, branch_code, rep_code, project_name")
    .eq("customer_code", customerCode)
    .order("delivery_date", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rows: data ?? [] });
}
