"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { UnsoldPurchaseRow } from "@/lib/unsoldPurchases";
import RefreshButton from "./RefreshButton";

type SortKey = "purchase_date" | "daysSincePurchase" | "amount" | "referenceSellPrice";

function fmtYen(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `¥${Math.round(v).toLocaleString("ja-JP")}`;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "ja"));
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function UnsoldPurchasesDashboard({
  rows,
  asOf,
}: {
  rows: UnsoldPurchaseRow[];
  asOf: string;
}) {
  const router = useRouter();
  const [destination, setDestination] = useState("");
  const [item, setItem] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  async function handleRefresh() {
    const res = await fetch("/api/revalidate-sales-data", { method: "POST" });
    if (!res.ok) throw new Error("更新に失敗しました");
    router.refresh();
  }

  const destinations = useMemo(() => uniqueSorted(rows.map((r) => r.destinationLabel)), [rows]);

  const filtered = useMemo(() => {
    const it = item.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!destination || r.destinationLabel === destination) &&
        (!it ||
          (r.product_name ?? "").toLowerCase().includes(it) ||
          (r.product_code ?? "").toLowerCase().includes(it))
    );
  }, [rows, destination, item]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return cmp * sortDir;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1) as 1 | -1);
    } else {
      setSortKey(key);
      setSortDir(-1);
    }
  }
  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === 1 ? "▴" : "▾") : "");

  const totalAmount = filtered.reduce((s, r) => s + r.amount, 0);
  const destinationCount = new Set(filtered.map((r) => r.destinationLabel)).size;

  function downloadCsv() {
    if (!sorted.length) return;
    const headers = [
      "拠点/倉庫", "品番", "品名", "仕入先", "仕入日", "経過日数",
      "数量", "仕入単価", "仕入金額", "参考売価(過去の売上実績)", "仕入番号",
    ];
    const lines = [headers.map(csvEscape).join(",")];
    sorted.forEach((r) => {
      lines.push(
        [
          r.destinationLabel, r.product_code, r.product_name, r.supplier_name,
          r.purchase_date, r.daysSincePurchase, r.qty, r.unit_price, r.amount,
          r.referenceSellPrice, `${r.purchase_number}-${r.purchase_line}`,
        ]
          .map(csvEscape)
          .join(",")
      );
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `仕入未売上一覧_${asOf}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="wrap" style={{ maxWidth: 1200 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>仕入未売上一覧</h1>
          <p>
            納品先が倉庫・拠点(自社の在庫・拠点向け)の仕入のうち、受注番号で売上明細と突き合わせても
            対応する売上が見つからないものを一覧化します。売上実績上、一度も売れたことが無い商品
            (在庫・サンプル用途の可能性)は対象外にしています。基準日: {asOf}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <RefreshButton onRefresh={handleRefresh} />
          <Link href="/dx" className="ghost-btn-inline">
            ← 社内DXメニュー
          </Link>
        </div>
      </header>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>絞り込み</h2>
        <div className="filter-row">
          <div className="filter-field">
            <label>拠点/倉庫</label>
            <select value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="">すべて({destinations.length})</option>
              {destinations.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label>品番・品名検索</label>
            <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="品番・品名の一部を入力" />
          </div>
        </div>
        <div className="filter-actions">
          <button className="ghost-btn" onClick={downloadCsv} disabled={!sorted.length}>
            この一覧をCSVでダウンロード
          </button>
          <span className="result-count">{sorted.length.toLocaleString("ja-JP")}件を表示中</span>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi-tile">
          <div className="label">未売上 件数</div>
          <div className="value">{filtered.length.toLocaleString("ja-JP")}</div>
        </div>
        <div className="kpi-tile">
          <div className="label">未売上 仕入金額合計</div>
          <div className="value">{fmtYen(totalAmount)}</div>
        </div>
        <div className="kpi-tile">
          <div className="label">対象拠点/倉庫数</div>
          <div className="value">{destinationCount}</div>
        </div>
      </div>

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>拠点/倉庫</th>
                <th>品番/品名</th>
                <th>仕入先</th>
                <th className="num sortable-th" onClick={() => toggleSort("purchase_date")}>
                  仕入日 {sortArrow("purchase_date")}
                </th>
                <th className="num sortable-th" onClick={() => toggleSort("daysSincePurchase")}>
                  経過日数 {sortArrow("daysSincePurchase")}
                </th>
                <th className="num">数量</th>
                <th className="num sortable-th" onClick={() => toggleSort("amount")}>
                  仕入金額 {sortArrow("amount")}
                </th>
                <th className="num sortable-th" onClick={() => toggleSort("referenceSellPrice")}>
                  参考売価 {sortArrow("referenceSellPrice")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-state">
                    この条件に一致する未売上の仕入はありません
                  </td>
                </tr>
              )}
              {sorted.map((r) => (
                <tr key={`${r.purchase_number}-${r.purchase_line}`}>
                  <td
                    className="clickable-cell"
                    onClick={() => setDestination(r.destinationLabel)}
                  >
                    {r.destinationLabel}
                  </td>
                  <td className="truncate-cell" title={r.product_name ?? ""}>
                    {r.product_name ?? "—"}
                    <div className="cell-sub">{r.product_code || "品番未登録"}</div>
                  </td>
                  <td>{r.supplier_name ?? "—"}</td>
                  <td className="num">{r.purchase_date ?? "—"}</td>
                  <td className="num">{r.daysSincePurchase != null ? `${r.daysSincePurchase}日` : "—"}</td>
                  <td className="num">{r.qty ?? "—"}</td>
                  <td className="num">{fmtYen(r.amount)}</td>
                  <td className="num">{fmtYen(r.referenceSellPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
