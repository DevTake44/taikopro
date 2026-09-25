import { unstable_cache } from "next/cache";
import { getSupabaseServerClient } from "./supabaseServer";
import { fetchAllPagesConcurrent } from "./fetchPaged";
import { SALES_DATA_CACHE_TAG } from "./salesDataCache";
import type { ProfitSummaryRow } from "./profitTypes";

const PAGE_SIZE = 1000;

/**
 * profit_summary(20日締め期間×拠点×営業担当×得意先の事前集計、明細=sales_lines由来)の
 * 全件を取得する。件数が2万件超あるため、fetchMonthly.tsのv_monthly取得と同じく
 * 複数ページを同時並行で取得する。
 */
async function fetchAllProfitSummaryRowsUncached(): Promise<ProfitSummaryRow[]> {
  const supabase = getSupabaseServerClient();
  try {
    return await fetchAllPagesConcurrent<ProfitSummaryRow>(
      (from, to) =>
        supabase
          .from("profit_summary")
          .select(
            "id, period_end, branch_code, rep_code, customer_code, customer_name, revenue, cost, gross_profit, gross_margin_pct, freight_actual, final_profit, final_margin_pct, line_count, created_at, updated_at"
          )
          .order("id", { ascending: true })
          .range(from, to),
      { pageSize: PAGE_SIZE, concurrency: 10 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Supabaseからのデータ取得に失敗しました: ${message}`);
  }
}
// 「更新」ボタンが押されるまで同じ結果を返す(lib/salesDataCache.ts参照)。
export const fetchAllProfitSummaryRows = unstable_cache(
  fetchAllProfitSummaryRowsUncached,
  ["fetchAllProfitSummaryRows"],
  { tags: [SALES_DATA_CACHE_TAG], revalidate: false }
);
