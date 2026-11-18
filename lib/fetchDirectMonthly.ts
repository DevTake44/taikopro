import { unstable_cache } from "next/cache";
import { getSupabaseServerClient } from "./supabaseServer";
import { fetchAllPagesConcurrent } from "./fetchPaged";
import { SALES_DATA_CACHE_TAG } from "./salesDataCache";
import { ymFromDate, fiscalYearOf, currentFiscalPeriodEndDate } from "./fiscal";
import { branchLabel } from "./branch-names";
import { repLabel } from "./rep-names";
import type { MonthlyRow } from "./types";

/**
 * 経営報告(メーカー直送のみ)用。v_direct_monthly(v_profit_linesのうち手配区分が
 * メーカー直送・手配の商品行だけを、20日締め期間×拠点×担当×得意先で集計したビュー)を
 * 経営報告がそのまま扱えるMonthlyRowに変換する。在庫出荷・運賃(99)・値引(88)・
 * 運送会社の実費は含まない。原価は仕入実績(無ければ見込み原価)。
 *
 * profit_summaryと同じく受注確定時点で未来の期間の行が先に入るため、今期末より後の
 * 期間は除外する(profitSummaryToMonthlyRows.ts参照)。在庫拠点(90・91)も除く。
 */
type DirectMonthlyRow = {
  period_end: string;
  branch_code: string;
  rep_code: string;
  customer_code: string;
  customer_name: string | null;
  revenue: number;
  cost: number;
};

const STOCK_CODES = new Set(["90", "91"]);

async function fetchDirectMonthlyRowsUncached(): Promise<MonthlyRow[]> {
  const supabase = getSupabaseServerClient();
  let raw: DirectMonthlyRow[];
  try {
    raw = await fetchAllPagesConcurrent<DirectMonthlyRow>(
      (from, to) =>
        supabase
          .from("v_direct_monthly")
          .select("period_end, branch_code, rep_code, customer_code, customer_name, revenue, cost")
          .order("period_end", { ascending: true })
          .order("branch_code", { ascending: true })
          .order("rep_code", { ascending: true })
          .order("customer_code", { ascending: true })
          .range(from, to),
      { pageSize: 1000, concurrency: 10 }
    );
  } catch (e) {
    throw new Error(`Supabaseからのデータ取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  }
  const periodEnd = currentFiscalPeriodEndDate();
  return raw
    .filter((r) => r.period_end <= periodEnd && !STOCK_CODES.has(r.branch_code))
    .map((r) => {
      const revenue = Number(r.revenue) || 0;
      const cost = Number(r.cost) || 0;
      const profit = revenue - cost;
      return {
        month: r.period_end,
        fiscal_year: fiscalYearOf(ymFromDate(r.period_end)),
        location_code: r.branch_code,
        location_name: r.branch_code ? branchLabel(r.branch_code) : null,
        staff_code: r.rep_code,
        staff_name: r.rep_code ? repLabel(r.rep_code) : null,
        customer_code: r.customer_code,
        customer_name: r.customer_name,
        sales_amount: revenue,
        purchase_amount: cost,
        profit,
        margin_pct: revenue ? Math.round((profit / revenue) * 1000) / 10 : 0,
        has_purchase: cost > 0,
      };
    });
}

export const fetchDirectMonthlyRows = unstable_cache(fetchDirectMonthlyRowsUncached, ["fetchDirectMonthlyRows"], {
  tags: [SALES_DATA_CACHE_TAG],
  revalidate: false,
});
