import { getSupabaseServerClient } from "./supabaseServer";
import type { MonthlyRow } from "./types";

const PAGE_SIZE = 1000; // Supabaseの1回のリクエストで安全に取れる件数

/**
 * v_monthly ビューの全行を取得する。
 * 件数が多い（数万行）ため、1000件ずつに分けて何度も取得し、最後に1つにまとめる。
 */
export async function fetchAllMonthlyRows(): Promise<MonthlyRow[]> {
  const supabase = getSupabaseServerClient();
  const rows: MonthlyRow[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("v_monthly")
      .select(
        "month, fiscal_year, location_code, location_name, staff_code, staff_name, customer_code, customer_name, sales_amount, purchase_amount, profit, margin_pct, has_purchase"
      )
      .order("sort_id", { ascending: true })
      .range(from, to);
    if (error) {
      throw new Error(`Supabaseからのデータ取得に失敗しました: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as MonthlyRow[]));
    if (data.length < PAGE_SIZE) break; // これが最後のページ
    from += PAGE_SIZE;
  }
  return rows;
}
