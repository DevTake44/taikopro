import { getSupabaseServerClient } from "./supabaseServer";
import { fetchAllPagesConcurrent } from "./fetchPaged";
import type { MonthlyRow } from "./types";

const PAGE_SIZE = 1000; // Supabaseの1回のリクエストで安全に取れる件数

/**
 * v_monthly ビューの全行を取得する。
 * 件数が多い(9万件超)ため、複数ページを同時並行で取得する(fetchPaged.ts参照)。
 * 以前は1ページずつ順番に取得しており、約100回の往復が積み重なって画面表示が
 * 遅くなっていた。
 */
export async function fetchAllMonthlyRows(): Promise<MonthlyRow[]> {
  const supabase = getSupabaseServerClient();
  try {
    return await fetchAllPagesConcurrent<MonthlyRow>(
      (from, to) =>
        supabase
          .from("v_monthly")
          .select(
            "month, fiscal_year, location_code, location_name, staff_code, staff_name, customer_code, customer_name, sales_amount, purchase_amount, profit, margin_pct, has_purchase"
          )
          .order("sort_id", { ascending: true })
          .range(from, to),
      { pageSize: PAGE_SIZE, concurrency: 10 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Supabaseからのデータ取得に失敗しました: ${message}`);
  }
}

/**
 * v_monthlyのうち、拠点コード90・91(在庫仕入)の行だけを取得する。
 * 売上ダッシュボード明細(/sales-detail)向け。在庫仕入は得意先への売上ではなく
 * 社内倉庫向けの仕入のため、明細集計(profit_summary、sales_lines由来)には
 * 存在しない。そのため元の売上ダッシュボードと同じデータ(v_monthly)をそのまま使う。
 */
export async function fetchStockOnlyMonthlyRows(): Promise<MonthlyRow[]> {
  const supabase = getSupabaseServerClient();
  try {
    return await fetchAllPagesConcurrent<MonthlyRow>(
      (from, to) =>
        supabase
          .from("v_monthly")
          .select(
            "month, fiscal_year, location_code, location_name, staff_code, staff_name, customer_code, customer_name, sales_amount, purchase_amount, profit, margin_pct, has_purchase"
          )
          .in("location_code", ["90", "91"])
          .order("sort_id", { ascending: true })
          .range(from, to),
      { pageSize: PAGE_SIZE, concurrency: 4 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Supabaseからのデータ取得に失敗しました: ${message}`);
  }
}
