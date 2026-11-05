"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";

/**
 * 複合機(プリンタ)利用量集計
 *
 * 複合機の管理ツールから出力される「部門ID別利用量」のExcel(pdeptidシート、
 * 部門ID・ユーザー名・トータルプリント・カラー/白黒トータル・カラー/白黒の
 * コピー/スキャン/プリント内訳、の11列構成)をこの画面にアップロードすると、
 * その場で(サーバーに送らず、ブラウザ内だけで)実際に使われている「集計表」の
 * フォーマットに合わせて集計する。
 *
 * 集計表フォーマット(サンプルのExcelの「集計表」シートから確認):
 * 部門ID・ユーザー名・カラートータル・白黒トータル・カラーコピー・カラープリント・
 * 白黒コピー・白黒プリント・コスト(円)の9列。コストは
 * カラートータル×カラー単価(既定7円) + 白黒トータル×白黒単価(既定0.7円) で、
 * この値の多い順に並べる(サンプルの数値と完全一致することを確認済み)。
 * トータルプリント・カラースキャン・白黒スキャンはこの集計表には含めない。
 * 最終行は表示対象行の小計。
 *
 * ユーザー名は複合機側で「*****」のようにマスクされていることがあり、サンプルでは
 * 手作業で実名に置き換えられていた。この画面でも部門IDごとに表示名を上書きできるようにし、
 * print_dept_names テーブル(dept_id・display_name)に保存する。全員で共有され、
 * 誰がどの端末で開いても同じ表示名になる。
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

async function loadNameOverrides(): Promise<Record<string, string>> {
  try {
    const res = await fetch("/api/print-dept-names");
    if (!res.ok) return {};
    const data = await res.json();
    return data.mapping ?? {};
  } catch {
    return {};
  }
}

async function saveNameOverride(deptId: string, displayName: string) {
  try {
    await fetch("/api/print-dept-names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dept_id: deptId, display_name: displayName }),
    });
  } catch {
    // 保存に失敗しても画面上の表示は変えたままにする(通信断など)。
  }
}

async function saveNameOverridesBulk(mapping: Record<string, string>) {
  await fetch("/api/print-dept-names", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapping }),
  });
}

async function parseWorkbook(file: File): Promise<{ rows: UsageRow[]; warnings: string[] }> {
  // exceljsは動的import(このツールを開いた時だけ読み込む)。
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const buf = await file.arrayBuffer();
  await workbook.xlsx.load(buf);
  const warnings: string[] = [];

  // 複数シートの場合(サンプルのように「集計表」シートが付いていることがある)、
  // 元データの列構成(pdeptid)に一致するシートを優先して探す。
  const sheet =
    workbook.worksheets.find((ws) => {
      const headerCells = (ws.getRow(1).values as unknown[]).slice(1).map((v) => toStr(v));
      return EXPECTED_HEADERS.every((h, i) => headerCells[i] === h);
    }) ?? workbook.worksheets[0];
  if (!sheet) return { rows: [], warnings: ["シートが見つかりませんでした。"] };

  const headerCells = (sheet.getRow(1).values as unknown[]).slice(1).map((v) => toStr(v));
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
  return Math.round(n).toLocaleString("ja-JP");
}

function fmtYen(n: number): string {
  return `¥${n.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}`;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// 複合機の利用者管理CSV(userData.csv、uid・cn(実名)・dept_id等の列を持つ)を文字コード
// 自動判定でデコードする。UTF-8 BOM付きでなければShift-JIS(このCSVの既定の文字コード)
// として読む。
async function readCsvSmart(file: File): Promise<string> {
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

type NameMappingResult = {
  mapping: Record<string, string>;
  appliedCount: number;
  conflictDeptIds: string[];
};

// 末尾の「(hyasumi)」「（tada）」のような注記を外した「素の名前」で同一人物とみなす
// (同じ人の複数アカウントで、cnにuid等の注記だけ付け足されているケースがあるため)。
function baseName(cn: string): string {
  return cn.replace(/[\s　]*[（(][^）)]*[）)]\s*$/, "").trim();
}

// userData.csvのdept_id列は "[0000011]" のように角括弧+ゼロ埋めで入っているため、
// 括弧を外し数値として正規化してから突き合わせる(複合機側のExcelは素の数値)。
function parseUserDataCsv(text: string): NameMappingResult {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const byDept = new Map<string, { uid: string; cn: string }[]>();
  for (const row of parsed.data) {
    const deptRaw = (row["dept_id"] ?? "").trim().replace(/^\[0*|\]$/g, "");
    const uid = (row["uid"] ?? "").trim();
    const cn = (row["cn"] ?? "").trim();
    if (!deptRaw || !/^\d+$/.test(deptRaw) || !cn) continue;
    const deptId = String(Number(deptRaw));
    if (!byDept.has(deptId)) byDept.set(deptId, []);
    byDept.get(deptId)!.push({ uid, cn });
  }

  const mapping: Record<string, string> = {};
  const conflictDeptIds: string[] = [];
  for (const [deptId, entries] of byDept) {
    // cnが漢字・かなを含む行を優先する(例: uid=akitoの行はcn="odagiriakito"と
    // ローマ字のuidをそのまま入れているだけで実名ではなく、別アカウントの
    // cn="小田切"の方が実名のため、こちらを優先したい)。
    const japaneseEntries = entries.filter((e) => /[぀-ヿ一-鿿]/.test(e.cn));
    const nonEchoEntries = (japaneseEntries.length > 0 ? japaneseEntries : entries).filter(
      (e) => e.cn.toLowerCase() !== e.uid.toLowerCase()
    );
    const candidates = nonEchoEntries.length > 0 ? nonEchoEntries : japaneseEntries.length > 0 ? japaneseEntries : entries;

    // 注記違いの表記ゆれ(安見(hyasumi)・安見（tada）・安見)は同じ人として1つにまとめ、
    // 代表値には注記の無い一番短い表記を選ぶ。
    const byBase = new Map<string, string[]>();
    for (const { cn } of candidates) {
      const base = baseName(cn) || cn;
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base)!.push(cn);
    }

    const chosen = Array.from(byBase.entries()).map(([base, variants]) => {
      const shortest = variants.reduce((a, b) => (b.length < a.length ? b : a));
      return shortest === base ? base : variants.includes(base) ? base : shortest;
    });

    mapping[deptId] = chosen[0];
    if (byBase.size > 1) conflictDeptIds.push(deptId);
  }
  return { mapping, appliedCount: byDept.size, conflictDeptIds };
}

export default function PrintUsageSummary() {
  const [fileState, setFileState] = useState<FileState>(initialFileState());
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showZero, setShowZero] = useState(false);
  const [colorRate, setColorRate] = useState(7);
  const [monoRate, setMonoRate] = useState(0.7);
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [mappingState, setMappingState] = useState<{ fileName: string; loading: boolean; error: string | null; result: NameMappingResult | null }>({
    fileName: "",
    loading: false,
    error: null,
    result: null,
  });

  useEffect(() => {
    loadNameOverrides().then(setNameOverrides);
  }, []);

  async function handleMappingFile(f: File) {
    setMappingState({ fileName: f.name, loading: true, error: null, result: null });
    try {
      const text = await readCsvSmart(f);
      const result = parseUserDataCsv(text);
      await saveNameOverridesBulk(result.mapping);
      setNameOverrides((prev) => ({ ...prev, ...result.mapping }));
      setMappingState({ fileName: f.name, loading: false, error: null, result });
    } catch (e) {
      setMappingState({ fileName: f.name, loading: false, error: e instanceof Error ? e.message : String(e), result: null });
    }
  }

  // 入力中は画面表示だけ更新し、キー入力ごとの通信は行わない。
  // 実際の保存(DB反映)はフォーカスが外れたタイミング(onBlur)でまとめて行う。
  function updateNameOverride(deptId: string, value: string) {
    setNameOverrides((prev) => {
      const next = { ...prev };
      if (value.trim()) next[deptId] = value;
      else delete next[deptId];
      return next;
    });
  }

  function commitNameOverride(deptId: string, value: string) {
    saveNameOverride(deptId, value);
  }

  function displayName(r: UsageRow): string {
    return nameOverrides[r.deptId] ?? r.userName;
  }

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

  function cost(r: UsageRow): number {
    return r.colorTotal * colorRate + r.monoTotal * monoRate;
  }

  // ユーザー名(表示名)が無く利用量もすべて0の行は、使われていない部門IDの空き枠に
  // 過ぎないため既定では隠す(チェックボックスで表示に切り替え可能)。
  const visibleRows = useMemo(() => {
    const filtered = rows.filter((r) => showZero || displayName(r) || r.totalPrint > 0);
    return [...filtered].sort((a, b) => cost(b) - cost(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, showZero, nameOverrides, colorRate, monoRate]);

  const totals = useMemo(() => {
    const t = { colorTotal: 0, monoTotal: 0, colorCopy: 0, colorPrint: 0, monoCopy: 0, monoPrint: 0, cost: 0 };
    for (const r of visibleRows) {
      t.colorTotal += r.colorTotal;
      t.monoTotal += r.monoTotal;
      t.colorCopy += r.colorCopy;
      t.colorPrint += r.colorPrint;
      t.monoCopy += r.monoCopy;
      t.monoPrint += r.monoPrint;
      t.cost += cost(r);
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows]);

  function downloadCsv() {
    if (visibleRows.length === 0) return;
    const header = ["部門ID", "ユーザー名", "カラートータル", "白黒トータル", "カラーコピー", "カラープリント", "白黒コピー", "白黒プリント", "コスト(円)"];
    const lines = [header.map(csvEscape).join(",")];
    visibleRows.forEach((r) => {
      lines.push(
        [r.deptId, displayName(r), r.colorTotal, r.monoTotal, r.colorCopy, r.colorPrint, r.monoCopy, r.monoPrint, Math.round(cost(r) * 10) / 10]
          .map(csvEscape)
          .join(",")
      );
    });
    lines.push(
      ["", "小計", totals.colorTotal, totals.monoTotal, totals.colorCopy, totals.colorPrint, totals.monoCopy, totals.monoPrint, Math.round(totals.cost * 10) / 10]
        .map(csvEscape)
        .join(",")
    );
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
            複合機の部門ID別利用量Excel(pdeptidシート)をアップロードすると、その場で(サーバーに送らず)集計表(部門ID・ユーザー名・カラー/白黒トータル・コピー/プリント内訳・コスト)を作成します。利用量データ自体はどこにも保存しませんが、部門IDの表示名(実名)は共有のデータベースに保存され、次回以降は誰が開いても同じ表示名になります。
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
            <h2>集計表(コストの多い順)</h2>
            <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                カラー単価
                <input
                  type="number"
                  value={colorRate}
                  onChange={(e) => setColorRate(Number(e.target.value) || 0)}
                  style={{ width: 50, padding: "2px 4px" }}
                />
                円
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                白黒単価
                <input
                  type="number"
                  value={monoRate}
                  onChange={(e) => setMonoRate(Number(e.target.value) || 0)}
                  style={{ width: 50, padding: "2px 4px" }}
                />
                円
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />
                利用0件の部門も表示
              </label>
              <button className="ghost-btn" onClick={downloadCsv}>
                CSVダウンロード
              </button>
            </div>
          </div>
          <p style={{ fontSize: 15, fontWeight: 700, padding: "0 20px 2px" }}>
            コスト小計: {fmtYen(totals.cost)}(表示中 {visibleRows.length.toLocaleString("ja-JP")}件 / 全{rows.length.toLocaleString("ja-JP")}件)
          </p>
          <div style={{ margin: "0 20px 14px", padding: 12, border: "1px dashed var(--rk-direct)", borderRadius: 8 }}>
            <div style={{ fontSize: 12.5, marginBottom: 6 }}>
              ユーザー名が「*****」等でマスクされている場合、複合機の利用者管理CSV(userData.csv、uid・cn・dept_id列を持つもの)を取り込むと、部門IDに対応する実名を一括で当てられます。
            </div>
            <input
              type="file"
              accept=".csv"
              disabled={mappingState.loading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleMappingFile(f);
                e.target.value = "";
              }}
            />
            {mappingState.fileName && (
              <div style={{ marginTop: 6, fontSize: 12.5 }}>
                {mappingState.loading && (
                  <div style={{ color: "var(--rk-direct)" }}>
                    <span className="spinner" />
                    読み込み中…
                  </div>
                )}
                {mappingState.error && <div style={{ color: "var(--rk-critical)" }}>{mappingState.error}</div>}
                {mappingState.result && (
                  <div style={{ color: "var(--rk-good)" }}>
                    {mappingState.result.appliedCount.toLocaleString("ja-JP")}件の部門IDに実名を当てました。
                    {mappingState.result.conflictDeptIds.length > 0 && (
                      <span style={{ color: "var(--rk-warning)" }}>
                        {" "}
                        部門ID {mappingState.result.conflictDeptIds.join("・")} は同じ部門IDに複数の異なる実名が見つかったため、どれか1つを仮で当てています。下の表で確認・修正してください。
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="cell-sub" style={{ padding: "0 20px 12px" }}>
            ユーザー名はクリックして直接修正できます(共有のデータベースに保存され、次回以降は誰が開いても同じ表示名になります)。
          </p>
          <div className="matwrap">
            <table className="mat">
              <thead>
                <tr>
                  <th className="codecol">部門ID</th>
                  <th className="namecol">ユーザー名</th>
                  <th>カラー計</th>
                  <th>白黒計</th>
                  <th>カラーコピー</th>
                  <th>カラープリント</th>
                  <th>白黒コピー</th>
                  <th>白黒プリント</th>
                  <th>コスト</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.deptId}>
                    <td className="codecol">{r.deptId}</td>
                    <td className="namecol">
                      <input
                        value={nameOverrides[r.deptId] ?? r.userName}
                        onChange={(e) => updateNameOverride(r.deptId, e.target.value)}
                        onBlur={(e) => commitNameOverride(r.deptId, e.target.value)}
                        placeholder={r.userName || "(未設定)"}
                        style={{ width: "100%", border: "none", background: "transparent", font: "inherit", padding: "2px 0" }}
                      />
                    </td>
                    <td><span className="cell-s">{fmt(r.colorTotal)}</span></td>
                    <td><span className="cell-s">{fmt(r.monoTotal)}</span></td>
                    <td><span className="cell-s">{fmt(r.colorCopy)}</span></td>
                    <td><span className="cell-s">{fmt(r.colorPrint)}</span></td>
                    <td><span className="cell-s">{fmt(r.monoCopy)}</span></td>
                    <td><span className="cell-s">{fmt(r.monoPrint)}</span></td>
                    <td><span className="cell-s">{fmtYen(cost(r))}</span></td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, background: "#f5f7fb" }}>
                  <td className="codecol" colSpan={2}>小計</td>
                  <td><span className="cell-s">{fmt(totals.colorTotal)}</span></td>
                  <td><span className="cell-s">{fmt(totals.monoTotal)}</span></td>
                  <td><span className="cell-s">{fmt(totals.colorCopy)}</span></td>
                  <td><span className="cell-s">{fmt(totals.colorPrint)}</span></td>
                  <td><span className="cell-s">{fmt(totals.monoCopy)}</span></td>
                  <td><span className="cell-s">{fmt(totals.monoPrint)}</span></td>
                  <td><span className="cell-s">{fmtYen(totals.cost)}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
