import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;

// v_sales_reconciliation は、拠点×月度(20日締め)単位で
// 「売上ダッシュボード(v_monthly、sales_monthly由来)」と
// 「売上ダッシュボード明細(profit_summary/v_profit_lines、sales_lines由来)」を
// あらかじめ突き合わせたビュー(件数が少ない: 2026-09時点で642行)。
// 毎回チャットでSQLを書いて確認していた「集計と明細の差」を、画面でいつでも
// 確認できるようにするためのもの。
export async function GET() {
  const supabase = getSupabaseServerClient();
  const rows: unknown[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("v_sales_reconciliation")
      .select("*")
      .order("branch_code", { ascending: true })
      .order("ym", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return NextResponse.json({ rows });
}
