"use client";
// rieki-check-appの「データ更新」から移植した4つのアップロード枠(売上明細・仕入明細・
// 社内間・送り状問合せ)。sales_monthly/purchases/product_master/supplier_masterとは
// 別の生データ(sales_lines・purchase_lines・stock_transfer_pending・shipping_note_mapping)
// を更新する。売上利益・不動在庫チェック・社内間金額・運賃照合・値上げ検知が対象。
import { useState, type DragEvent } from "react";
import Papa from "papaparse";
import {
  mapSalesRow,
  mapPurchaseRow,
  mapTransferRow,
  mapShippingNoteRow,
} from "@/lib/row-mapping";
import type {
  SalesRowInsert,
  PurchaseRowInsert,
  TransferRowInsert,
  ShippingNoteRowInsert,
} from "@/lib/row-mapping";
import { clearProfitCache } from "@/lib/profit-cache";

type DuplicateWarning = {
  order_no: string;
  order_line: string;
  item_code: string | null;
  qty: number | null;
  sell_price: number | null;
  delivery_date: string | null;
  incoming_delivery_note_no: string | null;
  incoming_delivery_note_line: string | null;
  existing_delivery_note_no: string | null;
  existing_delivery_note_line: string | null;
};

type Status = {
  fileName: string;
  detectedEncoding: string;
  totalRows: number;
  sentRows: number;
  totalBatches: number;
  doneBatches: number;
  errors: string[];
  running: boolean;
  finished: boolean;
  refreshing: boolean;
  refreshed: boolean;
  duplicatesRemoved: number | null;
  pruned: number | null;
  duplicateWarnings: DuplicateWarning[];
  duplicateCandidateTotal: number;
};

function initialStatus(): Status {
  return {
    fileName: "",
    detectedEncoding: "",
    totalRows: 0,
    sentRows: 0,
    totalBatches: 0,
    doneBatches: 0,
    errors: [],
    running: false,
    finished: false,
    refreshing: false,
    refreshed: false,
    duplicatesRemoved: null,
    pruned: null,
    duplicateWarnings: [],
    duplicateCandidateTotal: 0,
  };
}

const BATCH_SIZE = 1000;

async function callRefreshApi(): Promise<string | null> {
  try {
    const res = await fetch("/api/refresh", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return json.error ?? res.statusText ?? "不明なエラー";
    return null;
  } catch (e) {
    return String(e);
  }
}

/**
 * アップロードされたファイルの文字コードを自動判定して読み込む。
 * 基幹システムから直接落としたCSVはShift_JIS(CP932)だが、大きいファイルを分割・
 * 再保存する過程でUTF-8に変わってしまうことがあるため、実際のバイト列を見て判定する。
 */
async function readFileSmart(file: File): Promise<{ text: string; encoding: string }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(buf), encoding: "UTF-8 (BOM付き)" };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return { text, encoding: "UTF-8" };
  } catch {
    const text = new TextDecoder("shift_jis").decode(buf);
    return { text, encoding: "Shift_JIS (CP932)" };
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type Kind = "salesLines" | "purchaseLines" | "transfer" | "shippingNote";

const ENDPOINT: Record<Kind, string> = {
  salesLines: "/api/upload/sales-lines",
  purchaseLines: "/api/upload/purchase-lines",
  transfer: "/api/upload/transfer",
  shippingNote: "/api/upload/shipping-note",
};

function UploadBox({
  kind,
  title,
  description,
  mode,
}: {
  kind: Kind;
  title: string;
  description: string;
  mode: "batch" | "replace" | "accumulate";
}) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>(initialStatus());
  const [isDragging, setIsDragging] = useState(false);

  async function handleUpload(f: File) {
    setFile(f);
    setStatus({ ...initialStatus(), fileName: f.name, running: true });

    let text: string;
    let encoding: string;
    try {
      const result = await readFileSmart(f);
      text = result.text;
      encoding = result.encoding;
    } catch (e) {
      setStatus((s) => ({ ...s, running: false, finished: true, errors: [...s.errors, `ファイルの読み込みに失敗しました: ${String(e)}`] }));
      return;
    }
    setStatus((s) => ({ ...s, detectedEncoding: encoding }));

    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    const dataRows = parsed.data.slice(1); // 1行目はヘッダー行なので除外

    const mapper =
      kind === "salesLines" ? mapSalesRow : kind === "purchaseLines" ? mapPurchaseRow : kind === "transfer" ? mapTransferRow : mapShippingNoteRow;
    const mapped = dataRows
      .map((cols) => mapper(cols))
      .filter((r): r is SalesRowInsert | PurchaseRowInsert | TransferRowInsert | ShippingNoteRowInsert => r !== null);

    // transferは対象外の行が最初から捨てられる設計なので、0件でも異常ではない。
    if (mapped.length === 0 && kind !== "transfer") {
      setStatus((s) => ({
        ...s,
        running: false,
        finished: true,
        errors: [...s.errors, "有効なデータ行が1件も見つかりませんでした。ファイルの形式(列数・エンコーディング)を確認してください。"],
      }));
      return;
    }

    const endpoint = ENDPOINT[kind];
    let sent = 0;
    const errors: string[] = [];

    if (kind === "transfer") {
      setStatus((s) => ({ ...s, totalRows: mapped.length, totalBatches: 1 }));
      let duplicatesRemoved: number | null = null;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: mapped }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          errors.push(json.error ?? res.statusText);
        } else {
          sent = typeof json.inserted === "number" ? json.inserted : mapped.length;
          duplicatesRemoved = typeof json.duplicatesRemoved === "number" ? json.duplicatesRemoved : null;
        }
      } catch (e) {
        errors.push(String(e));
      }
      setStatus((s) => ({ ...s, sentRows: sent, doneBatches: 1, errors: [...errors], duplicatesRemoved, running: false, finished: true }));
      return;
    }

    if (kind === "shippingNote") {
      const batches = chunk(mapped, BATCH_SIZE);
      setStatus((s) => ({ ...s, totalRows: mapped.length, totalBatches: batches.length }));
      let pruned: number | null = null;
      for (let i = 0; i < batches.length; i++) {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: batches[i] }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            errors.push(`バッチ${i + 1}/${batches.length}: ${json.error ?? res.statusText}`);
          } else {
            sent += typeof json.inserted === "number" ? json.inserted : batches[i].length;
            if (typeof json.pruned === "number") pruned = (pruned ?? 0) + json.pruned;
          }
        } catch (e) {
          errors.push(`バッチ${i + 1}/${batches.length}: ${String(e)}`);
        }
        setStatus((s) => ({ ...s, sentRows: sent, doneBatches: i + 1, errors: [...errors], pruned }));
      }
      setStatus((s) => ({ ...s, running: false, finished: true }));
      return;
    }

    // salesLines / purchaseLines: 1000件ずつバッチ送信
    const batches = chunk(mapped, BATCH_SIZE);
    setStatus((s) => ({ ...s, totalRows: mapped.length, totalBatches: batches.length }));
    const allDuplicateWarnings: DuplicateWarning[] = [];
    let duplicateCandidateTotal = 0;

    for (let i = 0; i < batches.length; i++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: batches[i] }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          errors.push(`バッチ${i + 1}/${batches.length}: ${json.error ?? res.statusText}`);
        } else {
          sent += batches[i].length;
          if (kind === "salesLines") {
            if (Array.isArray(json.duplicateWarnings)) allDuplicateWarnings.push(...(json.duplicateWarnings as DuplicateWarning[]));
            if (typeof json.duplicateCandidateTotal === "number") duplicateCandidateTotal += json.duplicateCandidateTotal;
          }
        }
      } catch (e) {
        errors.push(`バッチ${i + 1}/${batches.length}: ${String(e)}`);
      }
      setStatus((s) => ({
        ...s,
        sentRows: sent,
        doneBatches: i + 1,
        errors: [...errors],
        duplicateWarnings: allDuplicateWarnings.slice(0, 50),
        duplicateCandidateTotal,
      }));
    }

    if (sent > 0) {
      setStatus((s) => ({ ...s, refreshing: true }));
      const refreshError = await callRefreshApi();
      setStatus((s) => ({
        ...s,
        refreshing: false,
        refreshed: !refreshError,
        errors: refreshError ? [...s.errors, `集計の更新に失敗しました: ${refreshError}`] : s.errors,
      }));
      if (!refreshError) clearProfitCache();
    }

    setStatus((s) => ({ ...s, running: false, finished: true }));
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!status.running) setIsDragging(true);
  }
  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (status.running) return;
    const f = e.dataTransfer.files?.[0];
    if (f) handleUpload(f);
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
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
            opacity: status.running ? 0.6 : 1,
          }}
        >
          <p style={{ fontSize: 13, color: isDragging ? "#2563d9" : "var(--ink-faint)", margin: "0 0 10px" }}>
            {isDragging ? "ここにCSVファイルを離してください" : "ここにCSVファイルをドラッグ&ドロップ、または下のボタンで選択"}
          </p>
          <input
            type="file"
            accept=".csv"
            disabled={status.running}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = "";
            }}
          />
          {file && <p style={{ fontSize: 13, color: "#2563d9", marginTop: 10, marginBottom: 0 }}>選択中のファイル: {file.name}</p>}
        </div>

        {status.fileName && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <div>判定した文字コード: {status.detectedEncoding}</div>
            {(status.totalRows > 0 || (mode !== "batch" && status.finished)) && (
              <div>
                {mode === "replace"
                  ? `対象行: ${status.totalRows.toLocaleString("ja-JP")}件`
                  : `読み込んだ行数: ${status.totalRows.toLocaleString("ja-JP")}件 / 送信済み: ${status.sentRows.toLocaleString("ja-JP")}件 / バッチ ${status.doneBatches}/${status.totalBatches}`}
              </div>
            )}
            {status.running && !status.refreshing && (
              <div style={{ color: "#2563d9", marginTop: 4 }}>
                {mode === "replace" ? "置き換え中…" : mode === "accumulate" ? "取り込み中…" : "アップロード中…"}
              </div>
            )}
            {status.refreshing && (
              <div style={{ color: "#2563d9", marginTop: 4 }}>値上げ検知・売上利益等の集計を更新中…(数十秒かかる場合があります)</div>
            )}
            {status.finished && status.errors.length === 0 && (
              <div style={{ color: "var(--pos)", marginTop: 4 }}>
                {mode === "replace"
                  ? `完了しました。既存データを削除し、${status.sentRows.toLocaleString("ja-JP")}件で置き換えました。`
                  : mode === "accumulate"
                  ? `完了しました。${status.sentRows.toLocaleString("ja-JP")}件を取り込みました(送り状番号が同じ行は上書き)。`
                  : `完了しました。${status.sentRows.toLocaleString("ja-JP")}件を反映しました。`}
                {status.refreshed && " 値上げ検知・売上利益等の集計も更新済みです。"}
                {mode === "replace" && status.duplicatesRemoved !== null && status.duplicatesRemoved > 0 && (
                  <div style={{ color: "#2563d9" }}>
                    うち、受注番号・受注行番号が重複していた{status.duplicatesRemoved.toLocaleString("ja-JP")}件は自動的に1件にまとめました。
                  </div>
                )}
                {mode === "accumulate" && status.pruned !== null && status.pruned > 0 && (
                  <div style={{ color: "#2563d9" }}>あわせて、発行日が3か月より前の古いデータ{status.pruned.toLocaleString("ja-JP")}件を削除しました。</div>
                )}
              </div>
            )}
            {status.errors.length > 0 && (
              <div style={{ color: "var(--neg)", marginTop: 4 }}>
                エラーが発生しました:
                <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                  {status.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {kind === "salesLines" && status.finished && status.duplicateCandidateTotal > 0 && (
              <div className="card" style={{ marginTop: 10, padding: "10px 12px", background: "rgba(220,180,40,0.08)" }}>
                <b style={{ color: "#b8860b" }}>⚠ 二重登録の疑いあり</b>
                <p style={{ marginTop: 4 }}>
                  受注番号・受注行番号・品番・数量・単価は同じなのに、納品書番号だけが違う行が
                  {status.duplicateCandidateTotal.toLocaleString("ja-JP")}件見つかりました。同じ出荷が納品書番号を変えて
                  2回登録されている(=売上が二重計上されている)可能性があります。ただし正当なケースも混ざるため、自動では削除していません。
                </p>
                <div style={{ overflowX: "auto", marginTop: 8 }}>
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--ink-faint)" }}>
                        <th>受注番号</th>
                        <th>行</th>
                        <th>品番</th>
                        <th>数量</th>
                        <th>単価</th>
                        <th>納品日</th>
                        <th>今回の納品書番号</th>
                        <th>既存の納品書番号</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.duplicateWarnings.map((w, i) => (
                        <tr key={i}>
                          <td>{w.order_no}</td>
                          <td>{w.order_line}</td>
                          <td>{w.item_code ?? "—"}</td>
                          <td>{w.qty ?? "—"}</td>
                          <td>{w.sell_price ?? "—"}</td>
                          <td>{w.delivery_date ?? "—"}</td>
                          <td>{w.incoming_delivery_note_no ?? "—"}{w.incoming_delivery_note_line ? `-${w.incoming_delivery_note_line}` : ""}</td>
                          <td>{w.existing_delivery_note_no ?? "—"}{w.existing_delivery_note_line ? `-${w.existing_delivery_note_line}` : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {status.duplicateCandidateTotal > status.duplicateWarnings.length && (
                  <p style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 6 }}>
                    上位{status.duplicateWarnings.length}件のみ表示しています(該当は全部で{status.duplicateCandidateTotal.toLocaleString("ja-JP")}件)。
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RiekiUploadBoxes() {
  return (
    <>
      <UploadBox
        kind="salesLines"
        title="⑤ 売上明細データ(sales_lines)"
        description="uriage.csvと同じ列構成のCSVを選択してください。売上利益・不動在庫チェック・社内間金額・運賃照合・値上げ検知が対象です(①の売上データ(月次集計)とは別のデータです)。"
        mode="batch"
      />
      <UploadBox
        kind="purchaseLines"
        title="⑥ 仕入明細データ(purchase_lines・値上げ検知用)"
        description="仕入実績データ(55列)と同じ列構成のCSVを選択してください。値上げ検知ダッシュボードの対象です(②の仕入データ(新purchasesテーブル)とは別のデータです)。"
        mode="batch"
      />
      <UploadBox
        kind="transfer"
        title="⑦ 社内間(未納品の拠点間移動)"
        description="受注出力CSV(受注データ、売上データと同じ54列構成)を選択してください。手配区分=在庫かつ納入先名1に「太幸」を含む行だけを取り込みます。アップロードのたびに既存データを全件削除してから置き換えます。"
        mode="replace"
      />
      <UploadBox
        kind="shippingNote"
        title="⑧ 送り状問合せデータ(運賃照合用)"
        description="送り状問合せCSVを選択してください(得意先コード・受注番号・運送会社名・送り状番号などを含む列構成)。送り状番号をキーに蓄積(upsert)され、発行日が3か月より前の古いデータは自動的に削除されます。"
        mode="accumulate"
      />
    </>
  );
}
