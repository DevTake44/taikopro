import Link from "next/link";
import {
  fetchFreightSalesRows,
  fetchFreightPurchaseRows,
  buildFreightSummaryByPeriod,
} from "@/lib/fetchFreightSummary";
import type { FreightGroupRow, FreightSummary } from "@/lib/fetchFreightSummary";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

function GroupTable({ title, rows }: { title: string; rows: FreightGroupRow[] }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <h2>{title}</h2>
      </div>
      <div className="table-scroll" style={{ padding: "0 20px 20px" }}>
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>売上運賃</th>
              <th>仕入運賃</th>
              <th>粗利</th>
              <th>粗利率</th>
              <th>件数(売上/仕入)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <td>{r.label}</td>
                <td>¥{r.salesAmount.toLocaleString()}</td>
                <td>¥{r.purchaseAmount.toLocaleString()}</td>
                <td>¥{r.grossProfit.toLocaleString()}</td>
                <td>{formatRate(r.grossProfitRate)}</td>
                <td>
                  {r.salesCount.toLocaleString()} / {r.purchaseCount.toLocaleString()}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="cell-sub">
                  データがありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PeriodSection({ label, summary }: { label: string; summary: FreightSummary }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12, borderBottom: "2px solid #1f2d3d", paddingBottom: 6 }}>
        {label}
      </h2>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <h2>合計</h2>
        </div>
        <div style={{ padding: "0 20px 20px", display: "flex", gap: 32, flexWrap: "wrap" }}>
          <div>
            <p className="cell-sub">運賃売上合計</p>
            <p style={{ fontSize: 20, fontWeight: 700 }}>¥{summary.total.salesAmount.toLocaleString()}</p>
            <p className="cell-sub">{summary.total.salesCount.toLocaleString()}件</p>
          </div>
          <div>
            <p className="cell-sub">運賃仕入合計</p>
            <p style={{ fontSize: 20, fontWeight: 700 }}>¥{summary.total.purchaseAmount.toLocaleString()}</p>
            <p className="cell-sub">{summary.total.purchaseCount.toLocaleString()}件</p>
          </div>
          <div>
            <p className="cell-sub">粗利</p>
            <p style={{ fontSize: 20, fontWeight: 700 }}>¥{summary.total.grossProfit.toLocaleString()}</p>
          </div>
          <div>
            <p className="cell-sub">粗利率</p>
            <p style={{ fontSize: 20, fontWeight: 700 }}>{formatRate(summary.total.grossProfitRate)}</p>
          </div>
        </div>
      </div>

      <GroupTable title="拠点別" rows={summary.byBranch} />
      <GroupTable title="担当別" rows={summary.byRep} />
      <GroupTable title="得意先別" rows={summary.byCustomer} />
    </section>
  );
}

export default async function FreightSummaryPage() {
  try {
    const [salesRows, purchaseRows] = await Promise.all([fetchFreightSalesRows(), fetchFreightPurchaseRows()]);
    const periods = buildFreightSummaryByPeriod(salesRows, purchaseRows);

    return (
      <div className="wrap" style={{ maxWidth: 1000 }}>
        <header className="top" style={{ marginBottom: 20 }}>
          <div className="title">
            <h1>運賃 売上・仕入</h1>
            <p>品番コード99(運賃)の売上・仕入を、期別に合計・拠点別・担当別・得意先別で確認します。</p>
          </div>
          <Link href="/dx" className="ghost-btn-inline">
            ← 社内DXメニュー
          </Link>
        </header>

        {periods.length === 0 && <p className="cell-sub">データがありません。</p>}
        {periods.map((p) => (
          <PeriodSection key={p.fiscalYearStart} label={p.label} summary={p.summary} />
        ))}
      </div>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラーが発生しました。";
    return (
      <div style={{ maxWidth: 640, margin: "80px auto", padding: 24, fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>データの読み込みでエラーが発生しました</h1>
        <p style={{ fontSize: 14, color: "#555", lineHeight: 1.6 }}>{message}</p>
        <p style={{ marginTop: 20 }}>
          <Link href="/dx" className="ghost-btn-inline">
            ← 社内DXメニュー
          </Link>
        </p>
      </div>
    );
  }
}
