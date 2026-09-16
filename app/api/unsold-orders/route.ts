import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { currentFiscalPeriodEndDate } from "@/lib/fiscal";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;

// v_unsold_orders は「受注金額合計 - sales_lines該当受注番号の売上済み合計 > 0」の受注のみを持つビュー。
// 今期(9/20締め)の計上漏れを防ぐための画面のため、納期日は今期末までに固定する
// (来期分の納期はこの時点でまだ動きようがなくノイズになるため表示しない)。
// PostgREST(Supabase)は1回のクエリで最大1000件しか返さないため、全件取得できるまでページングする。
export async function GET() {
  const periodEnd = currentFiscalPeriodEndDate();
  const supabase = getSupabaseServerClient();
  const rows: unknown[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("v_unsold_orders")
      .select("*")
      .lte("due_date", periodEnd)
      .order("rep_code", { ascending: true })
      .order("customer_code", { ascending: true })
      .order("due_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return NextResponse.json({ rows, periodEnd });
}
