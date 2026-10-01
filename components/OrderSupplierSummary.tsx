"use client";

import { useMemo, useState } from "react";
import Papa from "papaparse";
import Link from "next/link";

/**
 * 受注 仕入先別発注金額
 *
 * 受注出力CSV(社内間金額機能の「受注出力CSV」と同じ列構成)をこの画面にアップロードすると、
 * その場で(サーバーに送らず、ブラウザ内だけで)仕入先ごとの発注金額を集計して表示する。
 * データはどこにも保存しない。
 *
 * びっきぃ作成のExcelマクロ(Make_Order_Summary)をそのまま移植したもの。ロジックは同じ:
 * 列49(0始まり、Excel AX列)の手配区分が空白または「在庫」の行は対象外とし、
 * 残りの行だけ 列34(受注総数量)×列53(原価) を仕入先コード(列50、AY列)ごとに合計する。
 * 仕入先名は列51(AZ列)から拾う。結果は発注金額の多い順に並べる。
 */

const MIN_COLS = 54;
const ORDER_NO_COL = 11; // L列: 受注番号
const HAND_TYPE_COL = 49; // AX列: 手配区分
const PRODUCT_CODE_COL = 27; // AB列: 品番
const PRODUCT_NAME_COL = 29; // AD列: 品名
const QTY_COL = 34; // AI列: 受注総数量
const COST_COL = 53; // BB列: 原価
const SUPPLIER_CODE_COL = 50; // AY列: 仕入先コード
const SUPPLIER_NAME_COL = 51; // AZ列: 仕入先名1

type SupplierRow = {
  code: string;
  name: string;
  amount: number;
  count: number;
};

// 仕入先名クリックで内訳(受注番号単位・商品)を見られるようにするための明細行。
type OrderLine = {
  supplierCode: string;
  orderNo: string;
  productCode: string;
  productName: string;
  amount: number;
};

type FileState = {
  fileName: string;
  loading: boolean;
  error: string | null;
};

function initialFileState(): FileState {
  return { fileName: "", loading: false, error: null };
}

async function readFileSmart(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buf);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("shift_jis").decode(buf);
  }
}

// 全角スペース・NBSPなど見えない空白を除去してから判定する(元マクロのWorksheetFunction.Clean
// 相当の処理)。
function cleanHandType(v: string | undefined): string {
  return (v ?? "").replace(/[　 ]/g, "").trim();
}

function toNum(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s.trim());
  return Number.isFinite(n) ? n : 0;
}

function fmtYen(n: number): string {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseOrderCsv(text: string): { rows: SupplierRow[]; lines: OrderLine[]; warnings: string[] } {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const allRows = parsed.data;
  const warnings: string[] = [];

  if (allRows.length < 2) {
    return { rows: [], lines: [], warnings: ["データ行が見つかりませんでした。"] };
  }

  const header = allRows[0];
  const headerOk =
    (header[0] || "").trim() === "得意先コード" &&
    (header[1] || "").trim() === "請求統括店コード" &&
    (header[2] || "").trim() === "得意先名１";
  if (!headerOk) {
    warnings.push(
      "1行目の見出しが「得意先コード, 請求統括店コード, 得意先名１...」になっていません。受注出力CSVで間違いないか確認してください。"
    );
  }

  const dataRows = allRows.slice(1).filter((r) => r.length >= MIN_COLS);
  const skippedShort = allRows.length - 1 - dataRows.length;
  if (skippedShort > 0) {
    warnings.push(`列数が足りない行を${skippedShort.toLocaleString("ja-JP")}件スキップしました。`);
  }

  const bySupplier = new Map<string, SupplierRow>();
  const lines: OrderLine[] = [];
  for (const cols of dataRows) {
    const hand = cleanHandType(cols[HAND_TYPE_COL]);
    if (hand === "" || hand === "在庫") continue;

    const code = (cols[SUPPLIER_CODE_COL] || "").trim();
    const name = (cols[SUPPLIER_NAME_COL] || "").trim();
    const amount = toNum(cols[QTY_COL]) * toNum(cols[COST_COL]);

    const existing = bySupplier.get(code);
    if (existing) {
      existing.amount += amount;
      existing.count += 1;
      if (!existing.name && name) existing.name = name;
    } else {
      bySupplier.set(code, { code, name, amount, count: 1 });
    }

    lines.push({
      supplierCode: code,
      orderNo: (cols[ORDER_NO_COL] || "").trim(),
      productCode: (cols[PRODUCT_CODE_COL] || "").trim(),
      productName: (cols[PRODUCT_NAME_COL] || "").trim(),
      amount,
    });
  }

  const rows = Array.from(bySupplier.values()).sort((a, b) => b.amount - a.amount);
  if (rows.length === 0) {
    warnings.push("対象になる行(手配区分が空白・在庫以外)が1件もありませんでした。");
  }
  return { rows, lines, warnings };
}

type OrderGroup = { orderNo: string; amount: number; lines: OrderLine[] };

// 仕入先1件分の明細を、受注番号単位(発注金額の多い順)にまとめる。
// 各受注番号の中の商品行も、金額の多い順に並べる。
function buildOrderGroups(lines: OrderLine[], supplierCode: string): OrderGroup[] {
  const byOrder = new Map<string, OrderLine[]>();
  for (const line of lines) {
    if (line.supplierCode !== supplierCode) continue;
    const arr = byOrder.get(line.orderNo) ?? [];
    arr.push(line);
    byOrder.set(line.orderNo, arr);
  }
  const groups: OrderGroup[] = Array.from(byOrder.entries()).map(([orderNo, orderLines]) => ({
    orderNo,
    amount: orderLines.reduce((s, l) => s + l.amount, 0),
    lines: [...orderLines].sort((a, b) => b.amount - a.amount),
  }));
  groups.sort((a, b) => b.amount - a.amount);
  return groups;
}

export default function OrderSupplierSummary() {
  const [fileState, setFileState] = useState<FileState>(initialFileState());
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [openSupplier, setOpenSupplier] = useState<string | null>(null);

  async function handleFile(f: File) {
    setFileState({ fileName: f.name, loading: true, error: null });
    setRows([]);
    setLines([]);
    setWarnings([]);
    setOpenSupplier(null);
    try {
      const text = await readFileSmart(f);
      const { rows: parsedRows, lines: parsedLines, warnings: parsedWarnings } = parseOrderCsv(text);
      setRows(parsedRows);
      setLines(parsedLines);
      setWarnings(parsedWarnings);
      setFileState({ fileName: f.name, loading: false, error: null });
    } catch (e) {
      setFileState({ fileName: f.name, loading: false, error: String(e) });
    }
  }

  const total = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);
  const openOrderGroups = useMemo(
    () => (openSupplier ? buildOrderGroups(lines, openSupplier) : []),
    [lines, openSupplier]
  );

  function downloadCsv() {
    if (rows.length === 0) return;
    const lines = [["仕入先コード", "仕入先名", "発注金額計", "明細件数"].map(csvEscape).join(",")];
    rows.forEach((r) => {
      lines.push([r.code, r.name, Math.round(r.amount), r.count].map(csvEscape).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `受注_仕入先別発注金額_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rk">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1>受注 仕入先別発注金額</h1>
          <p className="subtitle">
            受注出力CSVをこの画面にアップロードすると、その場で(サーバーに送信せず)仕入先ごとの発注金額(受注総数量×原価)を集計し、金額の多い順に表示します。手配区分が空白・在庫の行は対象外です。
          </p>
        </div>
        <Link href="/dx" className="ghost-btn" style={{ textDecoration: "none" }}>
          ← 社内DXメニュー
        </Link>
      </div>

      <div
        className="card"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        style={{ marginBottom: 20, ...(isDragging ? { outline: "2px dashed var(--rk-direct)", outlineOffset: -2 } : {}) }}
      >
        <h2 style={{ marginTop: 0, fontSize: 16 }}>受注出力CSV</h2>
        <p className="cell-sub" style={{ margin: "0 0 8px" }}>
          ファイルをここにドラッグ&ドロップ、または下のボタンで選択してください。
        </p>
        <input
          type="file"
          accept=".csv"
          disabled={fileState.loading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        {fileState.fileName && (
          <div style={{ marginTop: 10, fontSize: 12.5 }}>
            <div>ファイル: {fileState.fileName}</div>
            {fileState.loading && (
              <div style={{ color: "var(--rk-direct)" }}>
                <span className="spinner" />
                読み込み中…
              </div>
            )}
            {!fileState.loading && rows.length > 0 && (
              <div style={{ color: "var(--rk-good)" }}>仕入先{rows.length.toLocaleString("ja-JP")}件を集計しました</div>
            )}
            {fileState.error && <div style={{ color: "var(--rk-critical)" }}>{fileState.error}</div>}
            {warnings.map((w, i) => (
              <div key={i} style={{ color: "var(--rk-warning)" }}>
                {w}
              </div>
            ))}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="card">
          <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2>仕入先別 発注金額(多い順)</h2>
            <button className="ghost-btn" onClick={downloadCsv}>
              CSVダウンロード
            </button>
          </div>
          <p style={{ fontSize: 15, fontWeight: 700, padding: "0 20px 2px" }}>
            発注金額合計: {fmtYen(total)}(仕入先{rows.length.toLocaleString("ja-JP")}件)
          </p>
          <p className="cell-sub" style={{ padding: "0 20px 12px" }}>
            仕入先名をクリックすると、受注番号単位(発注金額の多い順)に商品の内訳を表示します。
          </p>
          <div className="matwrap">
            <table className="mat">
              <thead>
                <tr>
                  <th className="codecol">仕入先コード</th>
                  <th className="namecol">仕入先名</th>
                  <th>発注金額計</th>
                  <th>明細件数</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((r) => {
                  const isOpen = openSupplier === r.code;
                  const mainRow = (
                    <tr
                      key={r.code}
                      onClick={() => setOpenSupplier(isOpen ? null : r.code)}
                      style={{ cursor: "pointer", background: isOpen ? "#f5f7fb" : undefined }}
                      title="クリックで受注番号単位の内訳を表示"
                    >
                      <td className="codecol">{r.code}</td>
                      <td className="namecol">
                        <span style={{ color: "#2563d9" }}>{isOpen ? "▾ " : "▸ "}</span>
                        {r.name || "(名称不明)"}
                      </td>
                      <td><span className="cell-s">{fmtYen(r.amount)}</span></td>
                      <td><span className="cell-s">{r.count.toLocaleString("ja-JP")}</span></td>
                    </tr>
                  );
                  if (!isOpen) return [mainRow];

                  const detailRow = (
                    <tr key={`${r.code}-detail`}>
                      <td colSpan={4} style={{ padding: 0, background: "#fafbfc" }}>
                        <div style={{ padding: "10px 20px 16px 40px" }}>
                          <div style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 6 }}>
                            {r.name || r.code} の内訳(受注番号{openOrderGroups.length}件・発注金額の多い順)
                          </div>
                          {openOrderGroups.map((g) => (
                            <div key={g.orderNo} style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>
                                受注番号 {g.orderNo || "(空欄)"} ― {fmtYen(g.amount)}
                              </div>
                              <table className="mat" style={{ width: "100%" }}>
                                <thead>
                                  <tr>
                                    <th className="codecol">品番</th>
                                    <th className="namecol">品名</th>
                                    <th>金額</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.lines.map((l, i) => (
                                    <tr key={i}>
                                      <td className="codecol">{l.productCode || "―"}</td>
                                      <td className="namecol">{l.productName || "―"}</td>
                                      <td><span className="cell-s">{fmtYen(l.amount)}</span></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                  return [mainRow, detailRow];
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
