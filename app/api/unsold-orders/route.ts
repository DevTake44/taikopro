import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// v_unsold_orders は「受注金額合計 - sales_lines該当受注番号の売上済み合計 > 0」の受注のみを持つビュー。
export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_unsold_orders")
    .select("*")
    .order("rep_code", { ascending: true })
    .order("customer_code", { ascending: true })
    .order("due_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [] });
}
