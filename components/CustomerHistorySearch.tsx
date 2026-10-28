"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { yen, jpn } from "@/lib/format";
import { BRANCH_NAMES, branchNameOnly } from "@/lib/branch-names";
import { REP_NAMES, repNameOnly } from "@/lib/rep-names";
import type { BranchRepPair } from "@/app/api/quote-customer-branch-reps/route";

type CustomerOption = {
  customer_code: string;
  customer_name: string;
  postal_code: string | null;
  address: string | null;
};

type HistoryRow = {
  customer_code: string | null;
  customer_name: string | null;
  delivery_date: string | null;
  order_no: string | null;
  item_code: string | null;
  item_name: string | null;
  spec: string | null;
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

  // 同じ会社が拠点ごとに別の得意先コードに分かれている場合(例:高速)、どの拠点で
  // 取引があったかまとめて検索できるよう、得意先は複数選択できるようにしている。
  const [selected, setSelected] = useState<CustomerOption[]>([]);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 拠点・担当を先に選んでおくと、名前検索(ilike)の対象をその拠点・担当の得意先だけに
  // DB側で絞り込めるため、拠点が大きい(得意先が多い)場合ほど検索が速くなる。
  const [branchFilter, setBranchFilter] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [branchRepPairs, setBranchRepPairs] = useState<BranchRepPair[]>([]);

  useEffect(() => {
    fetch("/api/quote-customer-branch-reps")
      .then((r) => r.json())
      .then((json) => setBranchRepPairs(json.pairs ?? []))
      .catch(() => {});
  }, []);

  const branchCodes = useMemo(() => {
    const codes = new Set(branchRepPairs.map((p) => p.branch_code));
    return Array.from(codes).sort();
  }, [branchRepPairs]);

  const repCodesForBranch = useMemo(() => {
    const codes = branchRepPairs
      .filter((p) => (branchFilter ? p.branch_code === branchFilter : true))
      .map((p) => p.rep_code)
      .filter((c): c is string => !!c);
    return Array.from(new Set(codes)).sort();
  }, [branchRepPairs, branchFilter]);

  function onBranchFilterChange(v: string) {
    setBranchFilter(v);
    // 拠点を変えたら、担当が新しい拠点に存在しない値のままにならないようリセットする。
    setRepFilter("");
  }

  // 検索結果が返ってくる順番は保証されないため、入力中に連打すると古い応答が後から
  // 画面に表示されてしまうことがある。リクエストごとに連番を振り、最新のものだけ反映する。
  const latestRequestId = useRef(0);

  async function search() {
    if (!query.trim() && !branchFilter && !repFilter) {
      setResults(null);
      return;
    }
    const requestId = ++latestRequestId.current;
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      if (branchFilter) params.set("branch", branchFilter);
      if (repFilter) params.set("rep", repFilter);
      const res = await fetch(`/api/quote-customer-search?${params.toString()}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      if (requestId === latestRequestId.current) setResults(json.rows ?? []);
    } catch (e) {
      if (requestId === latestRequestId.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (requestId === latestRequestId.current) setSearching(false);
    }
  }

  // 検索エンジンのように、入力するたびに(少し待ってから)自動で絞り込む。
  // Enter・検索ボタンを押さなくても、「イオン」→ 空白 →「岡崎」と打つにつれて
  // 候補が自動で絞られていく。
  useEffect(() => {
    const timer = setTimeout(() => {
      search();
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, branchFilter, repFilter]);

  // 得意先選択後、さらに商品で絞り込むための検索語。「直近50件」の中だけでなく、
  // その商品の取引実績をDB側から探し直す(直近には出てこない過去の購入も見つけられるように)。
  const [productFilter, setProductFilter] = useState("");
  const latestHistoryRequestId = useRef(0);

  async function fetchHistory(customerCodes: string[], product: string) {
    if (customerCodes.length === 0) {
      setHistory(null);
      return;
    }
    const requestId = ++latestHistoryRequestId.current;
    setHistoryLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ customer_code: customerCodes.join(",") });
      if (product.trim()) params.set("product", product.trim());
      const res = await fetch(`/api/customer-sales-history?${params.toString()}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      if (requestId === latestHistoryRequestId.current) setHistory(json.rows ?? []);
    } catch (e) {
      if (requestId === latestHistoryRequestId.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (requestId === latestHistoryRequestId.current) setHistoryLoading(false);
    }
  }

  // クリックした得意先を選択に追加/解除する(複数の拠点をまとめて検索できるように、
  // 単一選択の置き換えではなくトグルにしている)。検索結果はそのまま残すので、
  // 同じ検索語のリストから続けて別の拠点も選べる。
  function toggleCustomer(c: CustomerOption) {
    setSelected((prev) => {
      const exists = prev.some((p) => p.customer_code === c.customer_code);
      if (exists) return prev.filter((p) => p.customer_code !== c.customer_code);
      return [...prev, c];
    });
  }

  function removeCustomer(customerCode: string) {
    setSelected((prev) => prev.filter((p) => p.customer_code !== customerCode));
  }

  function clearSelection() {
    setSelected([]);
    setHistory(null);
    setProductFilter("");
  }

  const selectedCodesKey = useMemo(
    () => selected.map((c) => c.customer_code).sort().join(","),
    [selected]
  );

  // 商品での絞り込みも、得意先検索と同じく入力するたびに自動で絞り込む。
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchHistory(selected.map((c) => c.customer_code), productFilter);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productFilter, selectedCodesKey]);

  const showCustomerColumn = selected.length > 1;
  const columnCount = showCustomerColumn ? 12 : 11;

  return (
    <div>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>拠点・担当で絞り込み(先に選ぶと検索が速くなります・任意)</label>
        <div style={{ display: "flex", gap: 6, marginTop: 4, marginBottom: 10 }}>
          <select value={branchFilter} onChange={(e) => onBranchFilterChange(e.target.value)} style={{ flex: 1, padding: "8px 10px" }}>
            <option value="">拠点(すべて)</option>
            {branchCodes.map((code) => (
              <option key={code} value={code}>
                {BRANCH_NAMES[code] ?? code}
              </option>
            ))}
          </select>
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} style={{ flex: 1, padding: "8px 10px" }}>
            <option value="">担当(すべて)</option>
            {repCodesForBranch.map((code) => (
              <option key={code} value={code}>
                {REP_NAMES[code] ?? code}
              </option>
            ))}
          </select>
        </div>

        <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>
          得意先コード・得意先名で検索(入力するたびに自動で絞り込みます。「イオン 岡崎」のように空白区切りでさらに絞り込めます。
          クリックで得意先を選択に追加できます。同じ会社の別拠点もまとめて選べます)
        </label>
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <input
              type="text"
              autoFocus
              placeholder="例: イオン 岡崎"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              style={{ width: "100%", padding: "10px 34px 10px 12px", fontSize: 15, boxSizing: "border-box" }}
            />
            {query && (
              <button
                type="button"
                className="btn-icon"
                onClick={() => {
                  setQuery("");
                  setResults(null);
                }}
                title="検索語をクリア"
                style={{
                  position: "absolute",
                  right: 6,
                  top: "50%",
                  transform: "translateY(-50%)",
                }}
              >
                ×
              </button>
            )}
          </div>
          <button type="button" className="btn-primary" onClick={search} disabled={searching}>
            {searching ? "検索中…" : "検索"}
          </button>
        </div>

        {results && (
          <div className="card" style={{ marginTop: 8, maxHeight: 280, overflowY: "auto" }}>
            {results.length === 0 && <p className="cell-sub" style={{ padding: 10 }}>見つかりません。</p>}
            {results.map((c) => {
              const isSelected = selected.some((s) => s.customer_code === c.customer_code);
              return (
                <div
                  key={c.customer_code}
                  className="search-item"
                  onClick={() => toggleCustomer(c)}
                  style={isSelected ? { background: "var(--line)" } : undefined}
                >
                  <span style={{ fontWeight: 600 }}>
                    {isSelected ? "✓ " : ""}
                    {c.customer_name}
                  </span>
                  <span className="cell-sub" style={{ marginLeft: 8 }}>
                    {c.customer_code}
                    {c.address ? `・${c.address}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {selected.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 16 }}>
          <div className="card-head">
            <div>
              <h2>選択中の得意先({selected.length}件)</h2>
            </div>
            <button type="button" onClick={clearSelection}>
              すべて解除
            </button>
          </div>
          <div style={{ padding: "0 20px 16px", display: "flex", flexWrap: "wrap", gap: 8 }}>
            {selected.map((c) => (
              <span
                key={c.customer_code}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: "1px solid var(--line)",
                  borderRadius: 999,
                  padding: "4px 6px 4px 12px",
                  fontSize: 13,
                }}
              >
                {c.customer_name}
                <span className="cell-sub">{c.customer_code}</span>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => removeCustomer(c.customer_code)}
                  title="この得意先を外す"
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <div style={{ padding: "0 20px 0" }}>
            <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>
              商品コード・商品名で絞り込み(入力するたびに自動で絞り込みます)
            </label>
            <div style={{ position: "relative", marginTop: 4, maxWidth: 420 }}>
              <input
                type="text"
                placeholder="例: ラップ"
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                style={{ width: "100%", padding: "8px 34px 8px 10px", boxSizing: "border-box" }}
              />
              {productFilter && (
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => setProductFilter("")}
                  title="絞り込みをクリア"
                  style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          <div className="matwrap">
            <table className="mat">
              <thead>
                <tr>
                  {showCustomerColumn && <th className="namecol">得意先</th>}
                  <th>納品日</th>
                  <th>受注番号</th>
                  <th className="codecol">商品コード</th>
                  <th className="namecol">商品名</th>
                  <th className="namecol">仕様</th>
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
                    <td colSpan={columnCount} className="cell-sub" style={{ padding: 16 }}>
                      読み込み中…
                    </td>
                  </tr>
                )}
                {!historyLoading && history && history.length === 0 && (
                  <tr>
                    <td colSpan={columnCount} className="cell-sub" style={{ padding: 16 }}>
                      取引実績がありません。
                    </td>
                  </tr>
                )}
                {!historyLoading &&
                  history?.map((r, i) => (
                    <tr key={i}>
                      {showCustomerColumn && <td className="namecol">{r.customer_name ?? "—"}</td>}
                      <td>{r.delivery_date ?? "—"}</td>
                      <td className="cell-sub">{r.order_no ?? "—"}</td>
                      <td className="codecol">{r.item_code ?? "—"}</td>
                      <td className="namecol">{r.item_name ?? "—"}</td>
                      <td className="namecol">{r.spec ?? "—"}</td>
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
              {productFilter
                ? `「${productFilter}」に該当する直近${history.length}件(納品日の新しい順)を表示しています。`
                : `直近${history.length}件(納品日の新しい順)を表示しています。`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
