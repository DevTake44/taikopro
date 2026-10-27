"use client";

import { useState } from "react";
import { yen, jpn } from "@/lib/format";
import { branchNameOnly } from "@/lib/branch-names";
import { repNameOnly } from "@/lib/rep-names";

type CustomerOption = {
  customer_code: string;
  customer_name: string;
  postal_code: string | null;
  address: string | null;
};

type HistoryRow = {
  delivery_date: string | null;
  order_no: string | null;
  item_code: string | null;
  item_name: string | null;
  qty: number | null;
  sell_price: number | null;
  branch_code: string | null;
  rep_code: string | null;
  project_name: string | null;
};

// コールセンター対応中など、電話口で得意先名・コードを聞いたらすぐに直近の取引実績を
// 呼び出せるようにするための画面。経営レポート(/sales)とは別に、直接検索のみの
// 軽量な作りにして応答速度を優先する(取引履歴のみ表示・集計はしない)。
export default function CustomerHistorySearch() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<CustomerOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<CustomerOption | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/quote-customer-search?query=${encodeURIComponent(query.trim())}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setResults(json.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  async function selectCustomer(c: CustomerOption) {
    setSelected(c);
    setResults(null);
    setQuery("");
    setHistory(null);
    setHistoryLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/customer-sales-history?customer_code=${encodeURIComponent(c.customer_code)}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setHistory(json.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <div>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>得意先コード・得意先名で検索</label>
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <input
            type="text"
            autoFocus
            placeholder="電話口で聞いた会社名などを入力してEnter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            style={{ flex: 1, padding: "10px 12px", fontSize: 15 }}
          />
          <button type="button" className="btn-primary" onClick={search} disabled={searching}>
            {searching ? "検索中…" : "検索"}
          </button>
        </div>

        {results && (
          <div className="card" style={{ marginTop: 8, maxHeight: 280, overflowY: "auto" }}>
            {results.length === 0 && <p className="cell-sub" style={{ padding: 10 }}>見つかりません。</p>}
            {results.map((c) => (
              <div key={c.customer_code} className="search-item" onClick={() => selectCustomer(c)}>
                <span style={{ fontWeight: 600 }}>{c.customer_name}</span>
                <span className="cell-sub" style={{ marginLeft: 8 }}>
                  {c.customer_code}
                  {c.address ? `・${c.address}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {selected && (
        <div className="card" style={{ padding: 0, marginBottom: 16 }}>
          <div className="card-head">
            <div>
              <h2>
                {selected.customer_name}
                <span className="cell-sub" style={{ marginLeft: 10, fontWeight: 400 }}>
                  {selected.customer_code}
                </span>
              </h2>
              {(selected.postal_code || selected.address) && (
                <div className="cell-sub" style={{ marginTop: 2 }}>
                  {selected.postal_code && `〒${selected.postal_code} `}
                  {selected.address}
                </div>
              )}
            </div>
            <button type="button" onClick={() => { setSelected(null); setHistory(null); }}>
              別の得意先を検索
            </button>
          </div>

          <div className="matwrap">
            <table className="mat">
              <thead>
                <tr>
                  <th>納品日</th>
                  <th>受注番号</th>
                  <th className="codecol">商品コード</th>
                  <th className="namecol">商品名</th>
                  <th>数量</th>
                  <th>単価</th>
                  <th>金額</th>
                  <th>拠点</th>
                  <th>担当</th>
                  <th className="namecol">物件名</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading && (
                  <tr>
                    <td colSpan={10} className="cell-sub" style={{ padding: 16 }}>
                      読み込み中…
                    </td>
                  </tr>
                )}
                {!historyLoading && history && history.length === 0 && (
                  <tr>
                    <td colSpan={10} className="cell-sub" style={{ padding: 16 }}>
                      取引実績がありません。
                    </td>
                  </tr>
                )}
                {!historyLoading &&
                  history?.map((r, i) => (
                    <tr key={i}>
                      <td>{r.delivery_date ?? "—"}</td>
                      <td className="cell-sub">{r.order_no ?? "—"}</td>
                      <td className="codecol">{r.item_code ?? "—"}</td>
                      <td className="namecol">{r.item_name ?? "—"}</td>
                      <td>{r.qty != null ? jpn(r.qty) : "—"}</td>
                      <td>{r.sell_price != null ? yen(r.sell_price) : "—"}</td>
                      <td>{r.qty != null && r.sell_price != null ? yen(r.qty * r.sell_price) : "—"}</td>
                      <td>{branchNameOnly(r.branch_code)}</td>
                      <td>{repNameOnly(r.rep_code)}</td>
                      <td className="namecol">{r.project_name ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {history && history.length > 0 && (
            <div className="cell-sub" style={{ padding: "10px 20px" }}>
              直近{history.length}件(納品日の新しい順)を表示しています。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
