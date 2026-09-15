"use client";
import { useState, type DragEvent } from "react";
import Link from "next/link";
import Papa from "papaparse";
import type { TableStatus } from "@/lib/fetchDataStatus";
import DataStatusTable from "./DataStatusTable";
import RiekiUploadBoxes from "./RiekiUploadBoxes";
import { decodeCsvBuffer } from "@/lib/csvDecode";
import { transformSalesCsv } from "@/lib/salesTransform";
import { transformPurchasesCsv } from "@/lib/purchasesTransform";
import { transformProductMasterCsv } from "@/lib/productMasterTransform";
import { transformSupplierMasterCsv } from "@/lib/supplierMasterTransform";

const CHUNK_SIZE = 1000;

type Progress = {
  stage: "idle" | "reading" | "uploading" | "cleaning" | "refreshing" | "done" | "error";
  sentCount?: number;
  totalCount?: number;
};
type FinalResult = {
  error?: string;
  rowCount?: number;
  skippedCount?: number;
  skippedSample?: string[];
  totalAmount?: number;
  extraInfo?: string;
};

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: "サーバーからの応答を読み取れませんでした。" }));
  if (!res.ok) {
    throw new Error(json?.error ?? `サーバーエラー(status ${res.status})`);
  }
  return json;
}

async function uploadRowsInChunks(
  rows: unknown[],
  commitEndpoint: string,
  onProgress: (sent: number, total: number) => void
) {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await postJson(commitEndpoint, { rows: chunk });
    onProgress(Math.min(i + CHUNK_SIZE, rows.length), rows.length);
  }
}

function SalesUploadBox() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<Progress>({ stage: "idle" });
  const [result, setResult] = useState<FinalResult | null>(null);

  async function handleUpload() {
    if (!file) return;
    setResult(null);
    try {
      setProgress({ stage: "reading" });
      const buf = await file.arrayBuffer();
      const text = decodeCsvBuffer(buf);
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
      const fatalErrors = parsed.errors.filter((e) => e.type !== "FieldMismatch");
      if (fatalErrors.length > 0) {
        throw new Error("CSVの読み込み中にエラーが発生しました: " + fatalErrors[0].message);
      }
      const { rows, skipped } = transformSalesCsv(parsed.data);
      if (rows.length === 0) {
        throw new Error("有効なデータ行がありませんでした。");
      }
      setProgress({ stage: "uploading", sentCount: 0, totalCount: rows.length });
      await uploadRowsInChunks(rows, "/api/commit-sales", (sent, total) =>
        setProgress({ stage: "uploading", sentCount: sent, totalCount: total })
      );

      // このCSVは「伝票単位の追加」ではなく、対象月度の全件を毎回まるごと出力したもの。
      // upsert(反映)だけでは、得意先コードの統合・削除などでCSVから消えた行が
      // DBに残ってしまうため、対象月度の中で今回のCSVに存在しない行を削除する。
      setProgress({ stage: "cleaning" });
      const months = Array.from(new Set(rows.map((r) => r.target_month_raw)));
      const keys = rows.map((r) => `${r.target_month_raw}|${r.staff_code}|${r.customer_code}`);
      const cleanupResult = await postJson("/api/cleanup-sales", { months, keys });

      setProgress({ stage: "refreshing" });
      await postJson("/api/refresh", {});
      const totalAmount = rows.reduce((sum, r) => sum + r.sales_amount, 0);
      const deletedCount = typeof cleanupResult?.deletedCount === "number" ? cleanupResult.deletedCount : 0;
      setProgress({ stage: "done" });
      setResult({
        rowCount: rows.length,
        skippedCount: skipped.length,
        skippedSample: skipped.slice(0, 5),
        totalAmount,
        extraInfo: deletedCount > 0 ? `今回のCSVに無かった${deletedCount}件をDBから削除しました` : undefined,
      });
    } catch (e) {
      setProgress({ stage: "error" });
      setResult({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <UploadBoxShell
      title="① 売上データ(月次集計・経営報告用)"
      description="販売管理からダウンロードした売上CSVを、そのままアップロードしてください。文字コード(CP932/UTF-8)は自動で判定します。対象月度の中でCSVに存在しない行(統合・削除された得意先など)は自動的に削除されます。"
      file={file}
      setFile={setFile}
      progress={progress}
      result={result}
      onUpload={handleUpload}
      accept=".csv"
    />
  );
}

function PurchasesUploadBox() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<Progress>({ stage: "idle" });
  const [result, setResult] = useState<FinalResult | null>(null);

  async function handleUpload() {
    if (!file) return;
    setResult(null);
    try {
      setProgress({ stage: "reading" });
      const buf = await file.arrayBuffer();
      const text = decodeCsvBuffer(buf);
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
      });
      const fatalErrors = parsed.errors.filter((e) => e.type !== "FieldMismatch");
      if (fatalErrors.length > 0) {
        throw new Error("CSVの読み込み中にエラーが発生しました: " + fatalErrors[0].message);
      }
      const { rows, skipped } = transformPurchasesCsv(parsed.data);
      if (rows.length === 0) {
        throw new Error("有効なデータ行がありませんでした。");
      }
      setProgress({ stage: "uploading", sentCount: 0, totalCount: rows.length });
      await uploadRowsInChunks(rows, "/api/commit-purchases", (sent, total) =>
        setProgress({ stage: "uploading", sentCount: sent, totalCount: total })
      );
      setProgress({ stage: "refreshing" });
      await postJson("/api/refresh", {});
      const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0);
      const stockCount = rows.filter((r) => r.location_code === "90" || r.location_code === "91").length;
      setProgress({ stage: "done" });
      setResult({
        rowCount: rows.length,
        skippedCount: skipped.length,
        skippedSample: skipped.slice(0, 5),
        totalAmount,
        extraInfo: `うち在庫仕入(拠点90・91): ${stockCount}件`,
      });
    } catch (e) {
      setProgress({ stage: "error" });
      setResult({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <UploadBoxShell
      title="② 仕入データ(新purchasesテーブル・仕入価格検索用)"
      description="仕入明細ファイル(CSV)を、そのままアップロードしてください。伝票消費税行の除外、仕入先コード7の除外、担当者コード0の補完などは自動で行われます(統合版の新purchasesテーブルに反映されます。受注番号・受注行番号の列見出しは実ファイルでの確認が必要です)。"
      file={file}
      setFile={setFile}
      progress={progress}
      result={result}
      onUpload={handleUpload}
      accept=".csv"
    />
  );
}

function ProductMasterUploadBox() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<Progress>({ stage: "idle" });
  const [result, setResult] = useState<FinalResult | null>(null);

  async function handleUpload() {
    if (!file) return;
    setResult(null);
    try {
      setProgress({ stage: "reading" });
      const buf = await file.arrayBuffer();
      const text = decodeCsvBuffer(buf);
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
      });
      const fatalErrors = parsed.errors.filter((e) => e.type !== "FieldMismatch");
      if (fatalErrors.length > 0) {
        throw new Error("CSVの読み込み中にエラーが発生しました: " + fatalErrors[0].message);
      }
      const { rows, skipped } = transformProductMasterCsv(parsed.data);
      if (rows.length === 0) {
        throw new Error("有効なデータ行がありませんでした。");
      }
      setProgress({ stage: "uploading", sentCount: 0, totalCount: rows.length });
      await uploadRowsInChunks(rows, "/api/commit-product-master", (sent, total) =>
        setProgress({ stage: "uploading", sentCount: sent, totalCount: total })
      );
      setProgress({ stage: "done" });
      setResult({
        rowCount: rows.length,
        skippedCount: skipped.length,
        skippedSample: skipped.slice(0, 5),
      });
    } catch (e) {
      setProgress({ stage: "error" });
      setResult({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <UploadBoxShell
      title="③ 商品マスタの更新"
      description="商品マスタから、品番・品名・カナ品名・実仕入先・仕入基準単価・副仕入先・副仕入単価・削除フラグ・更新年月日の列を含むCSVをアップロードしてください。"
      file={file}
      setFile={setFile}
      progress={progress}
      result={result}
      onUpload={handleUpload}
      accept=".csv"
    />
  );
}

function SupplierMasterUploadBox() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<Progress>({ stage: "idle" });
  const [result, setResult] = useState<FinalResult | null>(null);

  async function handleUpload() {
    if (!file) return;
    setResult(null);
    try {
      setProgress({ stage: "reading" });
      const buf = await file.arrayBuffer();
      const text = decodeCsvBuffer(buf);
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
      });
      const fatalErrors = parsed.errors.filter((e) => e.type !== "FieldMismatch");
      if (fatalErrors.length > 0) {
        throw new Error("CSVの読み込み中にエラーが発生しました: " + fatalErrors[0].message);
      }
      const { rows, skipped } = transformSupplierMasterCsv(parsed.data);
      if (rows.length === 0) {
        throw new Error("有効なデータ行がありませんでした。");
      }
      setProgress({ stage: "uploading", sentCount: 0, totalCount: rows.length });
      await uploadRowsInChunks(rows, "/api/commit-supplier-master", (sent, total) =>
        setProgress({ stage: "uploading", sentCount: sent, totalCount: total })
      );
      setProgress({ stage: "done" });
      setResult({
        rowCount: rows.length,
        skippedCount: skipped.length,
        skippedSample: skipped.slice(0, 5),
      });
    } catch (e) {
      setProgress({ stage: "error" });
      setResult({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <UploadBoxShell
      title="④ 仕入先マスタの更新"
      description="仕入先マスタCSVを、そのままアップロードしてください。"
      file={file}
      setFile={setFile}
      progress={progress}
      result={result}
      onUpload={handleUpload}
      accept=".csv"
    />
  );
}

function UploadBoxShell({
  title,
  description,
  file,
  setFile,
  progress,
  result,
  onUpload,
  accept,
}: {
  title: string;
  description: string;
  file: File | null;
  setFile: (f: File | null) => void;
  progress: Progress;
  result: FinalResult | null;
  onUpload: () => void;
  accept: string;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const busy =
    progress.stage === "reading" ||
    progress.stage === "uploading" ||
    progress.stage === "cleaning" ||
    progress.stage === "refreshing";
  let statusText = "アップロードして反映";
  if (progress.stage === "reading") statusText = "ファイルを読み込んでいます…";
  if (progress.stage === "uploading")
    statusText = `反映中… ${progress.sentCount ?? 0} / ${progress.totalCount ?? 0}件`;
  if (progress.stage === "cleaning") statusText = "不要になったデータを削除しています…";
  if (progress.stage === "refreshing") statusText = "画面用データを更新しています…";

  // ドラッグ&ドロップ対応。既存の「ファイルを選択」ボタンはそのまま残し、
  // 枠の中にCSVファイルをドラッグ&ドロップしても同じ file state にセットされるようにする。
  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (busy) return;

    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;

    if (!dropped.name.toLowerCase().endsWith(".csv")) {
      alert("CSVファイル(.csv)のみアップロードできます。別の形式のファイルがドロップされました: " + dropped.name);
      return;
    }
    setFile(dropped);
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{title}</h2>
      </div>
      <div style={{ padding: "0 20px 20px" }}>
        <p style={{ fontSize: 13, color: "var(--ink-faint)", marginBottom: 12 }}>{description}</p>

        <div
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${isDragging ? "#2563d9" : "#c3d6f8"}`,
            borderRadius: 8,
            padding: "20px 16px",
            textAlign: "center",
            background: isDragging ? "#eaf1fd" : "#f8fafd",
            transition: "background 0.15s ease, border-color 0.15s ease",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <p style={{ fontSize: 13, color: isDragging ? "#2563d9" : "var(--ink-faint)", margin: "0 0 10px", fontWeight: isDragging ? 700 : 400 }}>
            {isDragging ? "ここにCSVファイルを離してください" : "ここにCSVファイルをドラッグ&ドロップ、または下のボタンで選択"}
          </p>
          <input
            type="file"
            accept={accept}
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && (
            <p style={{ fontSize: 13, color: "#2563d9", marginTop: 10, marginBottom: 0 }}>
              選択中のファイル: {file.name}
            </p>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <button
            disabled={!file || busy}
            onClick={onUpload}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "1px solid #2563d9",
              background: !file || busy ? "#c3d6f8" : "#2563d9",
              color: "#fff",
              cursor: !file || busy ? "not-allowed" : "pointer",
            }}
          >
            {statusText}
          </button>
        </div>
        {result && (
          <div style={{ marginTop: 16, fontSize: 13 }}>
            {result.error ? (
              <p style={{ color: "var(--neg)" }}>❌ {result.error}</p>
            ) : (
              <div>
                <p style={{ color: "var(--pos)" }}>
                  ✓ {result.rowCount?.toLocaleString()}件を反映しました
                  {result.totalAmount !== undefined && `(合計 ${result.totalAmount.toLocaleString()}円)`}
                </p>
                {result.extraInfo && <p style={{ color: "var(--ink-faint)" }}>{result.extraInfo}</p>}
                {!!result.skippedCount && (
                  <p style={{ color: "var(--ink-faint)" }}>
                    スキップされた行: {result.skippedCount}件
                    {result.skippedSample && result.skippedSample.length > 0 && (
                      <span> (例: {result.skippedSample[0]})</span>
                    )}
                  </p>
                )}
                <p style={{ color: "var(--ink-faint)" }}>画面を再読み込みすると最新の数字が確認できます。</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RefreshButton() {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function handleRefresh() {
    setState("loading");
    setMessage("");
    try {
      await postJson("/api/refresh", {});
      setState("done");
      setMessage("画面用データを更新しました。ページを再読み込みしてご確認ください。");
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>画面の数字が古いと感じたら</h2>
      </div>
      <div style={{ padding: "0 20px 20px" }}>
        <p style={{ fontSize: 13, color: "var(--ink-faint)", marginBottom: 12 }}>
          アップロード後にページを再読み込みしても数字が変わらない場合、ここを押してください。
          Supabaseの画面を開く必要はありません。
        </p>
        <button
          disabled={state === "loading"}
          onClick={handleRefresh}
          style={{
            padding: "8px 20px",
            borderRadius: 6,
            border: "1px solid #2563d9",
            background: state === "loading" ? "#c3d6f8" : "#2563d9",
            color: "#fff",
            cursor: state === "loading" ? "not-allowed" : "pointer",
          }}
        >
          {state === "loading" ? "更新しています…" : "今すぐ画面データを更新する"}
        </button>
        {message && (
          <p style={{ marginTop: 12, fontSize: 13, color: state === "error" ? "var(--neg)" : "var(--pos)" }}>
            {state === "error" ? "❌ " : "✓ "}
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

export default function UpdatePage({
  statuses,
  statusError,
}: {
  statuses: TableStatus[];
  statusError: string | null;
}) {
  return (
    <div className="wrap" style={{ maxWidth: 900 }}>
      <header className="top">
        <div className="title">
          <h1>データ更新</h1>
          <p>各画面のもとになる売上・仕入・商品マスタ・仕入先マスタのCSVをアップロードして反映します。</p>
        </div>
        <Link href="/dx" className="ghost-btn-inline">
          ← 社内DXメニュー
        </Link>
      </header>
      <div className="page active">
        <RefreshButton />
        <DataStatusTable statuses={statuses} error={statusError} />
        <SalesUploadBox />
        <PurchasesUploadBox />
        <ProductMasterUploadBox />
        <SupplierMasterUploadBox />
        <RiekiUploadBoxes />
      </div>
    </div>
  );
}
