import { ymFromDate, fiscalYearOf, currentFiscalPeriodEndDate } from "./fiscal";
import { branchLabel } from "./branch-names";
import { repLabel } from "./rep-names";
import type { ProfitSummaryRow } from "./profitTypes";
import type { MonthlyRow } from "./types";

/**
 * profit_summary(明細=sales_lines由来。原価は仕入・在庫出荷・運送会社の実費まで含む)を、
 * 既存の売上ダッシュボード(buildDashboard/SalesDashboardClient)がそのまま扱える
 * MonthlyRow型に変換する。売上ダッシュボード明細(/sales-detail)向け。
 *
 * purchase_amount(原価)は、cost(仕入・在庫出荷原価)+freight_actual(運送会社実費)の
 * 合算(=最終利益ベース)。period_endは20日締め期間の末日で、その月の月度そのものを
 * 表しているため、month列にそのまま使える(ymFromDateで年月を取り出せば正しい月度になる)。
 *
 * 【重要】profit_summaryは受注が確定した時点で先に登録されるため、今日時点の会計期末
 * (例: 2026-09-20)より後の期間(例: 2026-10-20、2026-11-20)の行が既に少数存在する
 * (2026-09時点で実データ確認済み: 76行、うち2026-11-20が1行)。buildDashboard()は
 * 全行のfiscal_yearの最大値を「今期(CUR)」とみなす実装のため、これらの未来行を
 * 除外しないと「今期」が実績のほとんど無い来期にすり替わってしまう
 * (ProfitDashboard.tsxで過去に実際に発生した不具合と同じ原因)。sales_monthly(v_monthly)
 * には未来行が無いため、この問題はprofit_summary由来のこの画面だけに起きる。
 *
 * 在庫仕入(拠点90・91)は呼び出し側でv_monthlyから別途取得して合流させるため、
 * ここでは除外する(実データ確認: profit_summaryにも拠点90の孤立行が3件だけ
 * 存在するが、いずれも売上0円・運賃のみの行で、除外しても実質的な影響は無い)。
 */
const STOCK_CODES = new Set(["90", "91"]);

export function profitSummaryToMonthlyRows(rows: ProfitSummaryRow[]): MonthlyRow[] {
  const periodEnd = currentFiscalPeriodEndDate();
  return rows
    .filter((r) => r.period_end <= periodEnd && !STOCK_CODES.has(r.branch_code))
    .map((r) => {
      const purchase_amount = r.cost + r.freight_actual;
      const profit = r.revenue - purchase_amount;
      const ym = ymFromDate(r.period_end);
      return {
        month: r.period_end,
        fiscal_year: fiscalYearOf(ym),
        location_code: r.branch_code || "",
        location_name: r.branch_code ? branchLabel(r.branch_code) : null,
        staff_code: r.rep_code ?? "",
        staff_name: r.rep_code ? repLabel(r.rep_code) : null,
        customer_code: r.customer_code ?? "",
        customer_name: r.customer_name,
        sales_amount: r.revenue,
        purchase_amount,
        profit,
        margin_pct: r.revenue ? Math.round((profit / r.revenue) * 1000) / 10 : 0,
        has_purchase: purchase_amount > 0,
      };
    });
}
