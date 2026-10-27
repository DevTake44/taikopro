"use client";
import { useState } from "react";
import Link from "next/link";

type Timings = Record<string, number>;
type Candidate = { customer_code: string; customer_name: string; address: string | null };
type Line = {
  order_no: string;
  order_line: string;
  order_date: string | null;
  delivery_date: string | null;
  item_code: string | null;
  item_name: string | null;
  qty: number | null;
  sell_price: number | null;
  rep_code: string | null;
  project_name: string | null;
  delivery_dest_name: string | null;
};
type Detail = {
  customer: { customer_code: string; customer_name: string; address: string | null; postal_code: string | null } | null;
  recent: Line[];
  monthly: { month: string; amount: number }[];
  topItems: { item_code: string; item_name: string | null; amount: number; qty: number; count: number }[];
  summaryRowCount: number;
  timings: Timings;
};

const yen = (n: number) => `${Math.round(n).toLocaleString()}円`;

function TimingBox({ timings, totalMs }: { timings: Timings; totalMs: number }) {
  return (
    <div style={{ fontSize: 12, background: "#f4f6fa", border: "1px solid #dde3ee", borderRadius: 6, padding: "8px 12px", marginBottom: 16 }}>
      <b>⏱ 体感時間(ボタンを押してから表示まで): {(totalMs / 1000).toFixed(2)}秒</b>
      <div style={{ color: "#555", marginTop: 4 }}>
        内訳(サーバー→DB): {Object.entries(timings).map(([k, v]) => `${k} ${v}ms`).join(" / ")}
      </div>
    </div>
  );
}

export default function CustomerPerformancePage() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [searchTiming, setSearchTiming] = useState<{ timings: Timings; ms: number } | null>(null);
  const [detailMs, setDetailMs] = useState(0);

  async function call(params: Record<string, string>) {
    const t0 = performance.now();
    const res = await fetch(`/api/customer-performance?${new URLSearchParams(params)}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? `失敗しました(status ${res.status})`);
    return { json, ms: performance.now() - t0 };
  }

  async function search() {
    if (q.trim() === "") return;
    setLoading(true);
    setError(null);
    setDetail(null);
    setCandidates(null);
    try {
      const { json, ms } = await call({ q: q.trim() });
      setCandidates(json.candidates);
      setSearchTiming({ timings: json.timings, ms });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function open(code: string) {
    setLoading(true);
    setError(null);
    try {
      const { json, ms } = await call({ code });
      setDetail(json);
      setDetailMs(ms);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wrap" style={{ maxWidth: 1000 }}>
      <header className="top">
        <div className="title">
          <h1>顧客実績</h1>
          <p>会社名の一部、または顧客コードで検索し、過去の売上実績を確認します。(速度検証用に所要時間を表示しています)</p>
        </div>
        <Link href="/sales-app" className="ghost-btn-inline">
          ← 営業アプリ
        </Link>
      </header>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="会社名の一部 または 顧客コード"
          style={{ flex: 1, padding: "8px 12px", fontSize: 14, border: "1px solid #ccc", borderRadius: 6 }}
        />
        <button
          onClick={search}
          disabled={loading || q.trim() === ""}
          style={{ padding: "8px 20px", borderRadius: 6, border: "1px solid #2563d9", background: loading ? "#c3d6f8" : "#2563d9", color: "#fff" }}
        >
          {loading ? "検索中…" : "検索"}
        </button>
      </div>

      {error && <p style={{ color: "#c00" }}>{error}</p>}

      {candidates && !detail && (
        <>
          {searchTiming && <TimingBox timings={searchTiming.timings} totalMs={searchTiming.ms} />}
          {candidates.length === 0 ? (
            <p>該当する顧客がありません。</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {candidates.map((c) => (
                <button
                  key={c.customer_code}
                  onClick={() => open(c.customer_code)}
                  className="card"
                  style={{ textAlign: "left", padding: 12, cursor: "pointer" }}
                >
                  <b>{c.customer_name}</b>({c.customer_code})
                  <div style={{ fontSize: 12, color: "#666" }}>{c.address ?? ""}</div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {detail && (
        <>
          <button onClick={() => setDetail(null)} style={{ marginBottom: 12 }}>
            ← 候補に戻る
          </button>
          <TimingBox timings={detail.timings} totalMs={detailMs} />
          <h2 style={{ margin: "0 0 4px" }}>
            {detail.customer?.customer_name ?? "(顧客マスタに未登録)"}
          </h2>
          <p style={{ fontSize: 12, color: "#666", marginTop: 0 }}>
            {detail.customer?.customer_code} {detail.customer?.postal_code ?? ""} {detail.customer?.address ?? ""}
          </p>

          <h3>月別売上(過去24ヶ月・{detail.summaryRowCount.toLocaleString()}明細)</h3>
          {detail.monthly.length === 0 ? (
            <p style={{ fontSize: 13 }}>この期間の売上はありません。</p>
          ) : (
            <table className="tbl" style={{ fontSize: 13 }}>
              <tbody>
                {detail.monthly.map((m) => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td style={{ textAlign: "right" }}>{yen(m.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3>よく買う商品(金額上位10・過去24ヶ月)</h3>
          <table className="tbl" style={{ fontSize: 13 }}>
            <thead>
              <tr><th>品番</th><th>品名</th><th>数量</th><th>回数</th><th>金額</th></tr>
            </thead>
            <tbody>
              {detail.topItems.map((t) => (
                <tr key={t.item_code}>
                  <td>{t.item_code}</td>
                  <td>{t.item_name}</td>
                  <td style={{ textAlign: "right" }}>{t.qty.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>{t.count}</td>
                  <td style={{ textAlign: "right" }}>{yen(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>直近の明細(50件)</h3>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead>
              <tr><th>受注日</th><th>納品日</th><th>品番</th><th>品名</th><th>数量</th><th>単価</th><th>案件</th></tr>
            </thead>
            <tbody>
              {detail.recent.map((r) => (
                <tr key={`${r.order_no}-${r.order_line}-${r.item_code}`}>
                  <td>{r.order_date}</td>
                  <td>{r.delivery_date}</td>
                  <td>{r.item_code}</td>
                  <td>{r.item_name}</td>
                  <td style={{ textAlign: "right" }}>{r.qty}</td>
                  <td style={{ textAlign: "right" }}>{r.sell_price?.toLocaleString()}</td>
                  <td>{r.project_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
