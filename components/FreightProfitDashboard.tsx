"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { branchLabel } from "@/lib/branch-names";
import { repLabel } from "@/lib/rep-names";
import { periodKeyFor, periodLabelFor, fiscalYearLabel } from "@/lib/period";
import { monL } from "@/lib/format";
import { monthsOfFiscalYear } from "@/lib/fiscal";
import type { FreightMonthCell, FreightYearDimRow } from "@/app/api/freight-profit-matrix/route";
import type { FreightProfitOrderRow } from "@/app/api/freight-profit-order/route";

type Dim = "branch" | "rep" | "customer";
type Metric = "revenue" | "cost" | "profit" | "margin";

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
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState("");

  const [rows, setRows] = useState<FreightYearDimRow[]>([]);
  const [compareRows, setCompareRows] = useState<FreightYearDimRow[] | null>(null);
  const [custTotalCount, setCustTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [orderQuery, setOrderQuery] = useState("");
  const [orderRows, setOrderRows] = useState<FreightProfitOrderRow[] | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  const months = useMemo(() => monthsOfFiscalYear(baseYear), [baseYear]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ year: String(baseYear), dim });
    if (compareYear !== "none") params.set("compareYear", String(compareYear));
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
  }, [baseYear, compareYear, dim]);

  const compareByCode = useMemo(() => new Map((compareRows ?? []).map((r) => [r.code, r])), [compareRows]);

  const filteredRows = useMemo(() => {
    let r = rows;
    if (filter) {
      const f = filter.toLowerCase();
      r = r.filter((row) => (nameOf(dim, row.code, row.name) + row.code).toLowerCase().includes(f));
    }
    return [...r].sort((a, b) => {
      const va = metricOfTotal(metric, a) ?? -Infinity;
      const vb = metricOfTotal(metric, b) ?? -Infinity;
      return sortDir === "asc" ? va - vb : vb - va;
    });
  }, [rows, filter, dim, metric, sortDir]);

  const grandRow = useMemo(() => {
    const monthsTotal: FreightMonthCell[] = Array.from({ length: 12 }, () => ({ s: 0, p: 0, carrier: 0, supplier: 0 }));
    let total_s = 0;
    let total_p = 0;
    for (const r of filteredRows) {
      r.months.forEach((c, i) => {
        monthsTotal[i].s += c.s;
        monthsTotal[i].p += c.p;
        monthsTotal[i].carrier += c.carrier;
        monthsTotal[i].supplier += c.supplier;
      });
      total_s += r.total_s;
      total_p += r.total_p;
    }
    return { code: "", name: "合計", months: monthsTotal, total_s, total_p } as FreightYearDimRow;
  }, [filteredRows]);

  async function searchOrder() {
    const q = orderQuery.trim();
    if (!q) return;
    setOrderLoading(true);
    setOrderError(null);
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

  function downloadCsv() {
    if (filteredRows.length === 0) return;
    const metricLabel = METRIC_TABS.find(([m]) => m === metric)?.[1] ?? "";
    const lines: string[] = [
      ["コード", "名称", ...months.map(monL), "トータル"].map(csvEscape).join(","),
    ];
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

    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `運賃売上仕入_${DIM_LABEL[dim]}_${metricLabel}_${fiscalYearLabel(baseYear)}.csv`;
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
        <h2 style={{ marginTop: 0 }}>受注番号検索</h2>
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
            {orderLoading ? "検索中…" : "検索"}
          </button>
          {orderRows !== null && (
            <span className="result-count">{orderRows.length.toLocaleString("ja-JP")}件ヒット(最大50件)</span>
          )}
        </div>
        {orderError && <p style={{ color: "var(--rk-critical)", marginTop: 8 }}>{orderError}</p>}
        {orderRows !== null && (
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>受注番号</th>
                  <th>月度</th>
                  <th>拠点</th>
                  <th>担当</th>
                  <th>得意先</th>
                  <th>運賃売上</th>
                  <th>仕入先運賃</th>
                  <th>運送会社運賃</th>
                  <th>仕入計</th>
                  <th>粗利</th>
                  <th>運送会社</th>
                </tr>
              </thead>
              <tbody>
                {orderRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="empty-state">
                      該当する受注番号がありません。
                    </td>
                  </tr>
                )}
                {orderRows.map((r) => (
                  <tr key={r.order_no}>
                    <td>{r.order_no}</td>
                    <td>{r.period_end ? periodLabelFor(periodKeyFor(r.period_end)) : "—"}</td>
                    <td>{branchLabel(r.branch_code)}</td>
                    <td>{repLabel(r.rep_code)}</td>
                    <td>{r.customer_name || r.customer_code || "—"}</td>
                    <td className="num">{fmtYen(r.freight_revenue)}</td>
                    <td className="num">{fmtYen(r.supplier_freight_cost)}</td>
                    <td className="num">{fmtYen(r.carrier_freight_cost)}</td>
                    <td className="num">{fmtYen(r.total_freight_cost)}</td>
                    <td className="num">{fmtYen(r.freight_profit)}</td>
                    <td>{r.carriers || "—"}</td>
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
              <button
                key={d}
                className={dim === d ? "active" : ""}
                onClick={() => {
                  setDim(d);
                  setFilter("");
                }}
              >
                {DIM_LABEL[d]}
              </button>
            ))}
          </div>
          {dim === "customer" && (
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
            {METRIC_TABS.map(([m, label]) => (
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
              style={{ fontSize: 12.5, padding: "4px 8px", borderRadius: 6, border: "1px solid #d7dbe2" }}
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
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
              style={{ fontSize: 12.5, padding: "4px 8px", borderRadius: 6, border: "1px solid #d7dbe2" }}
            >
              <option value="desc">トータル(多い順)</option>
              <option value="asc">トータル(少ない順)</option>
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
        ) : (
          <div className="matwrap">
            <table className="mat">
              <thead>
                <tr>
                  <th className="codecol">コード</th>
                  <th className="namecol">{DIM_LABEL[dim].replace("別", "")}</th>
                  {months.map((m) => (
                    <th key={m}>{monL(m)}</th>
                  ))}
                  <th className="totcol">トータル</th>
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
                      <td className="codecol">{r.code || "—"}</td>
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
