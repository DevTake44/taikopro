"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { repNameOnly } from "@/lib/rep-names";
import type { UnsoldPurchaseRow } from "@/lib/unsoldPurchases";

type CustomerGroup = {
  customerCode: string;
  customerName: string;
  total: number;
  rows: UnsoldPurchaseRow[];
};
type StaffGroup = {
  staffCode: string;
  staffName: string;
  total: number;
  customers: CustomerGroup[];
};

function buildGroups(rows: UnsoldPurchaseRow[]): StaffGroup[] {
  const staffMap = new Map<string, Map<string, UnsoldPurchaseRow[]>>();
  for (const row of rows) {
    const staffKey = row.staff_code ?? "";
    const custKey = `${row.customer_code ?? ""}|${row.customer_name ?? ""}`;
    if (!staffMap.has(staffKey)) staffMap.set(staffKey, new Map());
    const custMap = staffMap.get(staffKey)!;
    if (!custMap.has(custKey)) custMap.set(custKey, []);
    custMap.get(custKey)!.push(row);
  }

  const staffGroups: StaffGroup[] = [];
  for (const [staffCode, custMap] of staffMap) {
    const customers: CustomerGroup[] = [];
    for (const [custKey, custRows] of custMap) {
      const [customerCode, customerName] = custKey.split("|");
      custRows.sort((a, b) => (b.purchase_date ?? "").localeCompare(a.purchase_date ?? ""));
      customers.push({
        customerCode,
        customerName: customerName || "(得意先不明)",
        total: custRows.reduce((s, r) => s + r.amount, 0),
        rows: custRows,
      });
    }
    customers.sort((a, b) => b.total - a.total);
    staffGroups.push({
      staffCode,
      staffName: repNameOnly(staffCode) || "(担当者不明)",
      total: customers.reduce((s, c) => s + c.total, 0),
      customers,
    });
  }
  staffGroups.sort((a, b) => b.total - a.total);
  return staffGroups;
}

export default function UnsoldPurchasesDashboard() {
  const [rows, setRows] = useState<UnsoldPurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedCount, setLoadedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staffFilter, setStaffFilter] = useState<string>("");
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setRows([]);
    setLoadedCount(0);
    setTotalCount(0);
    try {
      let from = 0;
      let all: UnsoldPurchaseRow[] = [];
      while (true) {
        const res = await fetch(`/api/unsold-purchases?from=${from}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "取得に失敗しました");
        all = all.concat(json.rows as UnsoldPurchaseRow[]);
        setTotalCount(json.total as number);
        setLoadedCount(all.length);
        setRows(all);
        if (!json.hasMore) break;
        from = json.nextFrom as number;
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const staffOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.staff_code ?? "", repNameOnly(r.staff_code) || "(担当者不明)");
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "ja"));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const kw = keyword.trim();
    return rows
      .filter((r) => !staffFilter || (r.staff_code ?? "") === staffFilter)
      .filter((r) => {
        if (!kw) return true;
        return (
          (r.customer_name ?? "").includes(kw) ||
          (r.product_name ?? "").includes(kw) ||
          (r.product_code ?? "").includes(kw) ||
          r.order_no.includes(kw)
        );
      });
  }, [rows, staffFilter, keyword]);

  const groups = useMemo(() => buildGroups(filteredRows), [filteredRows]);
  const grandTotal = useMemo(() => groups.reduce((s, g) => s + g.total, 0), [groups]);

  return (
    <div className="wrap" style={{ maxWidth: 1100 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>未売上仕入チェック</h1>
          <p>
            仕入の「受注番号+受注行番号」に対応する売上明細が無いものを、担当者→得意先の単位で一覧化します。
            運賃・在庫仕入(拠点90・91)は対象外です。
          </p>
        </div>
        <Link href="/dx" className="ghost-btn-inline">
          ← 社内DXメニュー
        </Link>
      </header>

      <div className="card">
        <div
          className="card-head"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}
        >
          <h2>未売上一覧</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 13, color: "var(--ink-faint)" }}>担当者:</label>
              <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} style={{ padding: "5px 8px", fontSize: 13 }}>
                <option value="">すべて({staffOptions.length}名)</option>
                {staffOptions.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 13, color: "var(--ink-faint)" }}>キーワード:</label>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="得意先名・品番・品名・受注番号"
                style={{ padding: "5px 8px", fontSize: 13, width: 220 }}
              />
            </div>
          </div>
        </div>
        <div style={{ padding: "0 20px 20px" }}>
          {loading && (
            <p className="cell-sub">
              <span className="spinner" />
              読み込み中… {loadedCount.toLocaleString()}
              {totalCount > 0 ? ` / ${totalCount.toLocaleString()}` : ""}件
            </p>
          )}
          {loadError && <p style={{ color: "var(--neg)" }}>{loadError}</p>}
          {!loading && !loadError && (
            <>
              <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>
                未売上合計: ¥{grandTotal.toLocaleString()}(全{filteredRows.length.toLocaleString()}件)
              </p>
              {groups.length === 0 && <p className="cell-sub">該当する未売上仕入はありません。</p>}
              {groups.map((staff) => (
                <div key={staff.staffCode} style={{ marginBottom: 24 }}>
                  <h3 style={{ fontSize: 15, borderBottom: "2px solid #2563d9", paddingBottom: 6, marginBottom: 10 }}>
                    {staff.staffName} 合計: ¥{staff.total.toLocaleString()}
                  </h3>
                  {staff.customers.map((cust) => (
                    <div key={cust.customerCode} style={{ marginLeft: 12, marginBottom: 14 }}>
                      <h4 style={{ fontSize: 13.5, marginBottom: 6, color: "#1f2d3d" }}>
                        {cust.customerName} 小計: ¥{cust.total.toLocaleString()}
                      </h4>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>仕入日</th>
                              <th>受注番号</th>
                              <th>品番</th>
                              <th>品名</th>
                              <th>金額</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cust.rows.map((r) => (
                              <tr key={`${r.purchase_number}_${r.purchase_line}`}>
                                <td>{r.purchase_date ?? "—"}</td>
                                <td>{r.order_no}</td>
                                <td>{r.product_code ?? "—"}</td>
                                <td>{r.product_name ?? "—"}</td>
                                <td>¥{r.amount.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
