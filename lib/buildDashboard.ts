import { periodIndexOf, monthsOfFiscalYear, ymFromDate } from "./fiscal";
import type {
  MonthlyRow,
  DashboardData,
  MatrixRow,
  TrendPoint,
  Summary,
  StockData,
  MonthCell,
} from "./types";

const round1 = (n: number) => Math.round(n * 10) / 10;
const roundYen = (n: number) => Math.round(n);

export function buildDashboard(rows: MonthlyRow[]): DashboardData {
  if (rows.length === 0) {
    throw new Error("v_monthlyから1件もデータが取得できませんでした。Supabaseにデータが入っているか確認してください。");
  }

  const withYm = rows.map((r) => ({ ...r, ym: ymFromDate(r.month) }));

  const CUR = Math.max(...withYm.map((r) => r.fiscal_year));
  const PREV = CUR - 1;

  const cur_months = monthsOfFiscalYear(CUR);
  const prev_months = monthsOfFiscalYear(PREV);

  function trendSeries(fiscalYear: number, months: string[]): TrendPoint[] {
    const byYm = new Map<string, { sales: number; pur: number }>();
    for (const r of withYm) {
      if (r.fiscal_year !== fiscalYear) continue;
      const cur = byYm.get(r.ym) ?? { sales: 0, pur: 0 };
      cur.sales += r.sales_amount;
      cur.pur += r.purchase_amount;
      byYm.set(r.ym, cur);
    }
    return months.map((ym) => {
      const v = byYm.get(ym) ?? { sales: 0, pur: 0 };
      return { ym, sales: roundYen(v.sales), pur: roundYen(v.pur), profit: roundYen(v.sales - v.pur) };
    });
  }
  const trend_cur = trendSeries(CUR, cur_months);
  const trend_prev = trendSeries(PREV, prev_months);

  const latest_ym =
    [...trend_cur].reverse().find((t) => t.sales > 0)?.ym ?? cur_months[cur_months.length - 1];
  const latest_pi = periodIndexOf(latest_ym) + 1;

  const cur_sales = withYm.filter((r) => r.fiscal_year === CUR).reduce((a, r) => a + r.sales_amount, 0);

  const salesMonthsWithData = new Set(
    withYm.filter((r) => r.fiscal_year === CUR && r.sales_amount > 0).map((r) => r.ym)
  );
  const n_sales = salesMonthsWithData.size;

  const monthPurchaseTotal = new Map<string, number>();
  for (const r of withYm) {
    if (r.fiscal_year !== CUR) continue;
    monthPurchaseTotal.set(r.ym, (monthPurchaseTotal.get(r.ym) ?? 0) + r.purchase_amount);
  }
  const fullMonths = new Set([...salesMonthsWithData].filter((m) => (monthPurchaseTotal.get(m) ?? 0) > 0));
  const n_full = fullMonths.size;

  const curFullRows = withYm.filter((r) => r.fiscal_year === CUR && fullMonths.has(r.ym));
  const cur_sales_full = curFullRows.reduce((a, r) => a + r.sales_amount, 0);
  const cur_profit_full = cur_sales_full - curFullRows.reduce((a, r) => a + r.purchase_amount, 0);
  const cur_margin = cur_sales_full ? round1((cur_profit_full / cur_sales_full) * 100) : 0;

  const prevRows = withYm.filter((r) => r.fiscal_year === PREV);
  const prev_sales_total = prevRows.reduce((a, r) => a + r.sales_amount, 0);
  const prev_profit_total = prev_sales_total - prevRows.reduce((a, r) => a + r.purchase_amount, 0);
  const prev_margin = prev_sales_total ? round1((prev_profit_total / prev_sales_total) * 100) : 0;

  const prevSameRows = prevRows.filter((r) => periodIndexOf(r.ym) + 1 <= latest_pi);
  const prev_sales_same = prevSameRows.reduce((a, r) => a + r.sales_amount, 0);
  const prev_profit_same = prev_sales_same - prevSameRows.reduce((a, r) => a + r.purchase_amount, 0);
  const prev_margin_same = prev_sales_same ? round1((prev_profit_same / prev_sales_same) * 100) : 0;
  const sales_yoy = prev_sales_same ? round1((cur_sales / prev_sales_same - 1) * 100) : 0;

  const target_margin = round1(prev_margin + 3);

  const fc_simple = n_sales ? roundYen((cur_sales / n_sales) * 12) : 0;
  const prevRestRows = prevRows.filter((r) => periodIndexOf(r.ym) + 1 > latest_pi);
  const prev_rest = prevRestRows.reduce((a, r) => a + r.sales_amount, 0);
  const fc_seasonal = prev_sales_same ? roundYen(cur_sales + cur_sales * (prev_rest / prev_sales_same)) : fc_simple;

  const summary: Summary = {
    CUR,
    PREV,
    n_sales,
    n_full,
    latest_pi,
    cur_sales: roundYen(cur_sales),
    cur_profit_full: roundYen(cur_profit_full),
    cur_margin,
    prev_sales_total: roundYen(prev_sales_total),
    prev_profit_total: roundYen(prev_profit_total),
    prev_margin,
   prev_sales_same: roundYen(prev_sales_same),
    prev_profit_same: roundYen(prev_profit_same),
    sales_yoy,
    prev_margin_same,
    target_margin,
    fc_simple,
    fc_seasonal,
  };

  type DimKey = "location_code" | "staff_code" | "customer_code";
  type NameKey = "location_name" | "staff_name" | "customer_name";

  function buildMatrix(dimKey: DimKey, nameKey: NameKey): MatrixRow[] {
    type Acc = { cur: { s: number; p: number }[]; prev: { s: number; p: number }[] };
    const map = new Map<string, Acc>();
    const nameMap = new Map<string, string>();

    for (const r of withYm) {
      const code = r[dimKey];
      if (!code) continue;
      if (!map.has(code)) {
        map.set(code, {
          cur: Array.from({ length: 12 }, () => ({ s: 0, p: 0 })),
          prev: Array.from({ length: 12 }, () => ({ s: 0, p: 0 })),
        });
      }
      const acc = map.get(code)!;
      const name = r[nameKey];
      if (name) nameMap.set(code, name);

      const i = periodIndexOf(r.ym);
      if (r.fiscal_year === CUR) {
        acc.cur[i].s += r.sales_amount;
        acc.cur[i].p += r.purchase_amount;
      } else if (r.fiscal_year === PREV) {
        acc.prev[i].s += r.sales_amount;
        acc.prev[i].p += r.purchase_amount;
      }
    }

    const rows: MatrixRow[] = [];
    for (const [code, acc] of map) {
      const cur: MonthCell[] = acc.cur.map((c, i) => {
        // その月、会社全体でまだ売上が1件も無いなら(=まだ売上データが未入力の月なら)、
        // 仕入だけ先に入っていても、その月の仕入・粗利は計算・表示しない。
        const ym = cur_months[i];
        const monthHasAnySales = salesMonthsWithData.has(ym);
        const s = roundYen(c.s);
        const p = monthHasAnySales ? roundYen(c.p) : 0;
        return {
          s,
          p,
          m: s ? round1(((s - p) / s) * 100) : null,
        };
      });
    const prev = acc.prev.map((c) => ({ s: roundYen(c.s), p: roundYen(c.p) }));
const cur_ts = cur.reduce((a, c) => a + c.s, 0);
const cur_tp = cur.reduce((a, c) => a + c.p, 0);
const prev_ts = acc.prev.reduce((a, c) => a + c.s, 0);
const prev_tp = acc.prev.reduce((a, c) => a + c.p, 0);
const prev_ts_same = acc.prev.slice(0, latest_pi).reduce((a, c) => a + c.s, 0);
const prev_tp_same = acc.prev.slice(0, latest_pi).reduce((a, c) => a + c.p, 0);
      const prev_tm = prev_ts ? round1(((prev_ts - prev_tp) / prev_ts) * 100) : null;
      const cur_tm = cur_ts ? round1(((cur_ts - cur_tp) / cur_ts) * 100) : null;
      const target = prev_tm !== null ? round1(prev_tm + 3) : null;

     rows.push({
  code,
  name: nameMap.get(code) ?? code,
  cur,
  prev,
  cur_ts: roundYen(cur_ts),
  cur_tp: roundYen(cur_tp),
  cur_tm,
  prev_ts: roundYen(prev_ts),
  prev_tp: roundYen(prev_tp),
  prev_ts_same: roundYen(prev_ts_same),
  prev_tp_same: roundYen(prev_tp_same),
  prev_tm,
  target,
});
    }

    rows.sort((a, b) => b.cur_ts - a.cur_ts);
    return rows;
  }

  const mat_loc = buildMatrix("location_code", "location_name");
  const mat_staff = buildMatrix("staff_code", "staff_name");
  const mat_cust_all = buildMatrix("customer_code", "customer_name");
  const cust_total_count = mat_cust_all.length;
  const mat_cust = mat_cust_all.slice(0, 100);

  const STOCK_CODES = new Set(["90", "91"]);
  const curStock = new Array(12).fill(0);
  const prevStock = new Array(12).fill(0);
  for (const r of withYm) {
    if (!STOCK_CODES.has(r.location_code)) continue;
    const i = periodIndexOf(r.ym);
    if (r.fiscal_year === CUR) {
      // その月、会社全体でまだ売上が1件も無いなら、在庫仕入も計上しない
      if (salesMonthsWithData.has(r.ym)) curStock[i] += r.purchase_amount;
    } else if (r.fiscal_year === PREV) prevStock[i] += r.purchase_amount;
  }
  const cur_total = curStock.reduce((a, v) => a + v, 0);
  const prev_total = prevStock.reduce((a, v) => a + v, 0);
  const n_cur = curStock.filter((v) => v > 0).length;
  let latest_i = -1;
  curStock.forEach((v, i) => {
    if (v > 0) latest_i = i;
  });
  const prev_same = prevStock.slice(0, latest_i + 1).reduce((a, v) => a + v, 0);
  const yoy_pct = prev_same ? round1((cur_total / prev_same - 1) * 100) : null;

  const stock: StockData = {
    cur: curStock.map(roundYen),
    prev: prevStock.map(roundYen),
    cur_total: roundYen(cur_total),
    prev_total: roundYen(prev_total),
    prev_same: roundYen(prev_same),
    n_cur,
    yoy_pct,
  };

  return {
    summary,
    cur_months,
    prev_months,
    trend_cur,
    trend_prev,
    latest_ym,
    mat_loc,
    mat_staff,
    mat_cust,
    cust_total_count,
    stock,
  };
}
