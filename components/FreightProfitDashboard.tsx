"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { branchLabel, BRANCH_NAMES } from "@/lib/branch-names";
import { repLabel, REP_NAMES } from "@/lib/rep-names";
import { periodKeyFor, periodLabelFor, periodRangeFor, fiscalYearLabel, fiscalYearPeriods } from "@/lib/period";
import { monL } from "@/lib/format";
import { monthsOfFiscalYear } from "@/lib/fiscal";
import type { FreightMonthCell, FreightYearDimRow } from "@/app/api/freight-profit-matrix/route";
import type { FreightProfitOrderRow } from "@/app/api/freight-profit-order/route";
import type { RepBranchPair } from "@/app/api/freight-profit-rep-branches/route";

type Dim = "branch" | "rep" | "customer";
type Metric = "revenue" | "cost" | "profit" | "margin";
// "total"は今表示中の指標(タブ)で並べる。"sales"/"profitAmt"は表示中のタブに関係なく
// 常に運賃売上・粗利額で並べる。
type SortKey = "code" | "name" | "total" | "sales" | "profitAmt";

const DIM_LABEL: Record<Dim, string> = { branch: "拠点別", rep: "担当別", customer: "得意先別" };
const METRIC_TABS: [Metric, string][] = [
  ["revenue", "運賃売上"],
  ["cost", "仕入計"],
  ["profit", "粗利額"],
  ["margin", "粗利率"],
];

function fmtYen(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `¥${Math.round(v).toLocaleString("ja-JP")}`;
}

function jpn(v: number) {
  return Math.round(v).toLocaleString("ja-JP");
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function metricOfCell(metric: Metric, c: FreightMonthCell): number | null {
  if (metric === "revenue") return c.s;
  if (metric === "cost") return c.p;
  if (metric === "profit") return c.s - c.p;
  return c.s ? Math.round(((c.s - c.p) / c.s) * 1000) / 10 : null;
}

function metricOfTotal(metric: Metric, r: FreightYearDimRow): number | null {
  if (metric === "revenue") return r.total_s;
  if (metric === "cost") return r.total_p;
  if (metric === "profit") return r.total_s - r.total_p;
  return r.total_s ? Math.round(((r.total_s - r.total_p) / r.total_s) * 1000) / 10 : null;
}

function nameOf(dim: Dim, code: string, name: string): string {
  if (dim === "branch") return branchLabel(code);
  if (dim === "rep") return repLabel(code);
  return name || code || "(不明)";
}

export default function FreightProfitDashboard({ availableYears }: { availableYears: number[] }) {
  const latestYear = availableYears[0];
  const [baseYear, setBaseYear] = useState<number>(latestYear);
  const [compareYear, setCompareYear] = useState<number | "none">("none");
  const [dim, setDim] = useState<Dim>("branch");
  const [metric, setMetric] = useState<Metric>("revenue");
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // 表示軸(拠点別/担当別/得意先別)とは別に、拠点・担当・得意先・月で絞り込む。
  // 例: 拠点=大阪・月=8月で絞り込みつつ、担当別に表示する、といった使い方ができる。
  const [branchFilter, setBranchFilter] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState(""); // period_end("YYYY-MM-DD")。空=年間通して。

  const [rows, setRows] = useState<FreightYearDimRow[]>([]);
  const [compareRows, setCompareRows] = useState<FreightYearDimRow[] | null>(null);
  const [custTotalCount, setCustTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [orderQuery, setOrderQuery] = useState("");
  const [orderRows, setOrderRows] = useState<FreightProfitOrderRow[] | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderTruncated, setOrderTruncated] = useState(false);

  // 拠点×担当の実在する組み合わせ(担当プルダウンを選択中の拠点だけに絞り込むため)。
  const [repBranchPairs, setRepBranchPairs] = useState<RepBranchPair[]>([]);
  useEffect(() => {
    fetch("/api/freight-profit-rep-branches")
      .then((res) => res.json())
      .then((json) => setRepBranchPairs(json.pairs ?? []))
      .catch(() => {});
  }, []);

  // 選択中の拠点に実在する担当コードだけに絞った一覧(拠点未選択なら全担当)。
  const repCodesForBranch = useMemo(() => {
    if (!branchFilter) return Object.keys(REP_NAMES);
    const set = new Set(repBranchPairs.filter((p) => p.branch_code === branchFilter).map((p) => p.rep_code));
    return Object.keys(REP_NAMES).filter((code) => set.has(code));
  }, [branchFilter, repBranchPairs]);

  // 拠点を変更して、選択中の担当がその拠点に存在しなくなったら選択を解除する。
  useEffect(() => {
    if (repFilter && !repCodesForBranch.includes(repFilter)) {
      setRepFilter("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter]);

  function clearFilters() {
    setBranchFilter("");
    setRepFilter("");
    setCustomerFilter("");
    setMonthFilter("");
  }

  function selectCustomerFilter(code: string | null | undefined) {
    if (!code) return;
    setCustomerFilter(code);
  }

  const months = useMemo(() => monthsOfFiscalYear(baseYear), [baseYear]);
  // 月選択プルダウン用。period_end("YYYY-MM-DD")のリスト(表示期間の会計年度12ヶ月分)。
  const monthPeriodEnds = useMemo(() => fiscalYearPeriods(baseYear).map((k) => periodRangeFor(k).to), [baseYear]);

  // 得意先トップ100の選び方を、画面の「並び順」と連動させる。これにより例えば
  // 「粗利額の低い順」を選ぶと、運賃売上0円で仕入だけ計上されている(=運賃売上順の
  // トップ100には出てこない)得意先も拾えるようになる。
  const capMetric: Metric = sortKey === "sales" ? "revenue" : sortKey === "profitAmt" ? "profit" : metric;
  const capDir: "asc" | "desc" = sortKey === "code" || sortKey === "name" ? "desc" : sortDir;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ year: String(baseYear), dim, capMetric, capDir });
    if (compareYear !== "none") params.set("compareYear", String(compareYear));
    if (monthFilter) params.set("month", monthFilter);
    if (branchFilter) params.set("branch", branchFilter);
    if (repFilter) params.set("rep", repFilter);
    if (customerFilter.trim()) params.set("customer", customerFilter.trim());
    fetch(`/api/freight-profit-matrix?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setRows([]);
          setCompareRows(null);
        } else {
          setRows(json.rows ?? []);
          setCompareRows(json.compareRows ?? null);
          setCustTotalCount(json.custTotalCount ?? null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [baseYear, compareYear, dim, monthFilter, branchFilter, repFilter, customerFilter, capMetric, capDir]);

  const compareByCode = useMemo(() => new Map((compareRows ?? []).map((r) => [r.code, r])), [compareRows]);

  const filteredRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sortKey === "code") {
        const na = Number(a.code);
        const nb = Number(b.code);
        const cmp =
          Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.code.localeCompare(b.code, "ja");
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "name") {
        const cmp = nameOf(dim, a.code, a.name).localeCompare(nameOf(dim, b.code, b.name), "ja");
        return sortDir === "asc" ? cmp : -cmp;
      }
      const sortMetric: Metric = sortKey === "sales" ? "revenue" : sortKey === "profitAmt" ? "profit" : metric;
      const va = metricOfTotal(sortMetric, a) ?? -Infinity;
      const vb = metricOfTotal(sortMetric, b) ?? -Infinity;
      return sortDir === "asc" ? va - vb : vb - va;
    });
  }, [rows, dim, metric, sortKey, sortDir]);

  function onSort(k: "code" | "name" | "total") {
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "code" || k === "name" ? "asc" : "desc");
    }
  }

  const grandRow = useMemo(() => {
    const monthsTotal: FreightMonthCell[] = Array.from({ length: 12 }, () => ({ s: 0, p: 0, carrier: 0, supplier: 0 }));
    let total_s = 0;
    let total_p = 0;
    let total_supplier = 0;
    let total_carrier = 0;
    let order_count = 0;
    for (const r of filteredRows) {
      r.months.forEach((c, i) => {
        monthsTotal[i].s += c.s;
        monthsTotal[i].p += c.p;
        monthsTotal[i].carrier += c.carrier;
        monthsTotal[i].supplier += c.supplier;
      });
      total_s += r.total_s;
      total_p += r.total_p;
      total_supplier += r.total_supplier;
      total_carrier += r.total_carrier;
      order_count += r.order_count;
    }
    return { code: "", name: "合計", months: monthsTotal, total_s, total_p, total_supplier, total_carrier, order_count };
  }, [filteredRows]);

  async function searchOrder() {
    const q = orderQuery.trim();
    if (!q) return;
    setOrderLoading(true);
    setOrderError(null);
    setOrderTruncated(false);
    try {
      const res = await fetch(`/api/freight-profit-order?order_no=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (json.error) {
        setOrderError(json.error);
        setOrderRows(null);
      } else {
        setOrderRows(json.rows ?? []);
      }
    } catch (e) {
      setOrderError(String(e));
    } finally {
      setOrderLoading(false);
    }
  }

  // 現在の絞り込み条件(拠点・担当・得意先・月)に一致する受注の一覧を表示する。
  // 各担当にそのまま渡せるレベルの受注明細として使うことを想定(月の指定が必須)。
  async function listOrdersByFilter() {
    if (!monthFilter) return;
    setOrderLoading(true);
    setOrderError(null);
    setOrderQuery("");
    try {
      const params = new URLSearchParams({ month: monthFilter });
      if (branchFilter) params.set("branch", branchFilter);
      if (repFilter) params.set("rep", repFilter);
      if (customerFilter.trim()) params.set("customer", customerFilter.trim());
      const res = await fetch(`/api/freight-profit-order?${params.toString()}`);
      const json = await res.json();
      if (json.error) {
        setOrderError(json.error);
        setOrderRows(null);
      } else {
        setOrderRows(json.rows ?? []);
        setOrderTruncated(!!json.truncated);
      }
    } catch (e) {
      setOrderError(String(e));
    } finally {
      setOrderLoading(false);
    }
  }

  function downloadOrderCsv() {
    if (!orderRows || orderRows.length === 0) return;
    const lines: string[] = [
      ["受注番号", "月度", "拠点", "担当", "得意先コード", "得意先", "運賃売上", "仕入先運賃", "運送会社運賃", "仕入計", "粗利", "運送会社"]
        .map(csvEscape)
        .join(","),
    ];
    orderRows.forEach((r) => {
      lines.push(
        [
          r.order_no,
          r.period_end ? periodLabelFor(periodKeyFor(r.period_end)) : "",
          branchLabel(r.branch_code),
          repLabel(r.rep_code),
          r.customer_code ?? "",
          r.customer_name ?? "",
          Math.round(r.freight_revenue),
          Math.round(r.supplier_freight_cost),
          Math.round(r.carrier_freight_cost),
          Math.round(r.total_freight_cost),
          Math.round(r.freight_profit),
          r.carriers ?? "",
        ]
          .map(csvEscape)
          .join(",")
      );
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const periodLabel = monthFilter ? periodLabelFor(periodKeyFor(monthFilter)) : "検索結果";
    const filterSuffix = [branchFilter && branchLabel(branchFilter), repFilter && repLabel(repFilter)]
      .filter(Boolean)
      .join("_");
    a.download = `運賃_受注明細_${periodLabel}${filterSuffix ? "_" + filterSuffix : ""}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadCsv() {
    if (filteredRows.length === 0) return;
    const metricLabel = METRIC_TABS.find(([m]) => m === metric)?.[1] ?? "";
    const lines: string[] = [];

    if (monthFilter) {
      // 月で絞り込んでいる時は、画面と同じ単月の内訳(各指標)をそのまま出す。
      lines.push(
        ["コード", "名称", "運賃売上", "仕入先運賃", "運送会社運賃", "仕入計", "粗利", "粗利率", "件数"]
          .map(csvEscape)
          .join(",")
      );
      const rateOf = (s: number, p: number) => (s ? `${(((s - p) / s) * 100).toFixed(1)}%` : "");
      filteredRows.forEach((r) => {
        lines.push(
          [
            r.code,
            nameOf(dim, r.code, r.name),
            Math.round(r.total_s),
            Math.round(r.total_supplier),
            Math.round(r.total_carrier),
            Math.round(r.total_p),
            Math.round(r.total_s - r.total_p),
            rateOf(r.total_s, r.total_p),
            r.order_count,
          ]
            .map(csvEscape)
            .join(",")
        );
      });
      lines.push(
        [
          "",
          "合計",
          Math.round(grandRow.total_s),
          Math.round(grandRow.total_supplier),
          Math.round(grandRow.total_carrier),
          Math.round(grandRow.total_p),
          Math.round(grandRow.total_s - grandRow.total_p),
          rateOf(grandRow.total_s, grandRow.total_p),
          grandRow.order_count,
        ]
          .map(csvEscape)
          .join(",")
      );
    } else {
      lines.push(["コード", "名称", ...months.map(monL), "トータル"].map(csvEscape).join(","));
      filteredRows.forEach((r) => {
        lines.push(
          [
            r.code,
            nameOf(dim, r.code, r.name),
            ...r.months.map((c) => metricOfCell(metric, c) ?? ""),
            metricOfTotal(metric, r) ?? "",
          ]
            .map(csvEscape)
            .join(",")
        );
      });
      lines.push(
        [
          "",
          "合計",
          ...grandRow.months.map((c) => metricOfCell(metric, c) ?? ""),
          metricOfTotal(metric, grandRow) ?? "",
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const periodLabel = monthFilter ? periodLabelFor(periodKeyFor(monthFilter)) : fiscalYearLabel(baseYear);
    const filterSuffix = [
      branchFilter && branchLabel(branchFilter),
      repFilter && repLabel(repFilter),
      customerFilter.trim(),
    ]
      .filter(Boolean)
      .join("_");
    a.download = `運賃売上仕入_${DIM_LABEL[dim]}_${metricLabel}_${periodLabel}${filterSuffix ? "_" + filterSuffix : ""}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function renderCell(base: FreightMonthCell, cmp: FreightMonthCell | undefined) {
    const isPct = metric === "margin";
    const v = metricOfCell(metric, base);
    if (compareYear !== "none") {
      const cv = cmp ? metricOfCell(metric, cmp) : 0;
      if (v === null || cv === null) return <td><span className="cell-s" style={{ color: "#c8ccd4" }}>―</span></td>;
      const d = isPct ? Math.round((v - cv) * 10) / 10 : v - cv;
      return (
        <td>
          <span className={`cell-s ${d >= 0 ? "val-pos" : "val-neg"}`}>
            {d >= 0 ? "+" : ""}
            {isPct ? `${d}pt` : jpn(d)}
          </span>
        </td>
      );
    }
    if (v === null) return <td><span className="cell-s" style={{ color: "#c8ccd4" }}>―</span></td>;
    if (metric === "profit") {
      return <td><span className={`cell-s ${v >= 0 ? "val-pos" : "val-neg"}`}>{v >= 0 ? "+" : ""}{jpn(v)}</span></td>;
    }
    if (isPct) {
      const good = v >= 0;
      return (
        <td className={good ? "cell-good" : "cell-bad"}>
          <span className={`cell-s ${good ? "m-good" : "m-bad"}`}>{v.toFixed(1)}%</span>
        </td>
      );
    }
    return <td><span className="cell-s">{jpn(v)}</span></td>;
  }

  function renderTotalCell(r: FreightYearDimRow) {
    const isPct = metric === "margin";
    const v = metricOfTotal(metric, r);
    if (compareYear !== "none") {
      const cmp = compareByCode.get(r.code);
      const cv = cmp ? metricOfTotal(metric, cmp) : 0;
      if (v === null || cv === null) return <td className="totcol"><span className="cell-s">―</span></td>;
      const d = isPct ? Math.round((v - cv) * 10) / 10 : v - cv;
      return (
        <td className="totcol">
          <span className={`cell-s ${d >= 0 ? "val-pos" : "val-neg"}`}>
            {d >= 0 ? "+" : ""}
            {isPct ? `${d}pt` : jpn(d)}
          </span>
        </td>
      );
    }
    if (v === null) return <td className="totcol"><span className="cell-s">―</span></td>;
    if (metric === "profit") {
      return <td className="totcol"><span className={`cell-s ${v >= 0 ? "val-pos" : "val-neg"}`}>{v >= 0 ? "+" : ""}{jpn(v)}</span></td>;
    }
    if (isPct) {
      return <td className="totcol"><span className={`cell-s ${v >= 0 ? "m-good" : "m-bad"}`}>{v.toFixed(1)}%</span></td>;
    }
    return <td className="totcol"><span className="cell-s">{jpn(v)}</span></td>;
  }

  return (
    <div className="wrap" style={{ maxWidth: 1400 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>運賃 売上・仕入</h1>
          <p>
            品番コード99(運賃)の売上を、仕入先運賃(purchases)・運送会社運賃(西濃・福山などの実費)の両方と
            受注番号(伝票)単位で突き合わせたうえで、月別マトリクスで確認します。
          </p>
        </div>
        <Link href="/dx" className="ghost-btn-inline">
          ← 社内DXメニュー
        </Link>
      </header>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>受注明細(受注番号単位)</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="受注番号(部分一致)"
            value={orderQuery}
            onChange={(e) => setOrderQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchOrder()}
            style={{ padding: "6px 10px", border: "1px solid var(--rk-border)", borderRadius: 6, minWidth: 220 }}
          />
          <button className="ghost-btn" onClick={searchOrder} disabled={!orderQuery.trim() || orderLoading}>
            {orderLoading ? "検索中…" : "番号で検索"}
          </button>
          <span className="cell-sub">または</span>
          <button className="ghost-btn" onClick={listOrdersByFilter} disabled={!monthFilter || orderLoading}>
            {orderLoading ? "取得中…" : "上の絞り込み条件(拠点・担当・得意先・月)で一覧表示"}
          </button>
          {!monthFilter && <span className="cell-sub">※一覧表示には「月で絞込」の指定が必要です</span>}
          {orderRows !== null && (
            <>
              <span className="result-count">
                {orderRows.length.toLocaleString("ja-JP")}件{orderTruncated ? "(上限到達・絞り込みを追加してください)" : ""}
              </span>
              <button className="ghost-btn" onClick={downloadOrderCsv} disabled={orderRows.length === 0}>
                この受注明細をCSVでダウンロード
              </button>
            </>
          )}
        </div>
        {orderError && <p style={{ color: "var(--rk-critical)", marginTop: 8 }}>{orderError}</p>}
        {orderRows !== null && (
          <div className="matwrap">
            <table className="goaltable">
              <thead>
                <tr>
                  <th>受注番号</th>
                  <th style={{ textAlign: "left" }}>月度</th>
                  <th style={{ textAlign: "left" }}>拠点</th>
                  <th style={{ textAlign: "left" }}>担当</th>
                  <th style={{ textAlign: "left" }}>得意先</th>
                  <th>運賃売上</th>
                  <th>仕入先運賃</th>
                  <th>運送会社運賃</th>
                  <th>仕入計</th>
                  <th>粗利</th>
                  <th style={{ textAlign: "left" }}>運送会社</th>
                </tr>
              </thead>
              <tbody>
                {orderRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="empty-state">
                      該当する受注がありません。
                    </td>
                  </tr>
                )}
                {orderRows.map((r) => (
                  <tr key={r.order_no}>
                    <td>{r.order_no}</td>
                    <td style={{ textAlign: "left" }}>
                      {r.period_end ? periodLabelFor(periodKeyFor(r.period_end)) : "—"}
                    </td>
                    <td style={{ textAlign: "left" }}>{branchLabel(r.branch_code)}</td>
                    <td style={{ textAlign: "left" }}>{repLabel(r.rep_code)}</td>
                    <td
                      style={{ textAlign: "left", cursor: r.customer_code ? "pointer" : undefined }}
                      title={r.customer_code ? "クリックで得意先検索窓に入力" : undefined}
                      onClick={() => selectCustomerFilter(r.customer_code)}
                    >
                      {r.customer_name || r.customer_code || "—"}
                    </td>
                    <td>{fmtYen(r.freight_revenue)}</td>
                    <td>{fmtYen(r.supplier_freight_cost)}</td>
                    <td>{fmtYen(r.carrier_freight_cost)}</td>
                    <td>{fmtYen(r.total_freight_cost)}</td>
                    <td>{fmtYen(r.freight_profit)}</td>
                    <td style={{ textAlign: "left" }}>{r.carriers || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="tabs">
            {(["branch", "rep", "customer"] as Dim[]).map((d) => (
              <button key={d} className={dim === d ? "active" : ""} onClick={() => setDim(d)}>
                {DIM_LABEL[d]}
              </button>
            ))}
          </div>
        </div>
        <div className="card-head" style={{ paddingTop: 0 }}>
          <div className="tabs">
            {METRIC_TABS.map(([m, label]) => (
              <button key={m} className={metric === m ? "active" : ""} onClick={() => setMetric(m)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="card-head" style={{ paddingTop: 0, flexWrap: "wrap", gap: 16 }}>
          <label style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
            拠点で絞込:
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              style={{ fontSize: 12.5 }}
            >
              <option value="">全拠点</option>
              {Object.keys(BRANCH_NAMES).map((code) => (
                <option key={code} value={code}>
                  {branchLabel(code)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
            担当で絞込:
            <select
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
              style={{ fontSize: 12.5 }}
            >
              <option value="">全担当</option>
              {repCodesForBranch.map((code) => (
                <option key={code} value={code}>
                  {repLabel(code)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
            得意先で絞込:
            <input
              type="text"
              placeholder="名前・コードで検索(表の得意先コードクリックでも入力可)"
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              style={{ fontSize: 12.5, minWidth: 220 }}
            />
          </label>
          <label style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
            月で絞込:
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              style={{ fontSize: 12.5 }}
            >
              <option value="">年間(12ヶ月)</option>
              {monthPeriodEnds.map((p) => (
                <option key={p} value={p}>
                  {periodLabelFor(periodKeyFor(p))}
                </option>
              ))}
            </select>
          </label>
          <button
            className="ghost-btn"
            onClick={clearFilters}
            disabled={!branchFilter && !repFilter && !customerFilter && !monthFilter}
          >
            絞り込みをクリア
          </button>
        </div>
        <div className="card-head" style={{ paddingTop: 0, flexWrap: "wrap", gap: 16 }}>
          <label style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
            表示期間:
            <select
              value={baseYear}
              onChange={(e) => setBaseYear(Number(e.target.value))}
              style={{ fontSize: 12.5 }}
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {fiscalYearLabel(y)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
            対比期間:
            <select
              value={compareYear}
              onChange={(e) => setCompareYear(e.target.value === "none" ? "none" : Number(e.target.value))}
              style={{ fontSize: 12.5 }}
            >
              <option value="none">対比なし</option>
              {availableYears.map((y) => (
                <option key={y} value={y} disabled={y === baseYear}>
                  {fiscalYearLabel(y)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
            並び順:
            <select
              value={`${sortKey}_${sortDir}`}
              onChange={(e) => {
                const [k, d] = e.target.value.split("_") as [SortKey, "asc" | "desc"];
                setSortKey(k);
                setSortDir(d);
              }}
              style={{ fontSize: 12.5 }}
            >
              <option value="total_desc">トータル(表示中の指標・多い順)</option>
              <option value="total_asc">トータル(表示中の指標・少ない順)</option>
              <option value="sales_desc">運賃売上(多い順)</option>
              <option value="profitAmt_desc">粗利額(多い順)</option>
              <option value="profitAmt_asc">粗利額(低い順)</option>
              <option value="code_asc">コード順</option>
              <option value="name_asc">{DIM_LABEL[dim].replace("別", "")}名(あいうえお順)</option>
            </select>
          </label>
          <button className="ghost-btn" onClick={downloadCsv} disabled={filteredRows.length === 0}>
            この{DIM_LABEL[dim]}結果をCSVでダウンロード
          </button>
        </div>

        {loading ? (
          <p className="cell-sub" style={{ padding: "0 20px 20px" }}>
            読み込み中…
          </p>
        ) : error ? (
          <p style={{ color: "var(--rk-critical)", padding: "0 20px 20px" }}>{error}</p>
        ) : monthFilter ? (
          // 月で絞り込んでいる時は、12ヶ月の列が1列しか埋まらず見づらいため、
          // 単月の内訳(運賃売上・仕入先運賃・運送会社運賃・仕入計・粗利・件数)を
          // シンプルな一覧で表示する。
          <div className="matwrap">
            <table className="goaltable">
              <thead>
                <tr>
                  <th onClick={() => onSort("code")} style={{ cursor: "pointer" }}>
                    コード{sortKey === "code" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                  <th onClick={() => onSort("name")} style={{ cursor: "pointer" }}>
                    {DIM_LABEL[dim].replace("別", "")}{sortKey === "name" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                  <th>運賃売上</th>
                  <th>仕入先運賃</th>
                  <th>運送会社運賃</th>
                  <th>仕入計</th>
                  <th onClick={() => onSort("total")} style={{ cursor: "pointer" }}>
                    粗利{sortKey === "total" || sortKey === "profitAmt" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                  <th>粗利率</th>
                  <th>件数</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="empty-state">
                      この条件に一致するデータはありません。
                    </td>
                  </tr>
                )}
                {filteredRows.map((r) => (
                  <tr key={r.code || "unknown"}>
                    <td
                      style={dim === "customer" ? { cursor: "pointer" } : undefined}
                      title={dim === "customer" ? "クリックで得意先検索窓に入力" : undefined}
                      onClick={() => dim === "customer" && selectCustomerFilter(r.code)}
                    >
                      {r.code || "—"}
                    </td>
                    <td>{nameOf(dim, r.code, r.name)}</td>
                    <td className="num">{fmtYen(r.total_s)}</td>
                    <td className="num">{fmtYen(r.total_supplier)}</td>
                    <td className="num">{fmtYen(r.total_carrier)}</td>
                    <td className="num">{fmtYen(r.total_p)}</td>
                    <td className="num">{fmtYen(r.total_s - r.total_p)}</td>
                    <td>{r.total_s ? `${(((r.total_s - r.total_p) / r.total_s) * 100).toFixed(1)}%` : "—"}</td>
                    <td className="num">{r.order_count.toLocaleString("ja-JP")}</td>
                  </tr>
                ))}
              </tbody>
              {filteredRows.length > 0 && (
                <tfoot>
                  <tr style={{ fontWeight: 600 }}>
                    <td colSpan={2}>合計</td>
                    <td className="num">{fmtYen(grandRow.total_s)}</td>
                    <td className="num">{fmtYen(grandRow.total_supplier)}</td>
                    <td className="num">{fmtYen(grandRow.total_carrier)}</td>
                    <td className="num">{fmtYen(grandRow.total_p)}</td>
                    <td className="num">{fmtYen(grandRow.total_s - grandRow.total_p)}</td>
                    <td>
                      {grandRow.total_s
                        ? `${(((grandRow.total_s - grandRow.total_p) / grandRow.total_s) * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="num">{grandRow.order_count.toLocaleString("ja-JP")}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          <div className="matwrap">
            <table className="mat">
              <thead>
                <tr>
                  <th className="codecol" onClick={() => onSort("code")}>
                    コード{sortKey === "code" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                  <th className="namecol" onClick={() => onSort("name")}>
                    {DIM_LABEL[dim].replace("別", "")}{sortKey === "name" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                  {months.map((m) => (
                    <th key={m}>{monL(m)}</th>
                  ))}
                  <th className="totcol" onClick={() => onSort("total")}>
                    トータル{sortKey === "total" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={15} className="empty-state">
                      この条件に一致するデータはありません。
                    </td>
                  </tr>
                )}
                {filteredRows.map((r) => {
                  const cmp = compareByCode.get(r.code);
                  return (
                    <tr key={r.code || "unknown"}>
                      <td
                        className="codecol"
                        style={dim === "customer" ? { cursor: "pointer" } : undefined}
                        title={dim === "customer" ? "クリックで得意先検索窓に入力" : undefined}
                        onClick={() => dim === "customer" && selectCustomerFilter(r.code)}
                      >
                        {r.code || "—"}
                      </td>
                      <td className="namecol">{nameOf(dim, r.code, r.name)}</td>
                      {r.months.map((c, i) => (
                        <Fragment key={i}>{renderCell(c, cmp?.months[i])}</Fragment>
                      ))}
                      {renderTotalCell(r)}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="mat-foot">
                <tr>
                  <td className="codecol" />
                  <td className="namecol">合計</td>
                  {grandRow.months.map((c, i) => {
                    const cmpTotal = compareRows
                      ? compareRows.reduce(
                          (acc, r) => {
                            acc.s += r.months[i]?.s ?? 0;
                            acc.p += r.months[i]?.p ?? 0;
                            acc.carrier += r.months[i]?.carrier ?? 0;
                            acc.supplier += r.months[i]?.supplier ?? 0;
                            return acc;
                          },
                          { s: 0, p: 0, carrier: 0, supplier: 0 } as FreightMonthCell
                        )
                      : undefined;
                    return <Fragment key={i}>{renderCell(c, cmpTotal)}</Fragment>;
                  })}
                  {renderTotalCell(grandRow)}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p style={{ fontSize: 11, color: "var(--ink-faint)", padding: "8px 20px 16px" }}>
          {dim === "customer"
            ? `得意先は運賃売上上位100件(全${(custTotalCount ?? 0).toLocaleString()}件)。検索で絞込。`
            : "4つのボタンで表示を切替。対比期間を選ぶと、各セルに対比先との差額を表示します。"}
        </p>
      </div>
    </div>
  );
}
