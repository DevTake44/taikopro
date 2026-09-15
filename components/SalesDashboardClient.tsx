"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import type { DashboardData, MonthCell } from "@/lib/types";
import { yen, jpn, oku, monL } from "@/lib/format";
import { monthsOfFiscalYear } from "@/lib/fiscal";
import TrendChart from "./TrendChart";

type MainTab = "report" | "overview" | "matrix" | "goal";
type OvMode = "cur" | "prev" | "yoy";
type Dim = "loc" | "staff" | "cust";
type Metric = "sales" | "purchase" | "profit" | "margin";

const dimName: Record<Dim, string> = { loc: "拠点", staff: "担当者", cust: "得意先" };

export default function SalesDashboardClient({
  data,
  availableMonths,
  selectedUntil,
}: {
  data: DashboardData;
  availableMonths: string[];
  selectedUntil: string | null;
}) {
  const S = data.summary;
  const [mainTab, setMainTab] = useState<MainTab>("report");
  const router = useRouter();
  const pathname = usePathname();

  function handleUntilChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    router.push(value === "latest" ? pathname : `${pathname}?until=${value}`);
  }

  return (
    <div className="wrap">
      <header className="top">
        <div className="title">
          <h1>
            売上ダッシュボード <span className="badge-demo">実データ</span>
          </h1>
          <p>
            今期 {S.CUR}年10月度〜(最新 {monL(data.latest_ym)}度まで)
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
            <Link href="/sales/profit" className="ghost-btn-inline">
              売上利益 →
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
          <button className={mainTab === "overview" ? "active" : ""} onClick={() => setMainTab("overview")}>
            全体サマリー
          </button>
          <button className={mainTab === "matrix" ? "active" : ""} onClick={() => setMainTab("matrix")}>
            月別マトリクス
          </button>
          <button className={mainTab === "goal" ? "active" : ""} onClick={() => setMainTab("goal")}>
            目標追跡
          </button>
        </div>
      </header>

      {mainTab === "report" && <ReportPage data={data} />}
      {mainTab === "overview" && <OverviewPage data={data} />}
      {mainTab === "matrix" && <MatrixPage data={data} />}
      {mainTab === "goal" && <GoalPage data={data} />}
      <p className="foot-note">
        実データに基づくダッシュボードです。在庫仕入(拠点90・91の商品別・仕入先別内訳)・不動在庫チェックは「社内DX」メニューでご覧いただけます。
      </p>
    </div>
  );
}

/* ============ 経営レポート(役員向け1画面) ============ */
function ReportPage({ data }: { data: DashboardData }) {
  const S = data.summary;
  const st = data.stock;

  const profitDiff = S.cur_profit_full - S.prev_profit_same;
  const marginDiff = round1(S.cur_margin - S.prev_margin_same);
  const stockDiff = st.cur_total - st.prev_same;
  const marginGap = round1(S.target_margin - S.cur_margin);
  const landingMid = Math.round((S.fc_simple + S.fc_seasonal) / 2);

  const salesUp = S.sales_yoy >= 0;
  const marginUp = marginDiff >= 0;
  const stockUp = stockDiff >= 0;

  const trendConfig = useMemo(() => buildTrendConfig(data, "yoy"), [data]);
  const stockConfig = useMemo(() => buildStockConfig(data), [data]);

  return (
    <div className="page active">
      <div className="card">
        <div className="card-head">
          <h2>総評(最新 {monL(data.latest_ym)}度まで)</h2>
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
        詳しい拠点別・担当者別の内訳は「月別マトリクス」タブ、個別の目標達成状況は「目標追跡」タブでご覧いただけます。在庫仕入の商品別・仕入先別の内訳、不動在庫チェックは「社内DX」メニューにあります。
      </p>
    </div>
  );
}

/* ============ 全体サマリー ============ */
function OverviewPage({ data }: { data: DashboardData }) {
  const S = data.summary;
  const [ovMode, setOvMode] = useState<OvMode>("cur");

  const kpis = useMemo(() => {
    if (ovMode === "cur") {
      const hit = S.cur_margin >= S.target_margin;
      return [
        { label: "今期 売上累計", value: yen(S.cur_sales), foot: `${S.n_sales}ヶ月・昨対${S.sales_yoy >= 0 ? "+" : ""}${S.sales_yoy}%`, primary: true },
        { label: "今期 利益累計", value: yen(S.cur_profit_full), foot: `仕入確定${S.n_full}ヶ月ぶん` },
        {
          label: "粗利率",
          value: `${S.cur_margin}%`,
          foot: `目標${S.target_margin}%`,
          status: hit ? ("hit" as const) : ("miss" as const),
          badge: hit ? "✓ 目標達成" : `目標まで${(S.target_margin - S.cur_margin).toFixed(1)}pt`,
        },
        {
          label: "売上 着地見込み",
          value: `${oku((S.fc_simple + S.fc_seasonal) / 2)}円`,
          foot: `慎重${oku(Math.min(S.fc_simple, S.fc_seasonal))}〜楽観${oku(Math.max(S.fc_simple, S.fc_seasonal))}`,
        },
      ];
    }
    if (ovMode === "prev") {
      return [
        { label: "前期 売上(通期)", value: yen(S.prev_sales_total), foot: "2024年10月〜2025年9月", primary: true },
        { label: "前期 利益(通期)", value: yen(S.prev_profit_total), foot: "12ヶ月" },
        { label: "前期 粗利率", value: `${S.prev_margin}%`, foot: "通期" },
        { label: "前期 月平均売上", value: yen(S.prev_sales_total / 12), foot: "12ヶ月平均" },
      ];
    }
    const mgd = round1(S.cur_margin - S.prev_margin_same);
    const hit = mgd >= 3;
    return [
      { label: "売上 昨対", value: `${S.sales_yoy >= 0 ? "+" : ""}${S.sales_yoy}%`, foot: `今期${oku(S.cur_sales)}/前期${oku(S.prev_sales_same)}`, primary: true },
      { label: "今期 粗利率", value: `${S.cur_margin}%`, foot: `前期同期 ${S.prev_margin_same}%` },
      {
        label: "粗利率 昨対",
        value: `${mgd >= 0 ? "+" : ""}${mgd}pt`,
        foot: "前期同期比",
        status: hit ? ("hit" as const) : ("miss" as const),
        badge: hit ? "✓ +3pt達成" : `+3ptまであと${(3 - mgd).toFixed(1)}pt`,
      },
      { label: "前期同期 売上", value: yen(S.prev_sales_same), foot: `今期と同じ${S.n_sales}ヶ月ぶん` },
    ];
  }, [ovMode, S]);

  const chartConfig = useMemo(() => buildTrendConfig(data, ovMode), [data, ovMode]);

  return (
    <div className="page active">
      <div className="card-head" style={{ padding: "0 0 12px" }}>
        <div className="tabs">
          <button className={ovMode === "cur" ? "active" : ""} onClick={() => setOvMode("cur")}>今期</button>
          <button className={ovMode === "prev" ? "active" : ""} onClick={() => setOvMode("prev")}>前期</button>
          <button className={ovMode === "yoy" ? "active" : ""} onClick={() => setOvMode("yoy")}>昨対</button>
        </div>
      </div>
      <div className="kpi-grid">
        {kpis.map((k, i) => (
          <KpiCard key={i} {...k} />
        ))}
      </div>
      <div className="card">
        <div className="card-head">
          <h2>売上・仕入・利益の月別推移</h2>
        </div>
        <div className="legend">
          {ovMode === "yoy" ? (
            <>
              <span><i className="dot" style={{ background: "#2563d9" }} />今期 売上</span>
              <span><i className="dot" style={{ background: "#9aa3b2" }} />前期 売上</span>
            </>
          ) : (
            <>
              <span><i className="dot" style={{ background: "#2563d9" }} />売上</span>
              <span><i className="dot" style={{ background: "#c3d6f8" }} />仕入</span>
              <span><i className="dot" style={{ background: "#0f9d58" }} />利益</span>
            </>
          )}
        </div>
        <div className="chart-box">
          <TrendChart config={chartConfig} />
        </div>
      </div>

      <h2 className="blk">在庫仕入(拠点90・91)</h2>
      <StockSection data={data} />
    </div>
  );
}

function StockSection({ data }: { data: DashboardData }) {
  const st = data.stock;
  const up = st.yoy_pct != null && st.yoy_pct > 0;
  const chartConfig = useMemo(() => buildStockConfig(data), [data]);
  return (
    <>
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <KpiCard label="今期 在庫仕入(累計)" value={yen(st.cur_total)} foot={`${st.n_cur}ヶ月ぶん`} primary />
        <KpiCard label="前期 同期間" value={yen(st.prev_same)} foot={`前期の同じ${st.n_cur}ヶ月`} />
        <KpiCard
          label="昨対(在庫仕入)"
          value={st.yoy_pct != null ? `${st.yoy_pct >= 0 ? "+" : ""}${st.yoy_pct}%` : "―"}
          foot={up ? "前期より増加(要注意)" : "前期より圧縮"}
          status={up ? "miss" : "hit"}
          badge={up ? "△ 増えています" : "✓ 減っています"}
        />
      </div>
      <div className="card">
        <div className="card-head">
          <h2>在庫仕入の月別推移(今期 vs 前期)</h2>
        </div>
        <div className="legend">
          <span><i className="dot" style={{ background: "#e08a1e" }} />今期 在庫仕入</span>
          <span><i className="dot" style={{ background: "#9aa3b2" }} />前期 在庫仕入</span>
        </div>
        <div className="chart-box">
          <TrendChart config={chartConfig} />
        </div>
      </div>
      <p style={{ fontSize: 11, color: "var(--ink-faint)", padding: "8px 20px 0" }}>
        商品別・仕入先別の詳しい内訳、不動在庫チェックは「社内DX」メニューでご覧いただけます。
      </p>
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
  const [sortKey, setSortKey] = useState<"code" | "name" | "total">("total");
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

  const mergedAll = useMemo<MatrixMergedRow[]>(() => {
    const baseRows = dim === "loc" ? baseSet.loc : dim === "staff" ? baseSet.staff : baseSet.cust;
    const compareRows = compareSet ? (dim === "loc" ? compareSet.loc : dim === "staff" ? compareSet.staff : compareSet.cust) : null;
    const compareByCode = new Map((compareRows ?? []).map((r) => [r.code, r]));

    // 今期(CUR)扱いの年度のときだけ、会社全体でまだ売上が1件も無い月は
    // 仕入だけ先に入っていても計算・表示しない(buildDashboard.ts側で既に抑制済みなので、
    // ここではそのままs/pを使うだけでよい)。
    return baseRows.map((r) => {
      const cmpRow = compareByCode.get(r.code);
      const cells: MonthCellPair[] = r.months.map((c, i) => ({
        base: toMonthCell(c),
        cmp: compareSet ? toMonthCell(cmpRow?.months[i] ?? { s: 0, p: 0 }) : null,
      }));
      const total_s = r.total_s;
      const total_p = r.total_p;
      const total_m = total_s ? Math.round(((total_s - total_p) / total_s) * 1000) / 10 : null;
      const cmp = compareSet
        ? {
            total_s: cmpRow?.total_s ?? 0,
            total_p: cmpRow?.total_p ?? 0,
            total_m: cmpRow && cmpRow.total_s ? Math.round(((cmpRow.total_s - cmpRow.total_p) / cmpRow.total_s) * 1000) / 10 : null,
          }
        : null;
      return { code: r.code, name: r.name, cells, total_s, total_p, total_m, cmp };
    });
  }, [baseSet, compareSet, dim]);

  const rows = useMemo(() => {
    let r = mergedAll;
    if (filter) {
      const f = filter.toLowerCase();
      r = r.filter((row) => (row.name + row.code).toLowerCase().includes(f));
    }
    r = [...r].sort((a, b) => {
      if (sortKey === "code") return sortDir === "asc" ? Number(a.code) - Number(b.code) : Number(b.code) - Number(a.code);
      if (sortKey === "name") return sortDir === "asc" ? a.name.localeCompare(b.name, "ja") : b.name.localeCompare(a.name, "ja");
      return sortDir === "asc" ? a.total_s - b.total_s : b.total_s - a.total_s;
    });
    return r;
  }, [mergedAll, filter, sortKey, sortDir]);

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
      cmp: compareSet ? toMonthCell(colCmpTotals[i]) : null,
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
  const compareLabel = compareSet ? fiscalYearLabel(compareYear as number, CUR) : null;

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
        </div>
        <div className="matwrap">
          <table className="mat">
            <thead>
              <tr>
                <th className="codecol" onClick={() => onSort("code")}>コード</th>
                <th className="namecol" onClick={() => onSort("name")}>{dimName[dim]}</th>
                {baseMonths.map((m) => (
                  <th key={m}>{monL(m)}</th>
                ))}
                <th className="totcol" onClick={() => onSort("total")}>トータル</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td className="codecol">{r.code}</td>
                  <td className="namecol">{r.name}</td>
                  {r.cells.map((c, i) => (
                    <MatrixCell key={i} metric={metric} base={c.base} cmp={c.cmp} compareLabel={compareLabel} />
                  ))}
                  <MatrixTotalCell metric={metric} row={r} compareLabel={compareLabel} />
                </tr>
              ))}
            </tbody>
            <tfoot className="mat-foot">
              <tr>
                <td className="codecol" />
                <td className="namecol">合計</td>
                {grand.cells.map((c, i) => (
                  <MatrixCell key={i} metric={metric} base={c.base} cmp={c.cmp} compareLabel={compareLabel} />
                ))}
                <MatrixTotalCell metric={metric} row={grand} compareLabel={compareLabel} />
              </tr>
            </tfoot>
          </table>
        </div>
        <p style={{ fontSize: 11, color: "var(--ink-faint)", padding: "8px 20px 16px" }}>
          {dim === "cust"
            ? `得意先は売上上位100件(全${baseSet.cust_total_count.toLocaleString()}件)。検索で絞込。`
            : "4つのボタンで表示を切替。粗利率は10%以上=緑/未満=赤。対比期間を選ぶと、トータル列に対比先との差も表示されます。"}
        </p>
      </div>
    </div>
  );
}

function MatrixCell({
  metric,
  base,
  cmp,
  compareLabel,
}: {
  metric: Metric;
  base: MonthCell;
  cmp: MonthCell | null;
  compareLabel: string | null;
}) {
  const isPct = metric === "margin";
  const v = monthMetricValue(metric, base);

  let topEl: React.ReactNode;
  let tdClass = "";
  if (metric === "sales" && base.s === 0 && base.p > 0) {
    topEl = (
      <>
        <span className="cell-s" style={{ color: "#c8ccd4" }}>0</span>
        <span className="cell-m" style={{ color: "#e08a1e" }}>仕{jpn(base.p)}</span>
      </>
    );
  } else if (v == null) {
    topEl = <span className="cell-s" style={{ color: "#c8ccd4" }}>―</span>;
  } else if (metric === "sales" && v === 0) {
    topEl = <span className="cell-s" style={{ color: "#c8ccd4" }}>0</span>;
  } else if (metric === "profit") {
    topEl = <span className={`cell-s ${v >= 0 ? "val-pos" : "val-neg"}`}>{v >= 0 ? "+" : ""}{jpn(v)}</span>;
  } else if (isPct) {
    const good = v >= 10;
    tdClass = good ? "cell-good" : "cell-bad";
    topEl = <span className={`cell-s ${good ? "m-good" : "m-bad"}`}>{v.toFixed(1)}%</span>;
  } else {
    topEl = <span className="cell-s">{jpn(v)}</span>;
  }

  let bottomEl: React.ReactNode = null;
  if (cmp) {
    const cmpV = monthMetricValue(metric, cmp);
    if (v != null && cmpV != null) {
      const d = isPct ? Math.round((v - cmpV) * 10) / 10 : v - cmpV;
      bottomEl = (
        <span className={d >= 0 ? "val-pos" : "val-neg"}>
          {compareLabel} {isPct ? `${cmpV.toFixed(1)}%` : jpn(cmpV)} ({d >= 0 ? "+" : ""}
          {isPct ? `${d}pt` : jpn(d)})
        </span>
      );
    }
  }

  return (
    <td className={tdClass}>
      <div>{topEl}</div>
      {bottomEl && <div style={{ fontSize: 9.5, color: "#9aa3b2", marginTop: 1 }}>{bottomEl}</div>}
    </td>
  );
}

function MatrixTotalCell({
  metric,
  row,
  compareLabel,
}: {
  metric: Metric;
  row: MatrixMergedRow;
  compareLabel: string | null;
}) {
  const v = metricValue(metric, row);
  const isPct = metric === "margin";
  const topEl =
    v == null ? (
      <span className="cell-s">―</span>
    ) : metric === "profit" ? (
      <span className={`cell-s ${v >= 0 ? "val-pos" : "val-neg"}`}>{v >= 0 ? "+" : ""}{jpn(v)}</span>
    ) : isPct ? (
      <span className={`cell-s ${v >= 10 ? "m-good" : "m-bad"}`}>{v.toFixed(1)}%</span>
    ) : (
      <span className="cell-s">{jpn(v)}</span>
    );

  if (!row.cmp) {
    return <td className="totcol">{topEl}</td>;
  }

  const cmpV = metricValue(metric, row.cmp);
  let bottom: React.ReactNode = "―";
  if (v != null && cmpV != null) {
    if (isPct) {
      const d = Math.round((v - cmpV) * 10) / 10;
      bottom = (
        <>
          {compareLabel} {cmpV.toFixed(1)}%
          <span className={d >= 0 ? "val-pos" : "val-neg"}> ({d >= 0 ? "+" : ""}{d}pt)</span>
        </>
      );
    } else {
      const d = v - cmpV;
      bottom = (
        <>
          {compareLabel} {jpn(cmpV)}
          <span className={d >= 0 ? "val-pos" : "val-neg"}> ({d >= 0 ? "+" : ""}{jpn(d)})</span>
        </>
      );
    }
  }

  return (
    <td className="totcol">
      <div>{topEl}</div>
      <div style={{ fontSize: 10, color: "#9aa3b2", marginTop: 2 }}>{bottom}</div>
    </td>
  );
}
/* ============ 目標追跡 ============ */
function GoalPage({ data }: { data: DashboardData }) {
  const S = data.summary;
  const [dim, setDim] = useState<Dim>("loc");
  const [sortKey, setSortKey] = useState<"code" | "name" | "cur_ts" | "diff">("diff");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const rowsAll = dim === "loc" ? data.mat_loc : dim === "staff" ? data.mat_staff : data.mat_cust;

  const rows = useMemo(() => {
    const filtered = rowsAll
      .filter((r) => r.cur_tm != null && r.target != null)
      .map((r) => ({ ...r, diff: round1((r.cur_tm as number) - (r.target as number)) }));
    filtered.sort((a, b) => {
      if (sortKey === "code") return sortDir === "asc" ? Number(a.code) - Number(b.code) : Number(b.code) - Number(a.code);
      if (sortKey === "name") return sortDir === "asc" ? a.name.localeCompare(b.name, "ja") : b.name.localeCompare(a.name, "ja");
      if (sortKey === "cur_ts") return sortDir === "asc" ? a.cur_ts - b.cur_ts : b.cur_ts - a.cur_ts;
      return sortDir === "asc" ? a.diff - b.diff : b.diff - a.diff;
    });
    return filtered;
  }, [rowsAll, sortKey, sortDir]);

  function onSort(k: "code" | "name" | "cur_ts" | "diff") {
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  const hit = S.cur_margin >= S.target_margin;
  const gap = round1(S.target_margin - S.cur_margin);
  const nHit = rows.filter((r) => r.diff >= 0).length;

  return (
    <div className="page active">
      <div className="kpi-grid">
        <KpiCard label="全社 今期粗利率" value={`${S.cur_margin}%`} foot={`${S.n_full}ヶ月累計`} />
        <KpiCard label="全社 目標粗利率" value={`${S.target_margin}%`} foot={`前期${S.prev_margin}% +3pt`} primary />
        <KpiCard
          label="目標との差"
          value={`${gap >= 0 ? "-" : "+"}${Math.abs(gap).toFixed(1)}pt`}
          foot={hit ? "✓ 達成" : `あと${gap.toFixed(1)}pt`}
          status={hit ? "hit" : "miss"}
          badge={hit ? "✓ 達成" : "未達"}
        />
        <KpiCard
          label="昨対(粗利率)"
          value={`${S.cur_margin - S.prev_margin_same >= 0 ? "+" : ""}${round1(S.cur_margin - S.prev_margin_same)}pt`}
          foot={`前期同期 ${S.prev_margin_same}%`}
        />
      </div>
      <div className="card">
        <div className="card-head">
          <div className="tabs">
            {(["loc", "staff", "cust"] as Dim[]).map((d) => (
              <button key={d} className={dim === d ? "active" : ""} onClick={() => setDim(d)}>
                {dimName[d]}別
              </button>
            ))}
          </div>
          <span className="sub">個別目標=各自の前期粗利率 ＋3pt</span>
        </div>
        <div className="matwrap">
          <table className="goaltable">
            <thead>
              <tr>
                <th onClick={() => onSort("code")}>コード</th>
                <th onClick={() => onSort("name")}>{dimName[dim]}</th>
                <th onClick={() => onSort("cur_ts")}>今期売上</th>
                <th>前期粗利率</th>
                <th>目標(+3pt)</th>
                <th>今期粗利率</th>
                <th onClick={() => onSort("diff")}>達成状況</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const hitRow = r.diff >= 0;
                return (
                  <tr key={r.code}>
                    <td className="codecol" style={{ color: "#9aa3b2", fontSize: 11 }}>{r.code}</td>
                    <td>{r.name}</td>
                    <td>{yen(r.cur_ts)}</td>
                    <td>{r.prev_tm}%</td>
                    <td>{r.target}%</td>
                    <td style={{ fontWeight: 700, color: hitRow ? "var(--pos)" : "var(--neg)" }}>{r.cur_tm}%</td>
                    <td>
                      {hitRow ? (
                        <span className="status st-hit">✓ 達成 +{r.diff.toFixed(1)}pt</span>
                      ) : (
                        <span className="status st-miss">未達 {r.diff.toFixed(1)}pt</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11, color: "var(--ink-faint)", padding: "8px 20px 16px" }}>
          {dimName[dim]} {rows.length}件中 {nHit}件が個別目標を達成。未達は赤で表示(達成状況の列で並び替え可)。
        </p>
      </div>
    </div>
  );
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
function buildTrendConfig(data: DashboardData, mode: OvMode) {
  if (mode === "yoy") {
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
  const src = mode === "cur" ? data.trend_cur : data.trend_prev;
  return {
    type: "bar" as const,
    data: {
      labels: src.map((x) => monL(x.ym)),
      datasets: [
        { type: "bar" as const, label: "売上", data: src.map((x) => x.sales), backgroundColor: "#2563d9", borderRadius: 5, barPercentage: 0.62, categoryPercentage: 0.7, order: 2 },
        { type: "bar" as const, label: "仕入", data: src.map((x) => x.pur), backgroundColor: "#c3d6f8", borderRadius: 5, barPercentage: 0.62, categoryPercentage: 0.7, order: 3 },
        { type: "line" as const, label: "利益", data: src.map((x) => x.profit), borderColor: "#0f9d58", borderWidth: 2.5, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, order: 1 },
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
