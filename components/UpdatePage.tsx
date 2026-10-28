"use client";
import { useEffect, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import Papa from "papaparse";
import type { TableStatus } from "@/lib/fetchDataStatus";
import type { UploadLogRow } from "@/lib/fetchUploadLog";
import DataStatusTable from "./DataStatusTable";
import UploadLogTable from "./UploadLogTable";
import RiekiUploadBoxes from "./RiekiUploadBoxes";
import { decodeCsvBuffer } from "@/lib/csvDecode";
import { transformSalesCsv } from "@/lib/salesTransform";
import { transformPurchasesCsv } from "@/lib/purchasesTransform";
import { transformProductMasterCsv } from "@/lib/productMasterTransform";
import { transformSupplierMasterCsv } from "@/lib/supplierMasterTransform";
import { transformCustomerMasterCsv } from "@/lib/customerMasterTransform";
import { loadFileHandle, saveFileHandle } from "@/lib/fileHandleStore";

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
      title="② 仕入データ(purchasesテーブル・仕入価格検索/値上げ検知用)"
      description="仕入明細ファイル(CSV)を、そのままアップロードしてください。伝票消費税行の除外、仕入先コード7の除外、担当者コード0の補完などは自動で行われます(統合版のpurchasesテーブルに反映され、仕入価格検索・値上げ検知ダッシュボードの両方に使われます。受注番号・受注行番号の列見出しは実ファイルでの確認が必要です)。"
      file={file}
      setFile={setFile}
      progress={progress}
      result={result}
      onUpload={handleUpload}
      accept=".csv"
    />
  );
}

// 社内共有フォルダの商品マスタ.csvを、毎回ファイル選択ダイアログを開かずに取り込むための
// 1クリック取込。File System Access API(Chrome/Edge限定)でファイルの「場所」の参照
// (FileSystemFileHandle)をIndexedDBに覚えておき、次回以降はそれを使って直接読みに行く。
// 共有フォルダ(\\192.168.64.211\マスタcsv\商品マスタ.csv)は社内LAN内限定でサーバー側から
// 読みに行けないため、ブラウザ(社内PC)側でファイルを読んでアップロードする方式にしている。
function OneClickProductMasterImport() {
  const handleRef = useRef<FileSystemFileHandle | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [checkedStorage, setCheckedStorage] = useState(false);

  useEffect(() => {
    loadFileHandle("product-master")
      .then((handle) => {
        if (handle) {
          handleRef.current = handle;
          setFileName(handle.name);
        }
      })
      .catch(() => {})
      .finally(() => setCheckedStorage(true));
  }, []);

  async function pickFile() {
    setMessage(null);
    if (!window.showOpenFilePicker) {
      setMessage("このブラウザは対応していません(Chrome・Edgeをお使いください)。");
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }],
        excludeAcceptAllOption: false,
        multiple: false,
      });
      handleRef.current = handle;
      setFileName(handle.name);
      await saveFileHandle("product-master", handle);
    } catch (e) {
      // ユーザーがダイアログをキャンセルした場合は何もしない。
      if (e instanceof Error && e.name !== "AbortError") setMessage(e.message);
    }
  }

  async function importNow() {
    if (!handleRef.current) return;
    setStatus("busy");
    setMessage(null);
    try {
      let permission = await handleRef.current.queryPermission({ mode: "read" });
      if (permission !== "granted") {
        permission = await handleRef.current.requestPermission({ mode: "read" });
      }
      if (permission !== "granted") {
        throw new Error("ファイルへのアクセスが許可されませんでした。");
      }

      const file = await handleRef.current.getFile();
      const buf = await file.arrayBuffer();
      const text = decodeCsvBuffer(buf);
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      const fatalErrors = parsed.errors.filter((e) => e.type !== "FieldMismatch");
      if (fatalErrors.length > 0) {
        throw new Error("CSVの読み込み中にエラーが発生しました: " + fatalErrors[0].message);
      }
      const { rows, skipped } = transformProductMasterCsv(parsed.data);
      if (rows.length === 0) {
        throw new Error("有効なデータ行がありませんでした。");
      }
      await uploadRowsInChunks(rows, "/api/commit-product-master", () => {});
      setStatus("done");
      const updatedAt = new Date(file.lastModified).toLocaleString("ja-JP");
      setMessage(
        `${rows.length.toLocaleString()}件を反映しました(ファイル更新日時: ${updatedAt})` +
          (skipped.length > 0 ? `・スキップ${skipped.length}件` : "")
      );
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  const supported = checkedStorage && typeof window !== "undefined" && "showOpenFilePicker" in window;
  if (checkedStorage && !supported) return null; // Chrome/Edge以外では表示しない(非対応ブラウザに混乱させないため)

  return (
    <div className="card">
      <div className="card-head">
        <h2>商品マスタを1クリックで取り込む</h2>
      </div>
      <div style={{ padding: "0 20px 20px" }}>
        <p style={{ fontSize: 13, color: "var(--ink-faint)", marginBottom: 12 }}>
          社内共有フォルダの商品マスタ.csvを、初回だけ選んでおけば、次回以降はボタン1つで最新の内容を取り込めます(Chrome・Edge限定)。
        </p>
        {!fileName ? (
          <button className="btn-primary" onClick={pickFile} disabled={!checkedStorage}>
            商品マスタ.csvを選ぶ(初回のみ)
          </button>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginBottom: 10 }}>
              選択中のファイル: <span style={{ color: "var(--brand)", fontWeight: 600 }}>{fileName}</span>{" "}
              <button type="button" className="btn-icon" onClick={pickFile} title="別のファイルに変更する">
                変更
              </button>
            </div>
            <button className="btn-primary" disabled={status === "busy"} onClick={importNow}>
              {status === "busy" && <span className="spinner" />}
              {status === "busy" ? "取り込み中…" : "最新を取り込む"}
            </button>
          </>
        )}
        {message && (
          <div className={status === "error" ? "alert alert-error" : "alert alert-success"} style={{ marginTop: 10 }}>
            {status === "error" ? "❌ " : "✓ "}
            {message}
          </div>
        )}
      </div>
    </div>
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
      description="商品マスタから、品番・品名・カナ品名・仕様・実仕入先・仕入基準単価・副仕入先・副仕入単価・削除フラグ・更新年月日・ＩＴＦコードの列を含むCSVをアップロードしてください。"
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
      description="仕入先マスタCSVを、そのままアップロードしてください。仕入先コード・仕入先名上段/下段・削除フラグ・支払統括店コードの列を使用します(支払統括店コードは、見積書・請求書の仕入先検索で支払先専用のコードを除外するために使います)。"
      file={file}
      setFile={setFile}
      progress={progress}
      result={result}
      onUpload={handleUpload}
      accept=".csv"
    />
  );
}

function CustomerMasterUploadBox() {
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
      const { rows, skipped } = transformCustomerMasterCsv(parsed.data);
      if (rows.length === 0) {
        throw new Error("有効なデータ行がありませんでした。");
      }
      setProgress({ stage: "uploading", sentCount: 0, totalCount: rows.length });
      await uploadRowsInChunks(rows, "/api/commit-customer-master", (sent, total) =>
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
      title="⑤ 得意先マスタの更新(締め日・未売上受注チェック・見積/請求書用)"
      description="得意先マスタCSVを、そのままアップロードしてください。得意先コード・得意先名上段/下段・締日・削除フラグ・郵便番号・住所上段/下段１/下段２の列を使用します。"
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
            border: `1.5px dashed ${isDragging ? "var(--brand)" : "var(--line)"}`,
            borderRadius: "var(--radius-sm)",
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            background: isDragging ? "#eaf1fd" : "#fafbfd",
            transition: "background 0.15s ease, border-color 0.15s ease",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <span style={{ fontSize: 12.5, color: isDragging ? "var(--brand)" : "var(--ink-faint)", fontWeight: isDragging ? 700 : 400, whiteSpace: "nowrap" }}>
            {isDragging ? "ここで離してください" : "ドラッグ&ドロップ、または選択:"}
          </span>
          <input type="file" accept={accept} disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <span style={{ fontSize: 12.5, color: "var(--brand)", fontWeight: 600 }}>{file.name}</span>}
        </div>

        <div style={{ marginTop: 12 }}>
          <button className="btn-primary" disabled={!file || busy} onClick={onUpload}>
            {busy && <span className="spinner" />}
            {statusText}
          </button>
        </div>
        {result &&
          (result.error ? (
            <div className="alert alert-error">❌ {result.error}</div>
          ) : (
            <div className="alert alert-success">
              <div>
                ✓ {result.rowCount?.toLocaleString()}件を反映しました
                {result.totalAmount !== undefined && `(合計 ${result.totalAmount.toLocaleString()}円)`}
              </div>
              {result.extraInfo && <div style={{ marginTop: 4 }}>{result.extraInfo}</div>}
              {!!result.skippedCount && (
                <div style={{ marginTop: 4 }}>
                  スキップされた行: {result.skippedCount}件
                  {result.skippedSample && result.skippedSample.length > 0 && <span> (例: {result.skippedSample[0]})</span>}
                </div>
              )}
              <div style={{ marginTop: 4, opacity: 0.8 }}>画面を再読み込みすると最新の数字が確認できます。</div>
            </div>
          ))}
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
        <button className="btn-primary" disabled={state === "loading"} onClick={handleRefresh}>
          {state === "loading" ? (
            <>
              <span className="spinner" />
              更新しています…
            </>
          ) : (
            "今すぐ画面データを更新する"
          )}
        </button>
        {message && <div className={`alert ${state === "error" ? "alert-error" : "alert-success"}`}>{state === "error" ? "❌ " : "✓ "}{message}</div>}
      </div>
    </div>
  );
}

export default function UpdatePage({
  statuses,
  statusError,
  uploadLogs,
  uploadLogError,
}: {
  statuses: TableStatus[];
  statusError: string | null;
  uploadLogs: UploadLogRow[];
  uploadLogError: string | null;
}) {
  return (
    <div className="wrap" style={{ maxWidth: 1200 }}>
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
        <UploadLogTable logs={uploadLogs} error={uploadLogError} />
      </div>
      <h2 className="blk" style={{ margin: "24px 0 12px" }}>CSVアップロード</h2>
      <div className="page active" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))", gap: 16 }}>
        <SalesUploadBox />
        <PurchasesUploadBox />
        <OneClickProductMasterImport />
        <ProductMasterUploadBox />
        <SupplierMasterUploadBox />
        <CustomerMasterUploadBox />
        <RiekiUploadBoxes />
      </div>
    </div>
  );
}
