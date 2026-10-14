import Link from "next/link";
import { fetchFreightProfitSummaryRows, buildFreightSummaryByPeriod } from "@/lib/fetchFreightSummary";
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
            {rows.map((r) => (
              <tr key={r.code}>
                <td>{r.label}</td>
                <td>¥{r.freightRevenue.toLocaleString()}</td>
                <td>¥{r.supplierCost.toLocaleString()}</td>
                <td>¥{r.carrierCost.toLocaleString()}</td>
                <td>¥{r.totalCost.toLocaleString()}</td>
                <td>¥{r.grossProfit.toLocaleString()}</td>
                <td>{formatRate(r.grossProfitRate)}</td>
                <td>{r.orderCount.toLocaleString()}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="cell-sub">
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
            <p style={{ fontSize: 20, fontWeight: 700 }}>¥{summary.total.freightRevenue.toLocaleString()}</p>
            <p className="cell-sub">{summary.total.orderCount.toLocaleString()}件</p>
          </div>
          <div>
            <p className="cell-sub">仕入先運賃</p>
            <p style={{ fontSize: 20, fontWeight: 700 }}>¥{summary.total.supplierCost.toLocaleString()}</p>
          </div>
          <div>
            <p className="cell-sub">運送会社運賃</p>
            <p style={{ fontSize: 20, fontWeight: 700 }}>¥{summary.total.carrierCost.toLocaleString()}</p>
          </div>
          <div>
            <p className="cell-sub">仕入計</p>
            <p style={{ fontSize: 20, fontWeight: 700 }}>¥{summary.total.totalCost.toLocaleString()}</p>
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
    const rows = await fetchFreightProfitSummaryRows();
    const periods = buildFreightSummaryByPeriod(rows);

    return (
      <div className="wrap" style={{ maxWidth: 1100 }}>
        <header className="top" style={{ marginBottom: 20 }}>
          <div className="title">
            <h1>運賃 売上・仕入</h1>
            <p>
              品番コード99(運賃)の売上を、仕入先運賃(purchases)・運送会社運賃(西濃・福山などの実費)の両方と
              受注番号(伝票)単位で突き合わせたうえで、期別に合計・拠点別・担当別・得意先別に確認します。
            </p>
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
