"use client";
import { useState } from "react";
import Link from "next/link";

type SupplierPriceRow = {
  supplier_code: string | null;
  supplier_name: string | null;
  unit_price: number | null;
  purchase_date: string;
};
type PurchaseHistoryRow = {
  purchase_date: string;
  supplier_code: string | null;
  supplier_name: string | null;
  unit_price: number | null;
  spec: string | null;
  purchase_number: string;
  purchase_line: string;
  customer_name: string | null;
};
type MasterInfo = {
  product_name: string;
  product_kana: string | null;
  spec: string | null;
  source_updated_at: string | null;
  is_deleted: boolean;
  primary_supplier_code: string | null;
  primary_supplier_name: string | null;
  primary_supplier_price: number | null;
  secondary_supplier_code: string | null;
  secondary_supplier_name: string | null;
  secondary_supplier_price: number | null;
};
type ProductSearchResult = {
  product_code: string;
  product_name: string;
  master: MasterInfo | null;
  masterMismatch: string | null;
  latestBySupplier: SupplierPriceRow[];
  history: PurchaseHistoryRow[];
};
type SearchOutcome = {
  results: ProductSearchResult[];
  truncated: boolean;
};

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
// 基幹システム更新日(source_updated_at)がこれより古い場合、単価情報の信頼度が
// 低い可能性がある旨を表示する(仕入購買部への指導材料として使う想定。product_master拡張_実装指示書.md参照)。
const STALE_SOURCE_MS = 2 * 365 * 24 * 60 * 60 * 1000;

function isOld(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() > ONE_YEAR_MS;
}
function yen(n: number | null): string {
  return n === null ? "-" : `${n.toLocaleString()}円`;
}

export default function PurchaseLookupPage() {
  const [mode, setMode] = useState<"code" | "keyword">("code");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    if (query.trim() === "") return;
    setLoading(true);
    setError(null);
    setOutcome(null);
    try {
      const params = new URLSearchParams({ mode, query: query.trim() });
      const res = await fetch(`/api/search-purchase-prices?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `検索に失敗しました(status ${res.status})`);
      setOutcome(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setQuery("");
    setOutcome(null);
    setError(null);
  }

  return (
    <div className="wrap" style={{ maxWidth: 900 }}>
      <header className="top">
        <div className="title">
          <h1>仕入価格検索</h1>
          <p>品番の完全一致、または品名・仕様のキーワード(あいまい検索)で仕入実績を調べます。</p>
        </div>
        <Link href="/dx" className="ghost-btn-inline">
          ← 社内DXメニュー
        </Link>
      </header>

      <div style={{ display: "flex", gap: 16, marginBottom: 16, alignItems: "center" }}>
        <label style={{ fontSize: 13 }}>
          <input type="radio" checked={mode === "code"} onChange={() => setMode("code")} /> 品番で検索(完全一致)
        </label>
        <label style={{ fontSize: 13 }}>
          <input type="radio" checked={mode === "keyword"} onChange={() => setMode("keyword")} /> 品名・仕様で検索(キーワードのあいまい検索)
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder={mode === "code" ? "品番を入力" : "品名・仕様のキーワードを入力(スペース区切りで複数語OK)"}
          style={{ flex: 1, padding: "8px 12px", fontSize: 14, border: "1px solid #ccc", borderRadius: 6 }}
        />
        <button
          onClick={handleSearch}
          disabled={loading || query.trim() === ""}
          style={{
            padding: "8px 20px",
            borderRadius: 6,
            border: "1px solid #2563d9",
            background: loading || query.trim() === "" ? "#c3d6f8" : "#2563d9",
            color: "#fff",
            cursor: loading || query.trim() === "" ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "検索中…" : "検索"}
        </button>
        <button
          onClick={handleReset}
          disabled={loading}
          style={{
            padding: "8px 20px",
            borderRadius: 6,
            border: "1px solid #999",
            background: "#fff",
            color: "#444",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          リセット
        </button>
      </div>

      {error && <p style={{ color: "var(--neg)" }}>❌ {error}</p>}
      {outcome && outcome.results.length === 0 && !error && (
        <p style={{ color: "var(--ink-faint)" }}>該当する商品が見つかりませんでした。</p>
      )}
      {outcome?.truncated && (
        <p style={{ color: "var(--ink-faint)", fontSize: 13, marginBottom: 12 }}>
          ヒット件数が多いため、先頭20件のみ表示しています。キーワードを絞り込んでください。
        </p>
      )}

      {outcome?.results.map((r) => (
        <ProductCard key={r.product_code} result={r} />
      ))}
    </div>
  );
}

function ProductCard({ result }: { result: ProductSearchResult }) {
  const hasHistory = result.history.length > 0;
  const m = result.master;
  const sourceStale = m?.source_updated_at
    ? Date.now() - new Date(m.source_updated_at).getTime() > STALE_SOURCE_MS
    : false;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <h2 style={{ fontSize: 16 }}>
          {result.product_code} {result.product_name}
          {m?.is_deleted && (
            <span style={{ marginLeft: 8, fontSize: 11, color: "var(--neg)", border: "1px solid var(--neg)", borderRadius: 4, padding: "2px 6px" }}>
              商品マスタ上は削除フラグあり
            </span>
          )}
        </h2>
      </div>
      <div style={{ padding: "0 20px 20px" }}>
        {m?.spec && (
          <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 6 }}>仕様: {m.spec}</p>
        )}
        {m?.source_updated_at && (
          <p style={{ fontSize: 12, color: sourceStale ? "#b8860b" : "var(--ink-faint)", marginBottom: 12 }}>
            最終更新(基幹システム): {m.source_updated_at}
            {sourceStale && " ※更新から2年以上経過しており、単価情報の信頼度が低い可能性があります"}
          </p>
        )}

        {result.masterMismatch && (
          <p style={{ color: "#b8860b", fontSize: 13, marginBottom: 12 }}>⚠ {result.masterMismatch}</p>
        )}

        {hasHistory ? (
          <>
            <h3 style={{ fontSize: 13, marginBottom: 6 }}>
              仕入先ごとの最新価格({result.latestBySupplier.length}社)
            </h3>
            <table style={{ width: "100%", fontSize: 13, marginBottom: 16, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-faint)" }}>
                  <th>仕入先</th>
                  <th>単価</th>
                  <th>最終仕入日</th>
                </tr>
              </thead>
              <tbody>
                {result.latestBySupplier.map((s) => (
                  <tr key={s.supplier_code ?? s.supplier_name} style={{ background: isOld(s.purchase_date) ? "#fff3e0" : undefined }}>
                    <td>{s.supplier_name ?? s.supplier_code}</td>
                    <td>{yen(s.unit_price)}</td>
                    <td>{s.purchase_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p style={{ color: "var(--ink-faint)", fontSize: 13, marginBottom: 16 }}>
            仕入実績がありません。以下はマスタ情報です。
          </p>
        )}

        {m && (
          <div style={{ fontSize: 13, marginBottom: 16 }}>
            <h3 style={{ fontSize: 13, marginBottom: 6 }}>商品マスタ</h3>
            <p>
              実仕入先: {m.primary_supplier_name ?? m.primary_supplier_code ?? "-"}
              (単価 {yen(m.primary_supplier_price)})
            </p>
            {m.secondary_supplier_code && (
              <p>
                副仕入先: {m.secondary_supplier_name ?? m.secondary_supplier_code}
                (単価 {yen(m.secondary_supplier_price)})
              </p>
            )}
          </div>
        )}

        {hasHistory && (
          <>
            <h3 style={{ fontSize: 13, marginBottom: 6 }}>仕入実績(全{result.history.length}件、新しい順)</h3>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-faint)" }}>
                  <th>日付</th>
                  <th>仕入先</th>
                  <th>単価</th>
                  <th>仕様</th>
                  <th>得意先</th>
                  <th>伝票番号</th>
                </tr>
              </thead>
              <tbody>
                {result.history.map((h) => (
                  <tr
                    key={`${h.purchase_number}_${h.purchase_line}`}
                    style={{ background: isOld(h.purchase_date) ? "#fff3e0" : undefined }}
                  >
                    <td>{h.purchase_date}</td>
                    <td>{h.supplier_name ?? h.supplier_code ?? "-"}</td>
                    <td>{yen(h.unit_price)}</td>
                    <td>{h.spec ?? "-"}</td>
                    <td>{h.customer_name ?? "-"}</td>
                    <td>
                      {h.purchase_number}-{h.purchase_line}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
