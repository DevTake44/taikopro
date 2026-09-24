import { periodIndexOf, monthsOfFiscalYear, ymFromDate } from "./fiscal";
import type {
  MonthlyRow,
  DashboardData,
  MatrixRow,
  TrendPoint,
  Summary,
  StockData,
  MonthCell,
  YearDimRow,
  YearMatrixSet,
  YearMonthCell,
  PeriodReport,
} from "./types";

const round1 = (n: number) => Math.round(n * 10) / 10;
const roundYen = (n: number) => Math.round(n);

export function buildDashboard(rows: MonthlyRow[]): DashboardData {
  if (rows.length === 0) {
    throw new Error("v_monthlyから1件もデータが取得できませんでした。Supabaseにデータが入っているか確認してください。");
  }

  const withYm = rows.map((r) => ({ ...r, ym: ymFromDate(r.month) }));

  // withYmは9万件超になるため、Math.max(...array)はV8のスタック上限を超えて
  // "Maximum call stack size exceeded" になる。reduceで最大値を求める。
  const CUR = withYm.reduce((max, r) => (r.fiscal_year > max ? r.fiscal_year : max), withYm[0].fiscal_year);
  const PREV = CUR - 1;

  const STOCK_CODES = new Set(["90", "91"]);

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

  // 経営レポート一式を、任意の会計年度yAを「今期」・yB=yA-1を「前期」として計算する。
  // 「期選択」プルダウンで今期以外の年度(=完結済みの過去の期)を選んだ時にも
  // 同じロジックで総評・比較表・KPI・グラフが作れるようにするための共通化。
  function buildPeriodReport(yA: number): PeriodReport {
    const yB = yA - 1;
    const months_a = monthsOfFiscalYear(yA);
    const months_b = monthsOfFiscalYear(yB);
    const trend_a = trendSeries(yA, months_a);
    const trend_b = trendSeries(yB, months_b);

    const latest_ym = [...trend_a].reverse().find((t) => t.sales > 0)?.ym ?? months_a[months_a.length - 1];
    const latest_pi = periodIndexOf(latest_ym) + 1;

    const a_sales = withYm.filter((r) => r.fiscal_year === yA).reduce((s, r) => s + r.sales_amount, 0);

    const salesMonthsWithData_a = new Set(
      withYm.filter((r) => r.fiscal_year === yA && r.sales_amount > 0).map((r) => r.ym)
    );
    const n_sales = salesMonthsWithData_a.size;

    const monthPurchaseTotal_a = new Map<string, number>();
    for (const r of withYm) {
      if (r.fiscal_year !== yA) continue;
      monthPurchaseTotal_a.set(r.ym, (monthPurchaseTotal_a.get(r.ym) ?? 0) + r.purchase_amount);
    }
    const fullMonths = new Set([...salesMonthsWithData_a].filter((m) => (monthPurchaseTotal_a.get(m) ?? 0) > 0));
    const n_full = fullMonths.size;

    const aFullRows = withYm.filter((r) => r.fiscal_year === yA && fullMonths.has(r.ym));
    const a_sales_full = aFullRows.reduce((s, r) => s + r.sales_amount, 0);
    const a_profit_full = a_sales_full - aFullRows.reduce((s, r) => s + r.purchase_amount, 0);
    const a_margin = a_sales_full ? round1((a_profit_full / a_sales_full) * 100) : 0;

    const bRows = withYm.filter((r) => r.fiscal_year === yB);
    const b_sales_total = bRows.reduce((s, r) => s + r.sales_amount, 0);
    const b_profit_total = b_sales_total - bRows.reduce((s, r) => s + r.purchase_amount, 0);
    const b_margin = b_sales_total ? round1((b_profit_total / b_sales_total) * 100) : 0;

    const bSameRows = bRows.filter((r) => periodIndexOf(r.ym) + 1 <= latest_pi);
    const b_sales_same = bSameRows.reduce((s, r) => s + r.sales_amount, 0);
    const b_profit_same = b_sales_same - bSameRows.reduce((s, r) => s + r.purchase_amount, 0);
    const b_margin_same = b_sales_same ? round1((b_profit_same / b_sales_same) * 100) : 0;
    const sales_yoy = b_sales_same ? round1((a_sales / b_sales_same - 1) * 100) : 0;

    const target_margin = round1(b_margin + 3);

    const fc_simple = n_sales ? roundYen((a_sales / n_sales) * 12) : 0;
    const bRestRows = bRows.filter((r) => periodIndexOf(r.ym) + 1 > latest_pi);
    const b_rest = bRestRows.reduce((s, r) => s + r.sales_amount, 0);
    const fc_seasonal = b_sales_same ? roundYen(a_sales + a_sales * (b_rest / b_sales_same)) : fc_simple;

    const summary: Summary = {
      CUR: yA,
      PREV: yB,
      n_sales,
      n_full,
      latest_pi,
      cur_sales: roundYen(a_sales),
      cur_profit_full: roundYen(a_profit_full),
      cur_margin: a_margin,
      prev_sales_total: roundYen(b_sales_total),
      prev_profit_total: roundYen(b_profit_total),
      prev_margin: b_margin,
      prev_sales_same: roundYen(b_sales_same),
      prev_profit_same: roundYen(b_profit_same),
      sales_yoy,
      prev_margin_same: b_margin_same,
      target_margin,
      fc_simple,
      fc_seasonal,
    };

    // 在庫仕入(拠点90・91)。yAが会社全体でまだ売上が1件も無い月は、
    // 仕入だけ先に入っていても計上しない(過去の完結した期では全月に売上があるはずなので、
    // この抑制は実質働かない)。
    const aStock = new Array(12).fill(0);
    const bStock = new Array(12).fill(0);
    for (const r of withYm) {
      if (!STOCK_CODES.has(r.location_code)) continue;
      const i = periodIndexOf(r.ym);
      if (r.fiscal_year === yA) {
        if (salesMonthsWithData_a.has(r.ym)) aStock[i] += r.purchase_amount;
      } else if (r.fiscal_year === yB) {
        bStock[i] += r.purchase_amount;
      }
    }
    const a_total = aStock.reduce((s, v) => s + v, 0);
    const b_total = bStock.reduce((s, v) => s + v, 0);
    const n_cur = aStock.filter((v) => v > 0).length;
    let latest_i = -1;
    aStock.forEach((v, i) => {
      if (v > 0) latest_i = i;
    });
    const b_same = bStock.slice(0, latest_i + 1).reduce((s, v) => s + v, 0);
    const yoy_pct = b_same ? round1((a_total / b_same - 1) * 100) : null;

    const stock: StockData = {
      cur: aStock.map(roundYen),
      prev: bStock.map(roundYen),
      cur_total: roundYen(a_total),
      prev_total: roundYen(b_total),
      prev_same: roundYen(b_same),
      n_cur,
      yoy_pct,
    };

    return { summary, cur_months: months_a, prev_months: months_b, trend_cur: trend_a, trend_prev: trend_b, latest_ym, stock };
  }

  const mainReport = buildPeriodReport(CUR);
  const { summary, cur_months, prev_months, trend_cur, trend_prev, latest_ym, stock } = mainReport;
  const latest_pi = summary.latest_pi;
  const salesMonthsWithData = new Set(
    withYm.filter((r) => r.fiscal_year === CUR && r.sales_amount > 0).map((r) => r.ym)
  );

  type DimKey = "location_code" | "staff_code" | "customer_code";
  type NameKey = "location_name" | "staff_name" | "customer_name";

  // yA=手前の期(cur側)、yB=比較対象の期(prev側)。yAが今期(CUR)の場合だけ、
  // 「会社全体でまだ売上が1件も無い月は仕入だけ先に入っていても計算・表示しない」
  // という抑制を行う(過去の完結した期にはこの抑制は不要)。
  function buildMatrix(dimKey: DimKey, nameKey: NameKey, yA: number, yB: number, monthsA: string[], latestPiForA: number): MatrixRow[] {
    type Acc = { cur: { s: number; p: number }[]; prev: { s: number; p: number }[] };
    const map = new Map<string, Acc>();
    const nameMap = new Map<string, string>();
    const suppressFutureMonths = yA === CUR;

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
      if (r.fiscal_year === yA) {
        acc.cur[i].s += r.sales_amount;
        acc.cur[i].p += r.purchase_amount;
      } else if (r.fiscal_year === yB) {
        acc.prev[i].s += r.sales_amount;
        acc.prev[i].p += r.purchase_amount;
      }
    }

    const rows: MatrixRow[] = [];
    for (const [code, acc] of map) {
      const cur: MonthCell[] = acc.cur.map((c, i) => {
        // その月、会社全体でまだ売上が1件も無いなら(=まだ売上データが未入力の月なら)、
        // 仕入だけ先に入っていても、その月の仕入・粗利は計算・表示しない。
        const ym = monthsA[i];
        const monthHasAnySales = !suppressFutureMonths || salesMonthsWithData.has(ym);
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
const prev_ts_same = acc.prev.slice(0, latestPiForA).reduce((a, c) => a + c.s, 0);
const prev_tp_same = acc.prev.slice(0, latestPiForA).reduce((a, c) => a + c.p, 0);
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

  const mat_loc = buildMatrix("location_code", "location_name", CUR, PREV, cur_months, latest_pi);
  const mat_staff = buildMatrix("staff_code", "staff_name", CUR, PREV, cur_months, latest_pi);
  const mat_cust_all = buildMatrix("customer_code", "customer_name", CUR, PREV, cur_months, latest_pi);
  const cust_total_count = mat_cust_all.length;
  const mat_cust = mat_cust_all.slice(0, 100);

  // 月別マトリクス専用: 会計年度ごとに独立した月次データ(表示期間・対比期間を
  // 画面側で自由に選べるようにするため)。年度は「今期(CUR)」と同じ扱いの年度だけ、
  // 会社全体でまだ売上が1件も無い月の仕入を抑制する(過去の完結した年度は抑制しない)。
  function buildYearDim(dimKey: DimKey, nameKey: NameKey, year: number): YearDimRow[] {
    const map = new Map<string, { months: { s: number; p: number }[]; name: string }>();
    for (const r of withYm) {
      if (r.fiscal_year !== year) continue;
      const code = r[dimKey];
      if (!code) continue;
      if (!map.has(code)) {
        map.set(code, { months: Array.from({ length: 12 }, () => ({ s: 0, p: 0 })), name: code });
      }
      const acc = map.get(code)!;
      const name = r[nameKey];
      if (name) acc.name = name;
      const i = periodIndexOf(r.ym);
      acc.months[i].s += r.sales_amount;
      acc.months[i].p += r.purchase_amount;
    }

    const suppressFutureMonths = year === CUR;
    const rows: YearDimRow[] = [];
    for (const [code, acc] of map) {
      const months: YearMonthCell[] = acc.months.map((c, i) => {
        const ym = monthsOfFiscalYear(year)[i];
        const monthHasAnySales = !suppressFutureMonths || salesMonthsWithData.has(ym);
        return { s: roundYen(c.s), p: monthHasAnySales ? roundYen(c.p) : 0 };
      });
      const total_s = months.reduce((a, m) => a + m.s, 0);
      const total_p = months.reduce((a, m) => a + m.p, 0);
      rows.push({ code, name: acc.name, months, total_s, total_p });
    }
    rows.sort((a, b) => b.total_s - a.total_s);
    return rows;
  }

  // 月別マトリクスの「表示期間・対比期間」の選択肢としては、売上のある年度だけを出す
  // (仕入・売上どちらのデータの取り込み開始時期よりも前の会計年度が紛れ込むのを防ぐ)。
  const allFiscalYears = Array.from(new Set(withYm.map((r) => r.fiscal_year))).sort((a, b) => a - b);
  const salesByFiscalYear = new Map<number, number>();
  for (const r of withYm) {
    salesByFiscalYear.set(r.fiscal_year, (salesByFiscalYear.get(r.fiscal_year) ?? 0) + r.sales_amount);
  }
  const fiscalYears = allFiscalYears.filter((y) => (salesByFiscalYear.get(y) ?? 0) > 0);

  const matrixByYear: Record<number, YearMatrixSet> = {};
  for (const y of allFiscalYears) {
    const custAll = buildYearDim("customer_code", "customer_name", y);
    matrixByYear[y] = {
      loc: buildYearDim("location_code", "location_name", y),
      staff: buildYearDim("staff_code", "staff_name", y),
      cust: custAll.slice(0, 100),
      cust_total_count: custAll.length,
    };
  }

  // 経営レポートの「期選択」用。各会計年度を今期扱いにした場合の一式を作っておく。
  // CURは(売上がまだ無い期でも)「自動(最新)」の初期値として必ず選べるよう、
  // fiscalYears(売上のある年度のみ)に含まれていなくても常に入れておく。
  const reportByYear: Record<number, PeriodReport> = { [CUR]: mainReport };
  for (const y of fiscalYears) {
    if (y === CUR) continue;
    reportByYear[y] = buildPeriodReport(y);
  }

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
    fiscalYears,
    matrixByYear,
    stock,
    reportByYear,
  };
}
