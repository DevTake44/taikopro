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
 *
 * 2026-11-16追加: 「朝の在庫CSV」(仕入先コード・仕入先名上段/下段・品番・品名・仕様・
 * 朝の在庫数、の7列)を追加でアップロードできるようにし、品番で突き合わせて、仕入先の
 * 内訳(受注番号ごとの商品一覧)に「在庫数」列を加える。在庫CSV自体には拠点列が無いため、
 * 鳴尾(90)・土浦(91)の2つの枠に分けて読み込み、内訳の在庫数はその合計を表示する。
 *
 * 2026-11-17追加: 営業所コードを指定して、その営業所の注文明細を「在庫照合CSV」として
 * 出力する(発注金額・鳴尾/土浦在庫・在庫合計・差引(在庫合計-発注数)・判定・
 * 直近3か月の全拠点売上数)。売上数はサーバー(/api/recent-sales-qty)から取得する。
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
const LINE_NO_COL = 12; // 受注行番号
const ORDER_DATE_COL = 21; // 受注年月日
const BRANCH_COL = 23; // 営業所コード
const SPEC_COL = 30; // 仕様
const UNIT_COL = 38; // 単位名

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
  branchCode: string;
  lineNo: string;
  orderDate: string;
  spec: string;
  unit: string;
  supplierName: string;
  cost: number;
  qty: number;
};

type StockSlotKey = "naruo" | "tsuchiura";
const STOCK_SLOTS: { key: StockSlotKey; label: string }[] = [
  { key: "naruo", label: "鳴尾(90)" },
  { key: "tsuchiura", label: "土浦(91)" },
];

// 在庫CSV1件分(拠点1つ分)の読み込み結果。
type StockSlot = {
  fileName: string;
  rowCount: number;
  stockByProduct: Map<string, number>;
  warnings: string[];
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

// 固定長出力の全角スペース埋めを除く(語中の全角スペースは半角1つにする)。
function cleanText(v: string | undefined): string {
  return (v ?? "").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
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
      productName: cleanText(cols[PRODUCT_NAME_COL]),
      amount,
      branchCode: (cols[BRANCH_COL] || "").trim(),
      lineNo: (cols[LINE_NO_COL] || "").trim(),
      orderDate: (cols[ORDER_DATE_COL] || "").trim(),
      spec: cleanText(cols[SPEC_COL]),
      unit: cleanText(cols[UNIT_COL]),
      supplierName: cleanText(name),
      cost: toNum(cols[COST_COL]),
      qty: toNum(cols[QTY_COL]),
    });
  }

  const rows = Array.from(bySupplier.values()).sort((a, b) => b.amount - a.amount);
  if (rows.length === 0) {
    warnings.push("対象になる行(手配区分が空白・在庫以外)が1件もありませんでした。");
  }
  return { rows, lines, warnings };
}

// 朝の在庫CSV(仕入先コード,仕入先名上段,仕入先名下段,品番,品名,仕様,朝の在庫数)を読み込み、
// 品番→在庫数のMapを作る。同じ品番が複数行にあれば合算する。
function parseStockCsv(text: string): { stockByProduct: Map<string, number>; rowCount: number; warnings: string[] } {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const warnings: string[] = [];
  const header = parsed.meta.fields ?? [];
  if (!header.includes("品番") || !header.includes("朝の在庫数")) {
    warnings.push("1行目の見出しに「品番」「朝の在庫数」が見つかりません。朝の在庫CSVで間違いないか確認してください。");
  }

  const stockByProduct = new Map<string, number>();
  let rowCount = 0;
  for (const row of parsed.data) {
    const productCode = (row["品番"] ?? "").trim();
    if (!productCode) continue;
    const qty = toNum(row["朝の在庫数"]);
    stockByProduct.set(productCode, (stockByProduct.get(productCode) ?? 0) + qty);
    rowCount++;
  }
  return { stockByProduct, rowCount, warnings };
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

  const [stockSlots, setStockSlots] = useState<Record<StockSlotKey, StockSlot | null>>({ naruo: null, tsuchiura: null });
  const [stockErrors, setStockErrors] = useState<Record<StockSlotKey, string | null>>({ naruo: null, tsuchiura: null });
  const [branchCode, setBranchCode] = useState("90");
  const [exportState, setExportState] = useState<{ busy: boolean; message: string | null; error: string | null }>({
    busy: false,
    message: null,
    error: null,
  });

  // 内訳に出す在庫数は鳴尾・土浦の合計。
  const stockByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const { key } of STOCK_SLOTS) {
      const slot = stockSlots[key];
      if (!slot) continue;
      for (const [code, qty] of slot.stockByProduct) m.set(code, (m.get(code) ?? 0) + qty);
    }
    return m;
  }, [stockSlots]);

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

  async function handleStockFile(key: StockSlotKey, f: File) {
    try {
      const text = await readFileSmart(f);
      const { stockByProduct: parsed, rowCount, warnings: parsedWarnings } = parseStockCsv(text);
      setStockSlots((prev) => ({ ...prev, [key]: { fileName: f.name, rowCount, stockByProduct: parsed, warnings: parsedWarnings } }));
      setStockErrors((prev) => ({ ...prev, [key]: null }));
    } catch (e) {
      setStockErrors((prev) => ({ ...prev, [key]: `読み込みに失敗しました(${String(e)})` }));
    }
  }

  function clearStock(key: StockSlotKey) {
    setStockSlots((prev) => ({ ...prev, [key]: null }));
    setStockErrors((prev) => ({ ...prev, [key]: null }));
  }

  const branchLines = useMemo(() => lines.filter((l) => l.branchCode === branchCode.trim()), [lines, branchCode]);

  async function downloadBranchCheckCsv() {
    if (branchLines.length === 0) return;
    setExportState({ busy: true, message: null, error: null });
    let salesQty: Record<string, number> = {};
    try {
      const codes = Array.from(new Set(branchLines.map((l) => l.productCode).filter(Boolean)));
      const res = await fetch("/api/recent-sales-qty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes, months: 3 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      salesQty = json.qtyByCode ?? {};
    } catch (e) {
      setExportState({ busy: false, message: null, error: `直近3か月の売上数を取得できませんでした: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }

    const naruo = stockSlots.naruo?.stockByProduct;
    const tsuchiura = stockSlots.tsuchiura?.stockByProduct;
    const header = [
      "受注番号", "行", "受注日", "品番", "品名", "仕様", "単位", "仕入先コード", "仕入先名",
      "原価", "発注金額", "発注数", "鳴尾在庫(90)", "土浦在庫(91)", "在庫合計", "差引", "判定", "直近3か月売上数",
    ];
    const out = [header.map(csvEscape).join(",")];
    let totalAmount = 0;
    for (const l of branchLines) {
      const n = naruo?.get(l.productCode);
      const t = tsuchiura?.get(l.productCode);
      const hasStock = n !== undefined || t !== undefined;
      const stockTotal = (n ?? 0) + (t ?? 0);
      const diff = stockTotal - l.qty;
      const judge = !hasStock ? "在庫データなし" : diff >= 0 ? "在庫で足りる" : stockTotal > 0 ? "一部不足" : "在庫なし";
      totalAmount += l.amount;
      out.push(
        [
          l.orderNo, l.lineNo, l.orderDate, l.productCode, l.productName, l.spec, l.unit, l.supplierCode, l.supplierName,
          l.cost, Math.round(l.amount), l.qty, n ?? "", t ?? "", hasStock ? stockTotal : "", hasStock ? diff : "", judge,
          salesQty[l.productCode] ?? 0,
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    out.push(["合計", "", "", "", "", "", "", "", "", "", Math.round(totalAmount), "", "", "", "", "", "", ""].map(csvEscape).join(","));

    const blob = new Blob(["\ufeff" + out.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `営業所${branchCode.trim()}_注文明細_在庫照合_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportState({ busy: false, message: `${branchLines.length.toLocaleString("ja-JP")}件を出力しました。`, error: null });
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

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>朝の在庫CSV(任意)</h2>
        <p className="cell-sub" style={{ margin: "0 0 8px" }}>
          仕入先コード・仕入先名・品番・品名・仕様・朝の在庫数の列を持つCSVを、拠点ごとに選んでください。読み込むと、下の内訳一覧に在庫数(鳴尾+土浦の合計)が表示されます。
        </p>
        {STOCK_SLOTS.map(({ key, label }) => {
          const slot = stockSlots[key];
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, marginBottom: 8 }}>
              <span style={{ width: 70, fontWeight: 600 }}>{label}</span>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleStockFile(key, f);
                  e.target.value = "";
                }}
              />
              {slot && (
                <>
                  <span style={{ color: "var(--rk-good)" }}>
                    {slot.fileName}(品番{slot.rowCount.toLocaleString("ja-JP")}件)
                  </span>
                  <button className="ghost-btn" onClick={() => clearStock(key)}>
                    クリア
                  </button>
                </>
              )}
              {slot?.warnings.map((w, i) => (
                <span key={i} style={{ color: "var(--rk-warning)" }}>
                  {w}
                </span>
              ))}
              {stockErrors[key] && <span style={{ color: "var(--rk-critical)" }}>{stockErrors[key]}</span>}
            </div>
          );
        })}
      </div>

      {rows.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>営業所の注文明細を在庫照合してCSV出力</h2>
          <p className="cell-sub" style={{ margin: "0 0 8px" }}>
            指定した営業所コードの注文明細(手配区分が空白・在庫の行は除く)に、発注金額・鳴尾/土浦の在庫数・在庫合計・差引(在庫合計−発注数)・判定・直近3か月の売上数(全拠点・納品日基準)を付けてCSVで出力します。最終行は発注合計金額です。
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              営業所コード
              <input value={branchCode} onChange={(e) => setBranchCode(e.target.value)} style={{ width: 60, padding: "2px 6px" }} />
            </label>
            <span>
              対象 {branchLines.length.toLocaleString("ja-JP")}件・発注金額{" "}
              {fmtYen(branchLines.reduce((s, l) => s + l.amount, 0))}
            </span>
            <button className="ghost-btn" onClick={downloadBranchCheckCsv} disabled={branchLines.length === 0 || exportState.busy}>
              {exportState.busy ? (
                <>
                  <span className="spinner" />
                  作成中…
                </>
              ) : (
                "在庫照合CSVをダウンロード"
              )}
            </button>
            {!stockSlots.naruo && !stockSlots.tsuchiura && (
              <span style={{ color: "var(--rk-warning)" }}>在庫CSVが未読み込みのため、判定はすべて「在庫データなし」になります。</span>
            )}
          </div>
          {exportState.message && <div style={{ color: "var(--rk-good)", fontSize: 12.5, marginTop: 6 }}>{exportState.message}</div>}
          {exportState.error && <div style={{ color: "var(--rk-critical)", fontSize: 12.5, marginTop: 6 }}>{exportState.error}</div>}
        </div>
      )}

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
                        <span style={{ color: "var(--brand)" }}>{isOpen ? "▾ " : "▸ "}</span>
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
                                    {stockByProduct.size > 0 && <th title="朝の在庫CSVとの突き合わせ結果">在庫数</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.lines.map((l, i) => {
                                    const stockQty = l.productCode ? stockByProduct.get(l.productCode) : undefined;
                                    return (
                                      <tr key={i}>
                                        <td className="codecol">{l.productCode || "―"}</td>
                                        <td className="namecol">{l.productName || "―"}</td>
                                        <td><span className="cell-s">{fmtYen(l.amount)}</span></td>
                                        {stockByProduct.size > 0 && (
                                          <td>
                                            <span className="cell-s">{stockQty !== undefined ? stockQty.toLocaleString("ja-JP") : "―"}</span>
                                          </td>
                                        )}
                                      </tr>
                                    );
                                  })}
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
