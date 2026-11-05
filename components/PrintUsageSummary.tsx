"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

/**
 * 複合機(プリンタ)利用量集計
 *
 * 複合機の管理ツールから出力される「部門ID別利用量」のExcel(pdeptidシート、
 * 部門ID・ユーザー名・トータルプリント・カラー/白黒トータル・カラー/白黒の
 * コピー/スキャン/プリント内訳、の11列構成)をこの画面にアップロードすると、
 * その場で(サーバーに送らず、ブラウザ内だけで)読みやすい一覧表にする。
 * データはどこにも保存しない(今回アップロードした1回分だけを見る用途)。
 */

const EXPECTED_HEADERS = [
  "部門ID",
  "ユーザー名",
  "トータルプリント",
  "カラートータル",
  "白黒トータル",
  "カラーコピー",
  "カラースキャン",
  "カラープリント",
  "白黒コピー",
  "白黒スキャン",
  "白黒プリント",
];

type UsageRow = {
  deptId: string;
  userName: string;
  totalPrint: number;
  colorTotal: number;
  monoTotal: number;
  colorCopy: number;
  colorScan: number;
  colorPrint: number;
  monoCopy: number;
  monoScan: number;
  monoPrint: number;
};

type FileState = {
  fileName: string;
  loading: boolean;
  error: string | null;
};

function initialFileState(): FileState {
  return { fileName: "", loading: false, error: null };
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

async function parseWorkbook(file: File): Promise<{ rows: UsageRow[]; warnings: string[] }> {
  // exceljsは動的import(このツールを開いた時だけ読み込む)。
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const buf = await file.arrayBuffer();
  await workbook.xlsx.load(buf);
  const warnings: string[] = [];

  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], warnings: ["シートが見つかりませんでした。"] };

  const headerRow = sheet.getRow(1).values as unknown[];
  // ExcelJSの行.valuesは先頭(index 0)が空になる1始まりの配列。
  const headerCells = headerRow.slice(1).map((v) => toStr(v));
  const headerOk = EXPECTED_HEADERS.every((h, i) => headerCells[i] === h);
  if (!headerOk) {
    warnings.push(
      `1行目の見出しが想定(${EXPECTED_HEADERS.join("・")})と異なります。複合機の部門ID別利用量のExcelで間違いないか確認してください。`
    );
  }

  const rows: UsageRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const v = row.values as unknown[];
    const deptIdRaw = v[1];
    if (deptIdRaw === null || deptIdRaw === undefined || deptIdRaw === "") return;
    rows.push({
      deptId: toStr(deptIdRaw),
      userName: toStr(v[2]),
      totalPrint: toNum(v[3]),
      colorTotal: toNum(v[4]),
      monoTotal: toNum(v[5]),
      colorCopy: toNum(v[6]),
      colorScan: toNum(v[7]),
      colorPrint: toNum(v[8]),
      monoCopy: toNum(v[9]),
      monoScan: toNum(v[10]),
      monoPrint: toNum(v[11]),
    });
  });

  if (rows.length === 0) {
    warnings.push("データ行が見つかりませんでした。");
  }
  return { rows, warnings };
}

function fmt(n: number): string {
  return n.toLocaleString("ja-JP");
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type SortKey = "total" | "deptId";

export default function PrintUsageSummary() {
  const [fileState, setFileState] = useState<FileState>(initialFileState());
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showZero, setShowZero] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("total");

  async function handleFile(f: File) {
    setFileState({ fileName: f.name, loading: true, error: null });
    setRows([]);
    setWarnings([]);
    try {
      const { rows: parsedRows, warnings: parsedWarnings } = await parseWorkbook(f);
      setRows(parsedRows);
      setWarnings(parsedWarnings);
      setFileState({ fileName: f.name, loading: false, error: null });
    } catch (e) {
      setFileState({ fileName: f.name, loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ユーザー名が無く利用量もすべて0の行は、使われていない部門IDの空き枠に過ぎないため
  // 既定では隠す(チェックボックスで表示に切り替え可能)。
  const visibleRows = useMemo(() => {
    const filtered = rows.filter((r) => showZero || r.userName || r.totalPrint > 0);
    const sorted = [...filtered].sort((a, b) =>
      sortKey === "total" ? b.totalPrint - a.totalPrint : Number(a.deptId) - Number(b.deptId)
    );
    return sorted;
  }, [rows, showZero, sortKey]);

  const totals = useMemo(() => {
    const t = {
      totalPrint: 0, colorTotal: 0, monoTotal: 0, colorCopy: 0, colorScan: 0,
      colorPrint: 0, monoCopy: 0, monoScan: 0, monoPrint: 0,
    };
    for (const r of visibleRows) {
      t.totalPrint += r.totalPrint;
      t.colorTotal += r.colorTotal;
      t.monoTotal += r.monoTotal;
      t.colorCopy += r.colorCopy;
      t.colorScan += r.colorScan;
      t.colorPrint += r.colorPrint;
      t.monoCopy += r.monoCopy;
      t.monoScan += r.monoScan;
      t.monoPrint += r.monoPrint;
    }
    return t;
  }, [visibleRows]);

  function downloadCsv() {
    if (visibleRows.length === 0) return;
    const header = ["部門ID", "ユーザー名", ...EXPECTED_HEADERS.slice(2)];
    const lines = [header.map(csvEscape).join(",")];
    visibleRows.forEach((r) => {
      lines.push(
        [r.deptId, r.userName, r.totalPrint, r.colorTotal, r.monoTotal, r.colorCopy, r.colorScan, r.colorPrint, r.monoCopy, r.monoScan, r.monoPrint]
          .map(csvEscape)
          .join(",")
      );
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `複合機利用集計_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rk">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1>複合機利用集計</h1>
          <p className="subtitle">
            複合機の部門ID別利用量Excel(pdeptidシート)をアップロードすると、その場で(サーバーに送らず)部門(ユーザー)ごとの利用量一覧を表示します。データはどこにも保存しません。
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
        <h2 style={{ marginTop: 0, fontSize: 16 }}>部門ID別利用量Excel</h2>
        <p className="cell-sub" style={{ margin: "0 0 8px" }}>
          ファイルをここにドラッグ&ドロップ、または下のボタンで選択してください。
        </p>
        <input
          type="file"
          accept=".xlsx"
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
              <div style={{ color: "var(--rk-good)" }}>{rows.length.toLocaleString("ja-JP")}件を読み込みました</div>
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
          <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h2>部門(ユーザー)別利用量</h2>
            <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />
                利用0件の部門も表示
              </label>
              <button
                className="ghost-btn"
                onClick={() => setSortKey((k) => (k === "total" ? "deptId" : "total"))}
              >
                並び順: {sortKey === "total" ? "トータルプリント順" : "部門ID順"}
              </button>
              <button className="ghost-btn" onClick={downloadCsv}>
                CSVダウンロード
              </button>
            </div>
          </div>
          <p style={{ fontSize: 15, fontWeight: 700, padding: "0 20px 2px" }}>
            トータルプリント合計: {fmt(totals.totalPrint)}枚(表示中 {visibleRows.length.toLocaleString("ja-JP")}件 / 全{rows.length.toLocaleString("ja-JP")}件)
          </p>
          <div className="matwrap">
            <table className="mat">
              <thead>
                <tr>
                  <th className="codecol">部門ID</th>
                  <th className="namecol">ユーザー名</th>
                  <th>トータル</th>
                  <th>カラー計</th>
                  <th>白黒計</th>
                  <th>カラーコピー</th>
                  <th>カラースキャン</th>
                  <th>カラープリント</th>
                  <th>白黒コピー</th>
                  <th>白黒スキャン</th>
                  <th>白黒プリント</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ fontWeight: 700, background: "#f5f7fb" }}>
                  <td className="codecol" colSpan={2}>合計</td>
                  <td><span className="cell-s">{fmt(totals.totalPrint)}</span></td>
                  <td><span className="cell-s">{fmt(totals.colorTotal)}</span></td>
                  <td><span className="cell-s">{fmt(totals.monoTotal)}</span></td>
                  <td><span className="cell-s">{fmt(totals.colorCopy)}</span></td>
                  <td><span className="cell-s">{fmt(totals.colorScan)}</span></td>
                  <td><span className="cell-s">{fmt(totals.colorPrint)}</span></td>
                  <td><span className="cell-s">{fmt(totals.monoCopy)}</span></td>
                  <td><span className="cell-s">{fmt(totals.monoScan)}</span></td>
                  <td><span className="cell-s">{fmt(totals.monoPrint)}</span></td>
                </tr>
                {visibleRows.map((r) => (
                  <tr key={r.deptId}>
                    <td className="codecol">{r.deptId}</td>
                    <td className="namecol">{r.userName || "(未設定)"}</td>
                    <td><span className="cell-s">{fmt(r.totalPrint)}</span></td>
                    <td><span className="cell-s">{fmt(r.colorTotal)}</span></td>
                    <td><span className="cell-s">{fmt(r.monoTotal)}</span></td>
                    <td><span className="cell-s">{fmt(r.colorCopy)}</span></td>
                    <td><span className="cell-s">{fmt(r.colorScan)}</span></td>
                    <td><span className="cell-s">{fmt(r.colorPrint)}</span></td>
                    <td><span className="cell-s">{fmt(r.monoCopy)}</span></td>
                    <td><span className="cell-s">{fmt(r.monoScan)}</span></td>
                    <td><span className="cell-s">{fmt(r.monoPrint)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
