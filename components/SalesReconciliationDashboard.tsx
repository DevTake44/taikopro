"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { branchLabel } from "@/lib/branch-names";
import { ymFromDate, fiscalYearOf, monthsOfFiscalYear } from "@/lib/fiscal";

// v_sales_reconciliation(拠点×月度単位で「売上ダッシュボード(集計)」と
// 「売上ダッシュボード明細」を突き合わせ済みのビュー)を表示するだけの画面。
// 毎回チャットでSQLを書いて確認していた内容を、いつでも自分で見られるようにするためのもの。
type ReconRow = {
  branch_code: string;
  ym: string;
  sales_summary: number;
  purchase_summary: number;
  revenue_detail: number;
  cost_detail: number;
  freight_detail: number;
  stock_cost: number;
  nonstock_cost: number;
};

type Metric = "sales" | "cost";
type PeriodMode = "all" | "cur" | "prev";
type ValueMode = "diff" | "detail" | "summary";

function fmtYen(n: number): string {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

function monthLabel(ym: string): string {
  const m = parseInt(ym.slice(4, 6), 10);
  return `${m}月`;
}

export default function SalesReconciliationDashboard() {
  const [rows, setRows] = useState<ReconRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("sales");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("all");
  const [valueMode, setValueMode] = useState<ValueMode>("diff");

  useEffect(() => {
    fetch("/api/sales-reconciliation", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setError(json.error);
        } else {
          setRows(json.rows);
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  const { curMonths, prevMonths } = useMemo(() => {
    const today = new Date();
    const todayYm = ymFromDate(today.toISOString().slice(0, 10));
    const CUR = fiscalYearOf(todayYm);
    return { curMonths: monthsOfFiscalYear(CUR), prevMonths: monthsOfFiscalYear(CUR - 1) };
  }, []);

  const allMonths = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => r.ym))).sort();
  }, [rows]);

  const months = useMemo(() => {
    if (periodMode === "cur") return curMonths.filter((m) => allMonths.includes(m));
    if (periodMode === "prev") return prevMonths.filter((m) => allMonths.includes(m));
    return allMonths;
  }, [periodMode, allMonths, curMonths, prevMonths]);

  const branches = useMemo(() => {
    if (!rows) return [];
    const set = new Set(rows.map((r) => r.branch_code));
    return Array.from(set).sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      const fa = a !== "" && Number.isFinite(na);
      const fb = b !== "" && Number.isFinite(nb);
      if (fa && fb) return na - nb;
      if (fa) return -1;
      if (fb) return 1;
      return a.localeCompare(b, "ja");
    });
  }, [rows]);

  // (拠点, 月) -> 行 の索引
  const byKey = useMemo(() => {
    const m = new Map<string, ReconRow>();
    (rows ?? []).forEach((r) => m.set(`${r.branch_code}_${r.ym}`, r));
    return m;
  }, [rows]);

  function summaryValue(r: ReconRow | undefined): number {
    if (!r) return 0;
    return metric === "sales" ? r.sales_summary : r.purchase_summary;
  }
  function detailValue(r: ReconRow | undefined): number {
    if (!r) return 0;
    return metric === "sales" ? r.revenue_detail : r.cost_detail + r.freight_detail;
  }

  function cellValue(branchCode: string, ym: string): number {
    const r = byKey.get(`${branchCode}_${ym}`);
    if (valueMode === "summary") return summaryValue(r);
    if (valueMode === "detail") return detailValue(r);
    return detailValue(r) - summaryValue(r);
  }

  const branchTotal = useMemo(() => {
    const t = new Map<string, number>();
    branches.forEach((b) => {
      t.set(b, months.reduce((a, ym) => a + cellValue(b, ym), 0));
    });
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches, months, metric, valueMode, byKey]);

  const monthTotal = useMemo(() => {
    const t = new Map<string, number>();
    months.forEach((ym) => {
      t.set(ym, branches.reduce((a, b) => a + cellValue(b, ym), 0));
    });
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches, months, metric, valueMode, byKey]);

  const grandTotal = useMemo(() => months.reduce((a, ym) => a + (monthTotal.get(ym) ?? 0), 0), [months, monthTotal]);

  // 原価内訳(仕入・在庫・運賃)。期間フィルタ(months)に含まれる分だけを合計する。
  const costBreakdown = useMemo(() => {
    if (metric !== "cost" || !rows) return null;
    const monthSet = new Set(months);
    const perBranch = branches.map((b) => {
      let purchase = 0;
      let stock = 0;
      let freight = 0;
      let salesSum = 0;
      for (const ym of months) {
        const r = byKey.get(`${b}_${ym}`);
        if (!r || !monthSet.has(ym)) continue;
        purchase += r.nonstock_cost;
        stock += r.stock_cost;
        freight += r.freight_detail;
        salesSum += r.purchase_summary;
      }
      return { branch: b, purchase, stock, freight, total: purchase + stock + freight, summary: salesSum };
    });
    const totals = perBranch.reduce(
      (a, r) => ({
        purchase: a.purchase + r.purchase,
        stock: a.stock + r.stock,
        freight: a.freight + r.freight,
        total: a.total + r.total,
        summary: a.summary + r.summary,
      }),
      { purchase: 0, stock: 0, freight: 0, total: 0, summary: 0 }
    );
    return { perBranch, totals };
  }, [metric, rows, months, branches, byKey]);

  if (error) {
    return (
      <div className="wrap">
        <header className="top">
          <div className="title">
            <h1>集計・明細 対比</h1>
          </div>
          <Link href="/dx" className="ghost-btn-inline">← 社内DX</Link>
        </header>
        <div className="card" style={{ padding: 20 }}>
          <p>データの取得に失敗しました。</p>
          <pre style={{ whiteSpace: "pre-wrap", color: "#d9483b" }}>{error}</pre>
        </div>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="wrap">
        <header className="top">
          <div className="title">
            <h1>集計・明細 対比</h1>
          </div>
          <Link href="/dx" className="ghost-btn-inline">← 社内DX</Link>
        </header>
        <p style={{ padding: 20 }}>読み込み中…</p>
      </div>
    );
  }

  return (
    <div className="wrap">
      <header className="top">
        <div className="title">
          <h1>集計・明細 対比</h1>
          <p>
            売上ダッシュボード(集計、sales_monthly)と売上ダッシュボード明細(profit_summary/v_profit_lines、sales_lines)を、拠点×月度で突き合わせます。
          </p>
        </div>
        <Link href="/dx" className="ghost-btn-inline">← 社内DX</Link>
      </header>

      <div className="card-head" style={{ paddingTop: 0, flexWrap: "wrap", gap: 16 }}>
        <div className="tabs">
          <button className={metric === "sales" ? "active" : ""} onClick={() => setMetric("sales")}>売上</button>
          <button className={metric === "cost" ? "active" : ""} onClick={() => setMetric("cost")}>原価</button>
        </div>
        <div className="tabs">
          <button className={periodMode === "all" ? "active" : ""} onClick={() => setPeriodMode("all")}>全期間</button>
          <button className={periodMode === "cur" ? "active" : ""} onClick={() => setPeriodMode("cur")}>今期</button>
          <button className={periodMode === "prev" ? "active" : ""} onClick={() => setPeriodMode("prev")}>前期</button>
        </div>
        <div className="tabs">
          <button className={valueMode === "diff" ? "active" : ""} onClick={() => setValueMode("diff")}>差額(明細-集計)</button>
          <button className={valueMode === "detail" ? "active" : ""} onClick={() => setValueMode("detail")}>明細のみ</button>
          <button className={valueMode === "summary" ? "active" : ""} onClick={() => setValueMode("summary")}>集計のみ</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="matwrap">
          <table className="mat">
            <thead>
              <tr>
                <th className="codecol">コード</th>
                <th className="namecol">拠点</th>
                {months.map((ym) => (
                  <th key={ym}>{monthLabel(ym)}</th>
                ))}
                <th className="totcol">合計</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b}>
                  <td className="codecol">{b || "―"}</td>
                  <td className="namecol">{branchLabel(b)}</td>
                  {months.map((ym) => {
                    const v = cellValue(b, ym);
                    return (
                      <td key={ym}>
                        <span className={`cell-s ${valueMode === "diff" ? (v >= 0 ? "val-pos" : "val-neg") : ""}`}>
                          {valueMode === "diff" ? `${v >= 0 ? "+" : ""}${fmtYen(v)}` : fmtYen(v)}
                        </span>
                      </td>
                    );
                  })}
                  <td className="totcol">
                    <span className={`cell-s ${valueMode === "diff" ? ((branchTotal.get(b) ?? 0) >= 0 ? "val-pos" : "val-neg") : ""}`}>
                      {valueMode === "diff" ? `${(branchTotal.get(b) ?? 0) >= 0 ? "+" : ""}${fmtYen(branchTotal.get(b) ?? 0)}` : fmtYen(branchTotal.get(b) ?? 0)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="mat-foot">
              <tr>
                <td className="codecol" />
                <td className="namecol">合計</td>
                {months.map((ym) => (
                  <td key={ym}>
                    <span className={valueMode === "diff" ? ((monthTotal.get(ym) ?? 0) >= 0 ? "val-pos" : "val-neg") : ""}>
                      {valueMode === "diff" ? `${(monthTotal.get(ym) ?? 0) >= 0 ? "+" : ""}${fmtYen(monthTotal.get(ym) ?? 0)}` : fmtYen(monthTotal.get(ym) ?? 0)}
                    </span>
                  </td>
                ))}
                <td className="totcol">
                  <span className={valueMode === "diff" ? (grandTotal >= 0 ? "val-pos" : "val-neg") : ""}>
                    {valueMode === "diff" ? `${grandTotal >= 0 ? "+" : ""}${fmtYen(grandTotal)}` : fmtYen(grandTotal)}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p style={{ fontSize: 11, color: "var(--ink-faint)", padding: "8px 20px 16px" }}>
          「原価」の明細側は cost(仕入+在庫)+freight_actual(運賃実費)の合計。差額がプラス(緑)は明細の方が多いことを示します。
        </p>
      </div>

      {costBreakdown && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <h2>原価の内訳(仕入・在庫・運賃)</h2>
            <span className="sub">選択中の期間: {periodMode === "all" ? "全期間" : periodMode === "cur" ? "今期" : "前期"}</span>
          </div>
          <div className="matwrap">
            <table className="mat">
              <thead>
                <tr>
                  <th className="namecol">拠点</th>
                  <th>仕入</th>
                  <th>在庫</th>
                  <th>運賃</th>
                  <th className="totcol">原価合計(明細)</th>
                  <th>原価(集計)</th>
                  <th>差額</th>
                </tr>
              </thead>
              <tbody>
                {costBreakdown.perBranch.map((r) => (
                  <tr key={r.branch}>
                    <td className="namecol">{branchLabel(r.branch)}</td>
                    <td><span className="cell-s">{fmtYen(r.purchase)}</span></td>
                    <td><span className="cell-s">{fmtYen(r.stock)}</span></td>
                    <td><span className="cell-s">{fmtYen(r.freight)}</span></td>
                    <td className="totcol"><span className="cell-s">{fmtYen(r.total)}</span></td>
                    <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{fmtYen(r.summary)}</span></td>
                    <td>
                      <span className={`cell-s ${r.total - r.summary >= 0 ? "val-pos" : "val-neg"}`}>
                        {r.total - r.summary >= 0 ? "+" : ""}
                        {fmtYen(r.total - r.summary)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="mat-foot">
                <tr>
                  <td className="namecol">合計</td>
                  <td>{fmtYen(costBreakdown.totals.purchase)}</td>
                  <td>{fmtYen(costBreakdown.totals.stock)}</td>
                  <td>{fmtYen(costBreakdown.totals.freight)}</td>
                  <td className="totcol">{fmtYen(costBreakdown.totals.total)}</td>
                  <td>{fmtYen(costBreakdown.totals.summary)}</td>
                  <td className={costBreakdown.totals.total - costBreakdown.totals.summary >= 0 ? "val-pos" : "val-neg"}>
                    {costBreakdown.totals.total - costBreakdown.totals.summary >= 0 ? "+" : ""}
                    {fmtYen(costBreakdown.totals.total - costBreakdown.totals.summary)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p style={{ fontSize: 11, color: "var(--ink-faint)", padding: "8px 20px 16px" }}>
            「仕入」= v_profit_linesのarrange_type≠在庫のcost合計。「在庫」= arrange_type=在庫のcost合計(在庫商品が売れた分の原価)。「運賃」= profit_summary.freight_actual。
          </p>
        </div>
      )}
    </div>
  );
}
