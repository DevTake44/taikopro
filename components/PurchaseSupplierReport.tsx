"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { yen, jpn } from "@/lib/format";
import { quarterLabelFor } from "@/lib/period";
import { branchNameOnly } from "@/lib/branch-names";
import type { PurchaseSupplierQuarterRow } from "@/app/api/purchase-supplier-quarter/route";
import type { PurchaseBreakdownRow } from "@/app/api/purchase-supplier-detail/route";

type SortKey = "amount" | "diff" | "diff_rate";

export default function PurchaseSupplierReport({ quarterEnds }: { quarterEnds: string[] }) {
  const [quarterEnd, setQuarterEnd] = useState(quarterEnds[0] ?? "");
  const [rows, setRows] = useState<PurchaseSupplierQuarterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [selected, setSelected] = useState<PurchaseSupplierQuarterRow | null>(null);
  const [detail, setDetail] = useState<{
    byLocation: PurchaseBreakdownRow[];
    byProduct: PurchaseBreakdownRow[];
    byCustomer: PurchaseBreakdownRow[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (!quarterEnd) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    setDetail(null);
    fetch(`/api/purchase-supplier-quarter?quarterEnd=${quarterEnd}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) {
          setError(json.error);
          setRows([]);
        } else {
          setRows(json.rows ?? []);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [quarterEnd]);

  const filteredSorted = useMemo(() => {
    const ql = query.trim().toLowerCase();
    let list = rows;
    if (ql) {
      list = list.filter(
        (r) => r.supplier_code.toLowerCase().includes(ql) || r.supplier_name.toLowerCase().includes(ql)
      );
    }
    const sorted = [...list].sort((a, b) => {
      const va = sortKey === "amount" ? a.current_amount : sortKey === "diff" ? a.diff : a.diff_rate ?? -Infinity;
      const vb = sortKey === "amount" ? b.current_amount : sortKey === "diff" ? b.diff : b.diff_rate ?? -Infinity;
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return sorted;
  }, [rows, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function selectSupplier(row: PurchaseSupplierQuarterRow) {
    setSelected(row);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    fetch(`/api/purchase-supplier-detail?supplier_code=${encodeURIComponent(row.supplier_code)}&quarterEnd=${quarterEnd}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) setDetailError(json.error);
        else setDetail(json);
      })
      .catch((e) => setDetailError(String(e)))
      .finally(() => setDetailLoading(false));
  }

  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === "desc" ? " ▼" : " ▲") : "");

  return (
    <div className="wrap" style={{ maxWidth: 1100 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>仕入先別 仕入額 昨対比</h1>
          <p>四半期(9/20決算)ごとに、仕入先別の仕入額を前年同期と比較します。</p>
        </div>
        <Link href="/management" className="ghost-btn-inline">
          ← 経営管理
        </Link>
      </header>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 12.5 }}>
            四半期:{" "}
            <select value={quarterEnd} onChange={(e) => setQuarterEnd(e.target.value)}>
              {quarterEnds.map((q) => (
                <option key={q} value={q}>
                  {quarterLabelFor(q)}
                </option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: 12.5 }}>
            並び順:{" "}
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
              <option value="amount">仕入額</option>
              <option value="diff">増減額</option>
              <option value="diff_rate">増減率</option>
            </select>
          </label>

          <label style={{ fontSize: 12.5 }}>
            <select value={sortDir} onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}>
              <option value="desc">多い順</option>
              <option value="asc">少ない順</option>
            </select>
          </label>

          <input
            type="text"
            placeholder="仕入先コード・仕入先名で検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: "1 1 220px", minWidth: 180, padding: "6px 10px", fontSize: 12.5 }}
          />
          {query && (
            <button className="ghost-btn-inline" onClick={() => setQuery("")}>
              クリア
            </button>
          )}
        </div>
      </div>

      {error && <p style={{ color: "var(--direct)" }}>{error}</p>}
      {loading && <p className="cell-sub">読み込み中...</p>}

      {!loading && !error && (
        <div className="card" style={{ padding: 0, marginBottom: 16 }}>
          <div className="card-head">
            <h2>仕入先一覧</h2>
            <span className="sub">
              {filteredSorted.length.toLocaleString("ja-JP")}件 / 全{rows.length.toLocaleString("ja-JP")}件
            </span>
          </div>
          <div className="matwrap">
            <table className="mat">
              <thead>
                <tr>
                  <th className="codecol">仕入先コード</th>
                  <th className="namecol">仕入先名</th>
                  <th onClick={() => toggleSort("amount")}>今期仕入額{sortArrow("amount")}</th>
                  <th>前期仕入額</th>
                  <th onClick={() => toggleSort("diff")}>増減{sortArrow("diff")}</th>
                  <th onClick={() => toggleSort("diff_rate")}>増減率{sortArrow("diff_rate")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredSorted.map((r) => (
                  <tr
                    key={r.supplier_code}
                    onClick={() => selectSupplier(r)}
                    style={{
                      cursor: "pointer",
                      background: selected?.supplier_code === r.supplier_code ? "#eef4ff" : undefined,
                    }}
                  >
                    <td className="codecol">{r.supplier_code}</td>
                    <td className="namecol">{r.supplier_name}</td>
                    <td>{yen(r.current_amount)}</td>
                    <td>{yen(r.prev_amount)}</td>
                    <td style={{ color: r.diff < 0 ? "var(--direct)" : undefined }}>
                      {r.diff >= 0 ? "+" : ""}
                      {yen(r.diff)}
                    </td>
                    <td style={{ color: r.diff_rate !== null && r.diff_rate < 0 ? "var(--direct)" : undefined }}>
                      {r.diff_rate === null ? "—" : `${r.diff_rate >= 0 ? "+" : ""}${(r.diff_rate * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <div className="card" style={{ padding: 16 }}>
          <div className="card-head" style={{ padding: 0, marginBottom: 12 }}>
            <h2>
              {selected.supplier_name}({selected.supplier_code}) の内訳 — {quarterLabelFor(quarterEnd)}
            </h2>
          </div>
          {detailLoading && <p className="cell-sub">読み込み中...</p>}
          {detailError && <p style={{ color: "var(--direct)" }}>{detailError}</p>}
          {detail && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
              <BreakdownTable
                title="拠点別"
                rows={detail.byLocation}
                nameOf={(row) => branchNameOnly(row.code === "(不明)" ? null : row.code)}
              />
              <BreakdownTable title="商品別" rows={detail.byProduct} nameOf={(row) => row.name} />
              <BreakdownTable title="得意先別" rows={detail.byCustomer} nameOf={(row) => row.name} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
  nameOf,
}: {
  title: string;
  rows: PurchaseBreakdownRow[];
  nameOf: (row: PurchaseBreakdownRow) => string;
}) {
  return (
    <div>
      <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>{title}</h3>
      <div className="matwrap" style={{ maxHeight: 320, overflowY: "auto" }}>
        <table className="mat">
          <thead>
            <tr>
              <th className="namecol">名称</th>
              <th>仕入額</th>
              <th>件数</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((r) => (
              <tr key={r.code}>
                <td className="namecol">{nameOf(r)}</td>
                <td>{yen(r.amount)}</td>
                <td>{jpn(r.line_count)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="cell-sub">
                  データがありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 50 && <p className="cell-sub" style={{ marginTop: 4 }}>上位50件を表示(全{rows.length}件)</p>}
    </div>
  );
}
