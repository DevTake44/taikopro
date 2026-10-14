"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { branchLabel } from "@/lib/branch-names";
import { repLabel } from "@/lib/rep-names";
import { periodKeyFor, periodLabelFor } from "@/lib/period";
import type { FreightProfitBreakdownRow } from "@/app/api/freight-profit-breakdown/route";
import type { FreightProfitOrderRow } from "@/app/api/freight-profit-order/route";

type Dim = "branch" | "rep" | "customer";

const DIM_LABEL: Record<Dim, string> = { branch: "拠点別", rep: "担当別", customer: "得意先別" };

function fmtYen(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `¥${Math.round(v).toLocaleString("ja-JP")}`;
}

function fmtRate(revenue: number, profit: number): string {
  if (!revenue) return "—";
  return `${((profit / revenue) * 100).toFixed(1)}%`;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function labelFor(dim: Dim, r: FreightProfitBreakdownRow): string {
  if (dim === "branch") return branchLabel(r.branch_code);
  if (dim === "rep") return repLabel(r.rep_code);
  return r.customer_name || r.customer_code || "(不明)";
}

function codeFor(dim: Dim, r: FreightProfitBreakdownRow): string {
  if (dim === "branch") return r.branch_code ?? "";
  if (dim === "rep") return r.rep_code ?? "";
  return r.customer_code ?? "";
}

export default function FreightProfitDashboard({ availablePeriods }: { availablePeriods: string[] }) {
  // 月(period_end、20日締め)の選択。既定は最新月。
  const [periodKey, setPeriodKey] = useState<string>(() => availablePeriods[0] ?? "");
  const [dim, setDim] = useState<Dim>("branch");
  const [rows, setRows] = useState<FreightProfitBreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [orderQuery, setOrderQuery] = useState("");
  const [orderRows, setOrderRows] = useState<FreightProfitOrderRow[] | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const periodParam = periodKey || "all";
    fetch(`/api/freight-profit-breakdown?period=${encodeURIComponent(periodParam)}&dim=${dim}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setRows([]);
        } else {
          setRows(json.rows ?? []);
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
  }, [periodKey, dim]);

  const sortedRows = useMemo(() => [...rows].sort((a, b) => b.freight_revenue - a.freight_revenue), [rows]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        freight_revenue: acc.freight_revenue + r.freight_revenue,
        supplier_freight_cost: acc.supplier_freight_cost + r.supplier_freight_cost,
        carrier_freight_cost: acc.carrier_freight_cost + r.carrier_freight_cost,
        total_freight_cost: acc.total_freight_cost + r.total_freight_cost,
        freight_profit: acc.freight_profit + r.freight_profit,
        order_count: acc.order_count + r.order_count,
      }),
      {
        freight_revenue: 0,
        supplier_freight_cost: 0,
        carrier_freight_cost: 0,
        total_freight_cost: 0,
        freight_profit: 0,
        order_count: 0,
      }
    );
  }, [rows]);

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
    if (sortedRows.length === 0) return;
    const periodLabel = periodKey ? periodLabelFor(periodKeyFor(periodKey)) : "全期間";
    const lines: string[] = [
      ["コード", "名称", "運賃売上", "仕入先運賃", "運送会社運賃", "仕入計", "粗利", "粗利率", "件数"]
        .map(csvEscape)
        .join(","),
    ];
    sortedRows.forEach((r) => {
      lines.push(
        [
          codeFor(dim, r),
          labelFor(dim, r),
          Math.round(r.freight_revenue),
          Math.round(r.supplier_freight_cost),
          Math.round(r.carrier_freight_cost),
          Math.round(r.total_freight_cost),
          Math.round(r.freight_profit),
          fmtRate(r.freight_revenue, r.freight_profit),
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
        Math.round(totals.freight_revenue),
        Math.round(totals.supplier_freight_cost),
        Math.round(totals.carrier_freight_cost),
        Math.round(totals.total_freight_cost),
        Math.round(totals.freight_profit),
        fmtRate(totals.freight_revenue, totals.freight_profit),
        totals.order_count,
      ]
        .map(csvEscape)
        .join(",")
    );

    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `運賃売上仕入_${DIM_LABEL[dim]}_${periodLabel}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="wrap" style={{ maxWidth: 1200 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>運賃 売上・仕入</h1>
          <p>
            品番コード99(運賃)の売上を、仕入先運賃(purchases)・運送会社運賃(西濃・福山などの実費)の両方と
            受注番号(伝票)単位で突き合わせたうえで、月単位・拠点別・担当別・得意先別に確認します。
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

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>絞り込み</h2>
        <div className="filter-row">
          <div className="filter-field" style={{ gridColumn: "span 3" }}>
            <label>月(20日締め)</label>
            <div className="segmented">
              <button type="button" className={periodKey === "" ? "active" : ""} onClick={() => setPeriodKey("")}>
                全期間
              </button>
              {availablePeriods.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={periodKey === p ? "active" : ""}
                  onClick={() => setPeriodKey(p)}
                >
                  {periodLabelFor(periodKeyFor(p))}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-field">
            <label>表示軸</label>
            <div className="segmented">
              {(["branch", "rep", "customer"] as Dim[]).map((d) => (
                <button key={d} type="button" className={dim === d ? "active" : ""} onClick={() => setDim(d)}>
                  {DIM_LABEL[d]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="filter-actions">
          <button className="ghost-btn" onClick={downloadCsv} disabled={sortedRows.length === 0}>
            この{DIM_LABEL[dim]}結果をCSVでダウンロード
          </button>
          <span className="result-count">
            {sortedRows.length.toLocaleString("ja-JP")}件 ／ 運賃売上合計 {fmtYen(totals.freight_revenue)}
          </span>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi-tile">
          <div className="label">運賃売上</div>
          <div className="value">{fmtYen(totals.freight_revenue)}</div>
        </div>
        <div className="kpi-tile">
          <div className="label">仕入先運賃</div>
          <div className="value">{fmtYen(totals.supplier_freight_cost)}</div>
        </div>
        <div className="kpi-tile">
          <div className="label">運送会社運賃</div>
          <div className="value">{fmtYen(totals.carrier_freight_cost)}</div>
        </div>
        <div className="kpi-tile">
          <div className="label">仕入計</div>
          <div className="value">{fmtYen(totals.total_freight_cost)}</div>
        </div>
        <div className="kpi-tile">
          <div className="label">粗利</div>
          <div className="value">{fmtYen(totals.freight_profit)}</div>
        </div>
        <div className="kpi-tile">
          <div className="label">粗利率</div>
          <div className="value">{fmtRate(totals.freight_revenue, totals.freight_profit)}</div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>
          {DIM_LABEL[dim]}({periodKey ? periodLabelFor(periodKeyFor(periodKey)) : "全期間"})
        </h2>
        {loading ? (
          <p className="cell-sub" style={{ padding: "0 20px 20px" }}>
            読み込み中…
          </p>
        ) : error ? (
          <p style={{ color: "var(--rk-critical)", padding: "0 20px 20px" }}>{error}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>コード</th>
                  <th>名称</th>
                  <th>運賃売上</th>
                  <th>仕入先運賃</th>
                  <th>運送会社運賃</th>
                  <th>仕入計</th>
                  <th>粗利</th>
                  <th>粗利率</th>
                  <th>件数</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="empty-state">
                      この条件に一致するデータはありません。
                    </td>
                  </tr>
                )}
                {sortedRows.map((r) => (
                  <tr key={codeFor(dim, r) || "unknown"}>
                    <td>{codeFor(dim, r) || "—"}</td>
                    <td>{labelFor(dim, r)}</td>
                    <td className="num">{fmtYen(r.freight_revenue)}</td>
                    <td className="num">{fmtYen(r.supplier_freight_cost)}</td>
                    <td className="num">{fmtYen(r.carrier_freight_cost)}</td>
                    <td className="num">{fmtYen(r.total_freight_cost)}</td>
                    <td className="num">{fmtYen(r.freight_profit)}</td>
                    <td>{fmtRate(r.freight_revenue, r.freight_profit)}</td>
                    <td className="num">{r.order_count.toLocaleString("ja-JP")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
