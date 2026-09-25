"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import type { DashboardData, MonthCell } from "@/lib/types";
import type { StockDetailData } from "@/lib/buildStockDetail";
import type { StockMovementData } from "@/lib/buildStockMovement";
import { yen, jpn, oku, monL } from "@/lib/format";
import { monthsOfFiscalYear } from "@/lib/fiscal";
import { StockCheckContent } from "./StockCheckClient";
import TrendChart from "./TrendChart";

type MainTab = "report" | "matrix" | "stock";
type Dim = "loc" | "staff" | "cust";
type Metric = "sales" | "purchase" | "profit" | "margin";

const dimName: Record<Dim, string> = { loc: "拠点", staff: "担当者", cust: "得意先" };

export default function SalesDashboardClient({
  data,
  stockDetailByYear,
  stockMovementByYear,
  stockMovementError,
  availableMonths,
  selectedUntil,
  variant = "monthly",
}: {
  data: DashboardData;
  stockDetailByYear: Record<number, StockDetailData>;
  stockMovementByYear: Record<number, StockMovementData | null>;
  stockMovementError: string | null;
  availableMonths: string[];
  selectedUntil: string | null;
  // "monthly"=元の売上ダッシュボード(sales_monthly、月次集計)。
  // "detail"=売上ダッシュボード明細(profit_summary、明細=sales_lines由来。
  // 原価は仕入・在庫出荷・運送会社の実費まで含む)。表示する画面(タブ構成・見た目)は
  // 完全に同じで、データの集計元と見出し・説明文だけが違う。
  variant?: "monthly" | "detail";
}) {
  const S = data.summary;
  const [mainTab, setMainTab] = useState<MainTab>("report");
  const router = useRouter();
  const pathname = usePathname();
  const isDetail = variant === "detail";

  function handleUntilChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    router.push(value === "latest" ? pathname : `${pathname}?until=${value}`);
  }

  return (
    <div className="wrap">
      <header className="top">
        <div className="title">
          <h1>
            売上ダッシュボード{isDetail ? "明細" : ""} <span className="badge-demo">実データ</span>
          </h1>
          <p>
            今期 {S.CUR}年10月度〜(最新 {monL(data.latest_ym)}度まで)
            {isDetail && "・売上は明細(sales_lines)、原価は仕入・在庫出荷・運送会社の実費まで含めて集計"}
          </p>
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-faint)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              表示基準月:
              <select
                value={selectedUntil ?? "latest"}
                onChange={handleUntilChange}
                style={{ fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid #d7dbe2", color: "#333", background: "#fff" }}
              >
                <option value="latest">自動(最新月まで)</option>
                {[...availableMonths].reverse().map((ym) => (
                  <option key={ym} value={ym}>
                    {monL(ym)}度まで
                  </option>
                ))}
              </select>
            </label>
            {selectedUntil && (
              <span>※ {monL(selectedUntil)}度までのデータで表示中です(それより後の月は含まれていません)</span>
            )}
            {isDetail ? (
              <Link href="/sales" className="ghost-btn-inline">
                → 売上ダッシュボード(集計版)
              </Link>
            ) : (
              <Link href="/sales-detail" className="ghost-btn-inline">
                → 売上ダッシュボード明細
              </Link>
            )}
            <Link href="/sales/profit" className="ghost-btn-inline">
              売上利益 →
            </Link>
            <Link href="/sales/profit-summary" className="ghost-btn-inline">
              拠点・営業・得意先 利益 →
            </Link>
            <Link href="/menu" className="ghost-btn-inline">
              ← メインメニュー
            </Link>
          </div>
        </div>
        <div className="maintabs">
          <button className={mainTab === "report" ? "active" : ""} onClick={() => setMainTab("report")}>
            経営レポート
          </button>
          <button className={mainTab === "matrix" ? "active" : ""} onClick={() => setMainTab("matrix")}>
            月別マトリクス
          </button>
          <button className={mainTab === "stock" ? "active" : ""} onClick={() => setMainTab("stock")}>
            在庫
          </button>
        </div>
      </header>

      {mainTab === "report" && <ReportPage data={data} />}
      {mainTab === "matrix" && <MatrixPage data={data} />}
      {mainTab === "stock" && (
        <StockTab
          data={data}
          stockDetailByYear={stockDetailByYear}
          stockMovementByYear={stockMovementByYear}
          stockMovementError={stockMovementError}
        />
      )}
      <p className="foot-note">
        実データに基づくダッシュボードです。不動在庫チェックの詳細は「社内DX」メニューからも確認できます。
      </p>
    </div>
  );
}

/* ============ 経営レポート(役員向け1画面) ============ */
function ReportPage({ data }: { data: DashboardData }) {
  const trueCUR = data.summary.CUR;
  const years = useMemo(
    () => Array.from(new Set([trueCUR, ...data.fiscalYears])).sort((a, b) => a - b),
    [trueCUR, data.fiscalYears]
  );
  const [selectedYear, setSelectedYear] = useState<number>(trueCUR);
  const view = data.reportByYear[selectedYear] ?? {
    summary: data.summary,
    cur_months: data.cur_months,
    prev_months: data.prev_months,
    trend_cur: data.trend_cur,
    trend_prev: data.trend_prev,
    latest_ym: data.latest_ym,
    stock: data.stock,
  };
  // buildTrendConfig/buildStockConfigは DashboardData を受け取るので、
  // 選択中の期の値で該当フィールドだけ差し替えたものを渡す。
  const viewData: DashboardData = {
    ...data,
    summary: view.summary,
    cur_months: view.cur_months,
    prev_months: view.prev_months,
    trend_cur: view.trend_cur,
    trend_prev: view.trend_prev,
    latest_ym: view.latest_ym,
    stock: view.stock,
  };

  const S = view.summary;
  const st = view.stock;

  const profitDiff = S.cur_profit_full - S.prev_profit_same;
  const marginDiff = round1(S.cur_margin - S.prev_margin_same);
  const stockDiff = st.cur_total - st.prev_same;
  const marginGap = round1(S.target_margin - S.cur_margin);
  const landingMid = Math.round((S.fc_simple + S.fc_seasonal) / 2);

  const salesUp = S.sales_yoy >= 0;
  const marginUp = marginDiff >= 0;
  const stockUp = stockDiff >= 0;

  const trendConfig = useMemo(() => buildTrendConfig(viewData), [viewData]);
  const stockConfig = useMemo(() => buildStockConfig(viewData), [viewData]);

  return (
    <div className="page active">
      <PeriodSelect years={years} trueCUR={trueCUR} selectedYear={selectedYear} onChange={setSelectedYear} />
      <div className="card">
        <div className="card-head">
          <h2>総評(最新 {monL(view.latest_ym)}度まで)</h2>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.9, padding: "0 20px 20px" }}>
          売上は前期より{" "}
          <b style={{ color: salesUp ? "var(--pos)" : "var(--neg)" }}>
            {salesUp ? "+" : ""}{S.sales_yoy}%
          </b>
          {salesUp ? "増加" : "減少"}しています({oku(S.cur_sales)})。
          <br />
          粗利率は前期同期より{" "}
          <b style={{ color: marginUp ? "var(--pos)" : "var(--neg)" }}>
            {marginUp ? "+" : ""}{marginDiff}pt
          </b>
          {marginUp ? "改善" : "低下"}しています({S.cur_margin}% ← {S.prev_margin_same}%)。
          <br />
          在庫仕入(拠点90・91)は前期同期より{" "}
          <b style={{ color: stockUp ? "var(--neg)" : "var(--pos)" }}>
            {stockUp ? "+" : ""}{yen(stockDiff)}
          </b>
          {stockUp ? "増加" : "減少"}しています。
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>今期・前期の比較(累計)</h2>
        </div>
        <div className="matwrap">
          <table className="mat">
            <thead>
              <tr>
                <th className="namecol">項目</th>
                <th>今期(累計)</th>
                <th>前期(同期間)</th>
                <th>昨対</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="namecol">売上</td>
                <td><span className="cell-s">{yen(S.cur_sales)}</span></td>
                <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{yen(S.prev_sales_same)}</span></td>
                <td><span className={`cell-s ${salesUp ? "val-pos" : "val-neg"}`}>{salesUp ? "+" : ""}{S.sales_yoy}%</span></td>
              </tr>
              <tr>
                <td className="namecol">粗利額<span style={{ fontSize: 10, color: "var(--ink-faint)" }}>(確定{S.n_full}ヶ月)</span></td>
                <td><span className="cell-s">{yen(S.cur_profit_full)}</span></td>
                <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{yen(S.prev_profit_same)}</span></td>
                <td><span className={`cell-s ${profitDiff >= 0 ? "val-pos" : "val-neg"}`}>{profitDiff >= 0 ? "+" : ""}{yen(profitDiff)}</span></td>
              </tr>
              <tr>
                <td className="namecol">粗利率</td>
                <td><span className="cell-s">{S.cur_margin}%</span></td>
                <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{S.prev_margin_same}%</span></td>
                <td><span className={`cell-s ${marginUp ? "val-pos" : "val-neg"}`}>{marginUp ? "+" : ""}{marginDiff}pt</span></td>
              </tr>
              <tr>
                <td className="namecol">在庫仕入(90・91)</td>
                <td><span className="cell-s">{yen(st.cur_total)}</span></td>
                <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{yen(st.prev_same)}</span></td>
                <td><span className={`cell-s ${stockUp ? "val-neg" : "val-pos"}`}>{stockUp ? "+" : ""}{yen(stockDiff)}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>期末(9月度)までの見込み</h2>
        </div>
        <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
          <KpiCard
            label="売上 着地見込み"
            value={`${oku(landingMid)}円`}
            foot={`慎重${oku(Math.min(S.fc_simple, S.fc_seasonal))}〜楽観${oku(Math.max(S.fc_simple, S.fc_seasonal))}`}
            primary
          />
          <KpiCard
            label="粗利率 目標との差"
            value={`${marginGap >= 0 ? "-" : "+"}${Math.abs(marginGap).toFixed(1)}pt`}
            foot={`目標${S.target_margin}%(前期${S.prev_margin}%+3pt)`}
            status={marginGap <= 0 ? "hit" : "miss"}
            badge={marginGap <= 0 ? "✓ 目標達成ペース" : `目標まであと${marginGap.toFixed(1)}pt`}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>月別推移:売上(今期 vs 前期)</h2>
        </div>
        <div className="legend">
          <span><i className="dot" style={{ background: "#2563d9" }} />今期 売上</span>
          <span><i className="dot" style={{ background: "#9aa3b2" }} />前期 売上</span>
        </div>
        <div className="chart-box">
          <TrendChart config={trendConfig} />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>月別推移:在庫仕入(今期 vs 前期)</h2>
        </div>
        <div className="legend">
          <span><i className="dot" style={{ background: "#e08a1e" }} />今期 在庫仕入</span>
          <span><i className="dot" style={{ background: "#9aa3b2" }} />前期 在庫仕入</span>
        </div>
        <div className="chart-box">
          <TrendChart config={stockConfig} />
        </div>
      </div>

      <p style={{ fontSize: 11, color: "var(--ink-faint)", padding: "0 20px 16px" }}>
        詳しい拠点別・担当者別の内訳は「月別マトリクス」タブ、在庫仕入の商品別・仕入先別の内訳や不動在庫チェックは「在庫」タブでご覧いただけます。
      </p>
    </div>
  );
}

// 経営レポート・在庫タブ共通の「期選択」プルダウン。選んだ年度を「今期」として、
// 総評・比較表・KPI・グラフなどページ全体を計算し直して表示する。
function PeriodSelect({
  years,
  trueCUR,
  selectedYear,
  onChange,
}: {
  years: number[];
  trueCUR: number;
  selectedYear: number;
  onChange: (y: number) => void;
}) {
  return (
    <div style={{ marginBottom: 14, fontSize: 12.5 }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        期選択:
        <select
          value={selectedYear}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ fontSize: 12.5, padding: "4px 8px", borderRadius: 6, border: "1px solid #d7dbe2" }}
        >
          {[...years].reverse().map((y) => (
            <option key={y} value={y}>
              {fiscalYearLabel(y, trueCUR)}({y}年度)
            </option>
          ))}
        </select>
      </label>
      {selectedYear !== trueCUR && (
        <span style={{ marginLeft: 10, color: "var(--ink-faint)" }}>
          ※ {fiscalYearLabel(selectedYear, trueCUR)}({selectedYear}年度)を「今期」として表示しています
        </span>
      )}
    </div>
  );
}

/* ============ 在庫 ============ */
function StockTab({
  data,
  stockDetailByYear,
  stockMovementByYear,
  stockMovementError,
}: {
  data: DashboardData;
  stockDetailByYear: Record<number, StockDetailData>;
  stockMovementByYear: Record<number, StockMovementData | null>;
  stockMovementError: string | null;
}) {
  const trueCUR = data.summary.CUR;
  const years = useMemo(
    () => Array.from(new Set([trueCUR, ...data.fiscalYears])).sort((a, b) => a - b),
    [trueCUR, data.fiscalYears]
  );
  const [selectedYear, setSelectedYear] = useState<number>(trueCUR);
  const stockDetail = stockDetailByYear[selectedYear] ?? stockDetailByYear[trueCUR];
  const stockMovement = stockMovementByYear[selectedYear] ?? stockMovementByYear[trueCUR] ?? null;

  return (
    <>
      <PeriodSelect years={years} trueCUR={trueCUR} selectedYear={selectedYear} onChange={setSelectedYear} />
      <StockCheckContent stockDetail={stockDetail} stockMovement={stockMovement} stockMovementError={stockMovementError} />
    </>
  );
}

/* ============ 月別マトリクス ============ */

// 会計年度→表示ラベル(今期/前期/前々期/それ以前)を作る
function fiscalYearLabel(year: number, CUR: number): string {
  if (year === CUR) return "今期";
  if (year === CUR - 1) return "前期";
  if (year === CUR - 2) return "前々期";
  return `${year}年度`;
}

type MonthCellPair = { base: MonthCell; cmp: MonthCell | null };
type MatrixMergedRow = {
  code: string;
  name: string;
  cells: MonthCellPair[]; // 基準期間・対比期間、12ヶ月分ずつ
  total_s: number;
  total_p: number;
  total_m: number | null;
  cmp: { total_s: number; total_p: number; total_m: number | null } | null; // 対比期間(選んでいなければnull)
};

function metricValue(metric: Metric, v: { total_s: number; total_p: number; total_m: number | null }): number | null {
  if (metric === "sales") return v.total_s;
  if (metric === "purchase") return v.total_p;
  if (metric === "profit") return v.total_s - v.total_p;
  return v.total_m;
}

// トータル列で実際に表示されている値(対比期間を選んでいれば差額、無ければ実額)を
// 並び替え用の数値にする。データが無い(null)行は最下位扱いにする。
function totalSortValue(metric: Metric, row: MatrixMergedRow): number {
  const v = metricValue(metric, row);
  if (row.cmp) {
    const cmpV = metricValue(metric, row.cmp);
    if (v == null || cmpV == null) return -Infinity;
    return v - cmpV;
  }
  return v ?? -Infinity;
}

// "total"は今表示中の指標(タブ)で並べる。"sales"/"profitAmt"は表示中のタブに
// 関係なく常に売上高・粗利額で並べる(例: 粗利率タブのまま「売上高順」に並べ替えて、
// 「売上は高いが薄利」「粗利額は大きく利益率も高い」等を確認できるようにするため)。
type SortKey = "code" | "name" | "total" | "sales" | "profitAmt";

function monthMetricValue(metric: Metric, c: MonthCell): number | null {
  if (metric === "sales") return c.s;
  if (metric === "purchase") return c.p;
  if (metric === "profit") return c.s - c.p;
  return c.m;
}

function toMonthCell(c: { s: number; p: number }): MonthCell {
  return { s: c.s, p: c.p, m: c.s ? Math.round(((c.s - c.p) / c.s) * 1000) / 10 : null };
}

function MatrixPage({ data }: { data: DashboardData }) {
  const [dim, setDim] = useState<Dim>("loc");
  const [metric, setMetric] = useState<Metric>("sales");
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState("");

  const CUR = data.summary.CUR;
  const years = data.fiscalYears; // 昇順
  const latestYear = years[years.length - 1];
  const [baseYear, setBaseYear] = useState<number>(latestYear);
  const [compareYear, setCompareYear] = useState<number | "none">(
    years.length >= 2 ? years[years.length - 2] : "none"
  );

  const baseSet = data.matrixByYear[baseYear];
  const compareSet = compareYear === "none" ? null : data.matrixByYear[compareYear];

  const baseMonths = useMemo(() => monthsOfFiscalYear(baseYear), [baseYear]);

  // 対比は「今期と同じ月数分(同期間)」で揃える。経営レポートの「前期(同期間)」と
  // 基準を合わせるため(前期の通期と比べると、今期がまだ進行中の月では差額が
  // 大きくズレて見えてしまう)。会社全体(拠点別の合計)で、実際に売上が計上されている
  // 月の数を数える。
  const baseMonthCount = useMemo(() => {
    const totals = new Array(12).fill(0);
    for (const r of baseSet.loc) {
      r.months.forEach((m, i) => {
        totals[i] += m.s;
      });
    }
    let count = 0;
    totals.forEach((s, i) => {
      if (s > 0) count = i + 1;
    });
    return count || 12;
  }, [baseSet]);

  const mergedAll = useMemo<MatrixMergedRow[]>(() => {
    const baseRows = dim === "loc" ? baseSet.loc : dim === "staff" ? baseSet.staff : baseSet.cust;
    const compareRows = compareSet ? (dim === "loc" ? compareSet.loc : dim === "staff" ? compareSet.staff : compareSet.cust) : null;
    const compareByCode = new Map((compareRows ?? []).map((r) => [r.code, r]));

    return baseRows.map((r) => {
      const cmpRow = compareByCode.get(r.code);
      const cells: MonthCellPair[] = r.months.map((c, i) => ({
        base: toMonthCell(c),
        // 今期がまだ到達していない月(baseMonthCountより先)は対比を出さない
        // (比べる相手が無い月に差額だけ出ると誤解を招くため)。
        cmp: compareSet && i < baseMonthCount ? toMonthCell(cmpRow?.months[i] ?? { s: 0, p: 0 }) : null,
      }));
      const total_s = r.total_s;
      const total_p = r.total_p;
      const total_m = total_s ? Math.round(((total_s - total_p) / total_s) * 1000) / 10 : null;
      // トータル欄の対比も、今期と同じ月数分(同期間)だけを合計する。
      const cmpSameMonths = (cmpRow?.months ?? []).slice(0, baseMonthCount);
      const cmpTotalS = cmpSameMonths.reduce((a, m) => a + m.s, 0);
      const cmpTotalP = cmpSameMonths.reduce((a, m) => a + m.p, 0);
      const cmp = compareSet
        ? {
            total_s: cmpTotalS,
            total_p: cmpTotalP,
            total_m: cmpTotalS ? Math.round(((cmpTotalS - cmpTotalP) / cmpTotalS) * 1000) / 10 : null,
          }
        : null;
      return { code: r.code, name: r.name, cells, total_s, total_p, total_m, cmp };
    });
  }, [baseSet, compareSet, dim, baseMonthCount]);

  const rows = useMemo(() => {
    let r = mergedAll;
    if (filter) {
      const f = filter.toLowerCase();
      r = r.filter((row) => (row.name + row.code).toLowerCase().includes(f));
    }
    r = [...r].sort((a, b) => {
      if (sortKey === "code") return sortDir === "asc" ? Number(a.code) - Number(b.code) : Number(b.code) - Number(a.code);
      if (sortKey === "name") return sortDir === "asc" ? a.name.localeCompare(b.name, "ja") : b.name.localeCompare(a.name, "ja");
      // "sales"/"profitAmt"は表示中のタブに関わらず常に売上高・粗利額で並べる。
      // "total"はトータル列に実際に表示されている数字(選択中の指標。対比期間を
      // 選んでいれば差額)で並べる。以前は常に売上金額の実額で並べていたため、
      // 仕入額/粗利額タブや対比表示の時に画面の数字と順番がズレて見えていた。
      const sortMetric: Metric = sortKey === "sales" ? "sales" : sortKey === "profitAmt" ? "profit" : metric;
      const va = totalSortValue(sortMetric, a);
      const vb = totalSortValue(sortMetric, b);
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return r;
  }, [mergedAll, filter, sortKey, sortDir, metric]);

  function onSort(k: "code" | "name" | "total") {
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "code" || k === "name" ? "asc" : "desc");
    }
  }

  const colTotals = new Array(12).fill(0).map(() => ({ s: 0, p: 0 }));
  const colCmpTotals = new Array(12).fill(0).map(() => ({ s: 0, p: 0 }));
  rows.forEach((r) => {
    r.cells.forEach((c, i) => {
      colTotals[i].s += c.base.s;
      colTotals[i].p += c.base.p;
      if (c.cmp) {
        colCmpTotals[i].s += c.cmp.s;
        colCmpTotals[i].p += c.cmp.p;
      }
    });
  });
  const grand: MatrixMergedRow = {
    code: "",
    name: "合計",
    cells: colTotals.map((c, i) => ({
      base: toMonthCell(c),
      cmp: compareSet && i < baseMonthCount ? toMonthCell(colCmpTotals[i]) : null,
    })),
    total_s: rows.reduce((a, r) => a + r.total_s, 0),
    total_p: rows.reduce((a, r) => a + r.total_p, 0),
    total_m: null,
    cmp: compareSet
      ? {
          total_s: rows.reduce((a, r) => a + (r.cmp?.total_s ?? 0), 0),
          total_p: rows.reduce((a, r) => a + (r.cmp?.total_p ?? 0), 0),
          total_m: null,
        }
      : null,
  };
  grand.total_m = grand.total_s ? Math.round(((grand.total_s - grand.total_p) / grand.total_s) * 1000) / 10 : null;
  if (grand.cmp) {
    grand.cmp.total_m = grand.cmp.total_s ? Math.round(((grand.cmp.total_s - grand.cmp.total_p) / grand.cmp.total_s) * 1000) / 10 : null;
  }

  return (
    <div className="page active">
      <div className="card">
        <div className="card-head">
          <div className="tabs">
            {(["loc", "staff", "cust"] as Dim[]).map((d) => (
              <button
                key={d}
                className={dim === d ? "active" : ""}
                onClick={() => {
                  setDim(d);
                  setFilter("");
                }}
              >
                {dimName[d]}別
              </button>
            ))}
          </div>
          {dim === "cust" && (
            <input
              type="text"
              className="search"
              placeholder="名前・コードで検索"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
        </div>
        <div className="card-head" style={{ paddingTop: 0 }}>
          <div className="tabs">
            {(
              [
                ["sales", "売上金額"],
                ["purchase", "仕入額"],
                ["profit", "粗利額"],
                ["margin", "粗利率"],
              ] as [Metric, string][]
            ).map(([m, label]) => (
              <button key={m} className={metric === m ? "active" : ""} onClick={() => setMetric(m)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="card-head" style={{ paddingTop: 0, flexWrap: "wrap", gap: 16 }}>
          <label style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
            表示期間:
            <select
              value={baseYear}
              onChange={(e) => setBaseYear(Number(e.target.value))}
              style={{ fontSize: 12.5, padding: "4px 8px", borderRadius: 6, border: "1px solid #d7dbe2" }}
            >
              {[...years].reverse().map((y) => (
                <option key={y} value={y}>
                  {fiscalYearLabel(y, CUR)}({y}年度)
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
            対比期間:
            <select
              value={compareYear}
              onChange={(e) => setCompareYear(e.target.value === "none" ? "none" : Number(e.target.value))}
              style={{ fontSize: 12.5, padding: "4px 8px", borderRadius: 6, border: "1px solid #d7dbe2" }}
            >
              <option value="none">対比なし</option>
              {[...years].reverse().map((y) => (
                <option key={y} value={y} disabled={y === baseYear}>
                  {fiscalYearLabel(y, CUR)}({y}年度)
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
            並び順:
            <select
              value={`${sortKey}_${sortDir}`}
              onChange={(e) => {
                const [k, d] = e.target.value.split("_") as [typeof sortKey, typeof sortDir];
                setSortKey(k);
                setSortDir(d);
              }}
              style={{ fontSize: 12.5, padding: "4px 8px", borderRadius: 6, border: "1px solid #d7dbe2" }}
            >
              <option value="total_desc">トータル(表示中の指標・多い順)</option>
              <option value="total_asc">トータル(表示中の指標・少ない順)</option>
              <option value="sales_desc">売上高(多い順)</option>
              <option value="profitAmt_desc">粗利額(多い順)</option>
              <option value="code_asc">コード順</option>
              <option value="name_asc">{dimName[dim]}名(あいうえお順)</option>
            </select>
          </label>
        </div>
        <div className="matwrap">
          <table className="mat">
            <thead>
              <tr>
                <th className="codecol" onClick={() => onSort("code")}>
                  コード{sortKey === "code" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
                <th className="namecol" onClick={() => onSort("name")}>
                  {dimName[dim]}{sortKey === "name" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
                {baseMonths.map((m) => (
                  <th key={m}>{monL(m)}</th>
                ))}
                <th className="totcol" onClick={() => onSort("total")}>
                  トータル{sortKey === "total" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td className="codecol">{r.code}</td>
                  <td className="namecol">{r.name}</td>
                  {r.cells.map((c, i) => (
                    <MatrixCell key={i} metric={metric} base={c.base} cmp={c.cmp} />
                  ))}
                  <MatrixTotalCell metric={metric} row={r} />
                </tr>
              ))}
            </tbody>
            <tfoot className="mat-foot">
              <tr>
                <td className="codecol" />
                <td className="namecol">合計</td>
                {grand.cells.map((c, i) => (
                  <MatrixCell key={i} metric={metric} base={c.base} cmp={c.cmp} />
                ))}
                <MatrixTotalCell metric={metric} row={grand} />
              </tr>
            </tfoot>
          </table>
        </div>
        <p style={{ fontSize: 11, color: "var(--ink-faint)", padding: "8px 20px 16px" }}>
          {dim === "cust"
            ? `得意先は売上上位100件(全${baseSet.cust_total_count.toLocaleString()}件)。検索で絞込。`
            : "4つのボタンで表示を切替。粗利率は10%以上=緑/未満=赤。対比期間を選ぶと、トータル列に対比先との差も表示されます。並び順は上の「並び順」欄か、見出し(コード/トータルなど)クリックで切り替えられます(▲▼が現在の並び順)。"}
        </p>
      </div>
    </div>
  );
}

// 対比期間が選ばれている月は、差額のみを1行で表示する(実額とは並べない)。
// 対比が無い月(対比なし・今期がまだ到達していない月)は、これまで通り実額を表示する。
function MatrixCell({
  metric,
  base,
  cmp,
}: {
  metric: Metric;
  base: MonthCell;
  cmp: MonthCell | null;
}) {
  const isPct = metric === "margin";
  const v = monthMetricValue(metric, base);

  if (cmp) {
    const cmpV = monthMetricValue(metric, cmp);
    if (v == null || cmpV == null) {
      return <td><span className="cell-s" style={{ color: "#c8ccd4" }}>―</span></td>;
    }
    const d = isPct ? Math.round((v - cmpV) * 10) / 10 : v - cmpV;
    return (
      <td>
        <span className={`cell-s ${d >= 0 ? "val-pos" : "val-neg"}`}>
          {d >= 0 ? "+" : ""}{isPct ? `${d}pt` : jpn(d)}
        </span>
      </td>
    );
  }

  if (metric === "sales" && base.s === 0 && base.p > 0) {
    return (
      <td>
        <span className="cell-s" style={{ color: "#c8ccd4" }}>0</span>
        <span className="cell-m" style={{ color: "#e08a1e" }}>仕{jpn(base.p)}</span>
      </td>
    );
  }
  if (v == null) return <td><span className="cell-s" style={{ color: "#c8ccd4" }}>―</span></td>;
  if (metric === "sales" && v === 0) return <td><span className="cell-s" style={{ color: "#c8ccd4" }}>0</span></td>;
  if (metric === "profit") {
    return <td><span className={`cell-s ${v >= 0 ? "val-pos" : "val-neg"}`}>{v >= 0 ? "+" : ""}{jpn(v)}</span></td>;
  }
  if (isPct) {
    const good = v >= 10;
    return (
      <td className={good ? "cell-good" : "cell-bad"}>
        <span className={`cell-s ${good ? "m-good" : "m-bad"}`}>{v.toFixed(1)}%</span>
      </td>
    );
  }
  return <td><span className="cell-s">{jpn(v)}</span></td>;
}

// 対比期間が選ばれていれば、トータル列も差額のみを1行で表示する(実額とは並べない)。
function MatrixTotalCell({ metric, row }: { metric: Metric; row: MatrixMergedRow }) {
  const v = metricValue(metric, row);
  const isPct = metric === "margin";

  if (row.cmp) {
    const cmpV = metricValue(metric, row.cmp);
    if (v == null || cmpV == null) {
      return <td className="totcol"><span className="cell-s">―</span></td>;
    }
    const d = isPct ? Math.round((v - cmpV) * 10) / 10 : v - cmpV;
    return (
      <td className="totcol">
        <span className={`cell-s ${d >= 0 ? "val-pos" : "val-neg"}`}>
          {d >= 0 ? "+" : ""}{isPct ? `${d}pt` : jpn(d)}
        </span>
      </td>
    );
  }

  if (v == null) return <td className="totcol"><span className="cell-s">―</span></td>;
  if (metric === "profit") {
    return <td className="totcol"><span className={`cell-s ${v >= 0 ? "val-pos" : "val-neg"}`}>{v >= 0 ? "+" : ""}{jpn(v)}</span></td>;
  }
  if (isPct) {
    return <td className="totcol"><span className={`cell-s ${v >= 10 ? "m-good" : "m-bad"}`}>{v.toFixed(1)}%</span></td>;
  }
  return <td className="totcol"><span className="cell-s">{jpn(v)}</span></td>;
}
/* ============ 共通パーツ ============ */
function KpiCard({
  label,
  value,
  foot,
  primary,
  status,
  badge,
}: {
  label: string;
  value: string;
  foot: string;
  primary?: boolean;
  status?: "hit" | "miss";
  badge?: string;
}) {
  return (
    <div className={`kpi ${primary ? "primary" : ""} ${status ?? ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {badge && <div className={`badge ${status === "hit" ? "b-hit" : "b-miss"}`}>{badge}</div>}
      <div className="foot">{foot}</div>
    </div>
  );
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/* ============ グラフ設定 ============ */
function buildTrendConfig(data: DashboardData) {
  const labels = data.prev_months.map(monL);
  const curSales = data.prev_months.map((_, i) => (data.trend_cur[i] ? data.trend_cur[i].sales : null));
  const prevSales = data.trend_prev.map((x) => x.sales);
  return {
    type: "bar" as const,
    data: {
      labels,
      datasets: [
        { type: "bar" as const, label: "今期 売上", data: curSales, backgroundColor: "#2563d9", borderRadius: 5, barPercentage: 0.7, categoryPercentage: 0.75, order: 2 },
        { type: "line" as const, label: "前期 売上", data: prevSales, borderColor: "#9aa3b2", borderDash: [5, 4], borderWidth: 2, tension: 0.3, pointRadius: 0, order: 1 },
      ],
    },
    options: baseChartOptions(),
  };
}

function buildStockConfig(data: DashboardData) {
  const st = data.stock;
  return {
    type: "bar" as const,
    data: {
      labels: data.cur_months.map(monL),
      datasets: [
        { type: "bar" as const, label: "今期 在庫仕入", data: st.cur, backgroundColor: "#e6a23c", borderRadius: 5, barPercentage: 0.7, categoryPercentage: 0.75, order: 2 },
        { type: "line" as const, label: "前期 在庫仕入", data: st.prev, borderColor: "#9aa3b2", borderDash: [5, 4], borderWidth: 2, tension: 0.3, pointRadius: 0, order: 1 },
      ],
    },
    options: baseChartOptions((v: number) => "¥" + (v / 1e6).toFixed(0) + "M"),
  };
}

function baseChartOptions(yTickFormat?: (v: number) => string) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (c: { dataset: { label?: string }; raw: unknown }) =>
            `${c.dataset.label}: ${c.raw == null ? "―" : yen(c.raw as number)}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: "#9aa3b2", font: { size: 11 } } },
      y: {
        grid: { color: "#eef1f5" },
        ticks: {
          color: "#9aa3b2",
          font: { size: 11 },
          callback: (value: number | string) => {
            const v = typeof value === "string" ? parseFloat(value) : value;
            return yTickFormat ? yTickFormat(v) : "¥" + (v / 1e8).toFixed(1) + "億";
          },
        },
      },
    },
  };
}
