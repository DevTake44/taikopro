"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { decodeCsvBuffer } from "@/lib/csvDecode";
import { transformOrderChecklistCsv, type OrderChecklistRow } from "@/lib/orderChecklistTransform";
import { formatClosingDay, closingDaySortKey, type UnsoldOrderRow } from "@/lib/unsoldOrders";

const CHUNK_SIZE = 1000;

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

async function uploadRowsInChunks(rows: unknown[], endpoint: string, onProgress: (sent: number, total: number) => void) {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await postJson(endpoint, { rows: chunk });
    onProgress(Math.min(i + CHUNK_SIZE, rows.length), rows.length);
  }
}

type UploadStage = "idle" | "reading" | "uploading" | "cleaning" | "done" | "error";

function OrderChecklistUploadBox({ onDone }: { onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [sentCount, setSentCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ rowCount: number; skippedCount: number; deletedCount: number } | null>(null);

  async function handleUpload() {
    if (files.length === 0) return;
    setError(null);
    setResult(null);
    try {
      setStage("reading");
      const allRows: OrderChecklistRow[] = [];
      let skippedTotal = 0;
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const text = decodeCsvBuffer(buf);
        const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
        const fatalErrors = parsed.errors.filter((e) => e.type !== "FieldMismatch");
        if (fatalErrors.length > 0) {
          throw new Error(`${file.name}の読み込み中にエラーが発生しました: ${fatalErrors[0].message}`);
        }
        const { rows, skipped } = transformOrderChecklistCsv(parsed.data);
        allRows.push(...rows);
        skippedTotal += skipped.length;
      }
      if (allRows.length === 0) {
        throw new Error("有効なデータ行がありませんでした。");
      }

      setStage("uploading");
      setSentCount(0);
      setTotalCount(allRows.length);
      await uploadRowsInChunks(allRows, "/api/commit-order-checklist", (sent, total) => {
        setSentCount(sent);
        setTotalCount(total);
      });

      setStage("cleaning");
      const months = Array.from(new Set(allRows.map((r) => r.target_month)));
      const orderNos = allRows.map((r) => r.order_no);
      const cleanupResult = await postJson("/api/cleanup-order-checklist", { months, orderNos });

      setStage("done");
      setResult({
        rowCount: allRows.length,
        skippedCount: skippedTotal,
        deletedCount: typeof cleanupResult?.deletedCount === "number" ? cleanupResult.deletedCount : 0,
      });
      onDone();
    } catch (e) {
      setStage("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const busy = stage === "reading" || stage === "uploading" || stage === "cleaning";
  let statusText = "アップロードして反映";
  if (stage === "reading") statusText = "ファイルを読み込んでいます…";
  if (stage === "uploading") statusText = `反映中… ${sentCount} / ${totalCount}件`;
  if (stage === "cleaning") statusText = "不要になったデータを削除しています…";

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <h2>受注データ(CSV)のアップロード</h2>
      </div>
      <div style={{ padding: "0 20px 20px" }}>
        <p style={{ fontSize: 13, color: "var(--ink-faint)", marginBottom: 12 }}>
          対象年月・受注番号・受注日・得意先コード・得意先名(参考)・指定納期・受注金額合計・担当者コード・担当者名の列を持つCSVをアップロードしてください。
          複数ファイル(7月・8月・9月分など)をまとめて選択できます。対象月度の中でアップロードされなかった受注番号は自動的に削除されます。
        </p>
        <input
          type="file"
          accept=".csv"
          multiple
          disabled={busy}
          onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
        />
        {files.length > 0 && (
          <p style={{ fontSize: 13, color: "#2563d9", marginTop: 10 }}>
            選択中: {files.map((f) => f.name).join(", ")}
          </p>
        )}
        <div style={{ marginTop: 12 }}>
          <button
            disabled={files.length === 0 || busy}
            onClick={handleUpload}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "1px solid #2563d9",
              background: files.length === 0 || busy ? "#c3d6f8" : "#2563d9",
              color: "#fff",
              cursor: files.length === 0 || busy ? "not-allowed" : "pointer",
            }}
          >
            {busy && <span className="spinner" />}
            {statusText}
          </button>
        </div>
        {error && <p style={{ color: "var(--neg)", marginTop: 12, fontSize: 13 }}>❌ {error}</p>}
        {result && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <p style={{ color: "var(--pos)" }}>✓ {result.rowCount.toLocaleString()}件を反映しました</p>
            {result.deletedCount > 0 && (
              <p style={{ color: "var(--ink-faint)" }}>今回のCSVに無かった{result.deletedCount}件をDBから削除しました</p>
            )}
            {result.skippedCount > 0 && <p style={{ color: "var(--ink-faint)" }}>スキップされた行: {result.skippedCount}件</p>}
          </div>
        )}
      </div>
    </div>
  );
}

type ClosingGroup = { closingDay: number | null; total: number; orders: UnsoldOrderRow[] };
type CustomerGroup = { customerCode: string; customerName: string; total: number; closings: ClosingGroup[] };
type RepGroup = { repCode: string; repName: string; total: number; customers: CustomerGroup[] };

function buildGroups(rows: UnsoldOrderRow[]): RepGroup[] {
  const repMap = new Map<string, Map<string, Map<string, UnsoldOrderRow[]>>>();
  for (const row of rows) {
    const repKey = `${row.rep_code}|${row.rep_name}`;
    const custKey = `${row.customer_code}|${row.customer_name}`;
    const closingKey = String(row.closing_day);
    if (!repMap.has(repKey)) repMap.set(repKey, new Map());
    const custMap = repMap.get(repKey)!;
    if (!custMap.has(custKey)) custMap.set(custKey, new Map());
    const closingMap = custMap.get(custKey)!;
    if (!closingMap.has(closingKey)) closingMap.set(closingKey, []);
    closingMap.get(closingKey)!.push(row);
  }

  const reps: RepGroup[] = [];
  for (const [repKey, custMap] of repMap) {
    const [repCode, repName] = repKey.split("|");
    const customers: CustomerGroup[] = [];
    for (const [custKey, closingMap] of custMap) {
      const [customerCode, customerName] = custKey.split("|");
      const closings: ClosingGroup[] = [];
      for (const orders of closingMap.values()) {
        const closingDay = orders[0].closing_day;
        orders.sort((a, b) => a.due_date.localeCompare(b.due_date));
        closings.push({ closingDay, total: orders.reduce((s, o) => s + o.unsold_amount, 0), orders });
      }
      closings.sort((a, b) => closingDaySortKey(a.closingDay) - closingDaySortKey(b.closingDay));
      customers.push({
        customerCode,
        customerName,
        total: closings.reduce((s, c) => s + c.total, 0),
        closings,
      });
    }
    customers.sort((a, b) => a.customerName.localeCompare(b.customerName, "ja"));
    reps.push({
      repCode,
      repName,
      total: customers.reduce((s, c) => s + c.total, 0),
      customers,
    });
  }
  reps.sort((a, b) => a.repName.localeCompare(b.repName, "ja"));
  return reps;
}

export default function UnsoldOrdersDashboard() {
  const [rows, setRows] = useState<UnsoldOrderRow[]>([]);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [repFilter, setRepFilter] = useState<string>("");
  const [closingFilter, setClosingFilter] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/unsold-orders", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "取得に失敗しました");
      setRows(json.rows as UnsoldOrderRow[]);
      setPeriodEnd(typeof json.periodEnd === "string" ? json.periodEnd : null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const repOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.rep_code, r.rep_name);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "ja"));
  }, [rows]);

  const closingOptions = useMemo(() => {
    const set = new Set<number | null>();
    for (const r of rows) set.add(r.closing_day);
    return Array.from(set).sort((a, b) => closingDaySortKey(a) - closingDaySortKey(b));
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      rows
        .filter((r) => !repFilter || r.rep_code === repFilter)
        .filter((r) => !closingFilter || String(r.closing_day) === closingFilter),
    [rows, repFilter, closingFilter]
  );

  const groups = useMemo(() => buildGroups(filteredRows), [filteredRows]);
  const grandTotal = useMemo(() => groups.reduce((s, g) => s + g.total, 0), [groups]);

  return (
    <div className="wrap" style={{ maxWidth: 1000 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>未売上受注チェック</h1>
          <p>受注はあるが売上未計上の案件を、担当者→得意先→締め日の単位で一覧化します。</p>
          {periodEnd && (
            <p className="cell-sub" style={{ marginTop: 4 }}>
              対象: 納期日が今期末({periodEnd})までの受注のみ表示しています(それ以降の納期はノイズになるため対象外)。
            </p>
          )}
        </div>
        <Link href="/dx" className="ghost-btn-inline">
          ← 社内DXメニュー
        </Link>
      </header>

      <OrderChecklistUploadBox onDone={load} />

      <div className="card">
        <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <h2>未売上一覧</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 13, color: "var(--ink-faint)" }}>担当者:</label>
              <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} style={{ padding: "5px 8px", fontSize: 13 }}>
                <option value="">すべて({repOptions.length}名)</option>
                {repOptions.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 13, color: "var(--ink-faint)" }}>締め日:</label>
              <select value={closingFilter} onChange={(e) => setClosingFilter(e.target.value)} style={{ padding: "5px 8px", fontSize: 13 }}>
                <option value="">すべて</option>
                {closingOptions.map((c) => (
                  <option key={String(c)} value={String(c)}>
                    {formatClosingDay(c)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div style={{ padding: "0 20px 20px" }}>
          {loading && (
            <p className="cell-sub">
              <span className="spinner" />
              読み込み中…
            </p>
          )}
          {loadError && <p style={{ color: "var(--neg)" }}>{loadError}</p>}
          {!loading && !loadError && (
            <>
              <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>
                未売上合計: ¥{grandTotal.toLocaleString()}(全{filteredRows.length.toLocaleString()}件)
              </p>
              {groups.length === 0 && <p className="cell-sub">未売上の受注はありません。</p>}
              {groups.map((rep) => (
                <div key={rep.repCode} style={{ marginBottom: 24 }}>
                  <h3 style={{ fontSize: 15, borderBottom: "2px solid #2563d9", paddingBottom: 6, marginBottom: 10 }}>
                    {rep.repName}({rep.repCode}) 合計: ¥{rep.total.toLocaleString()}
                  </h3>
                  {rep.customers.map((cust) => (
                    <div key={cust.customerCode} style={{ marginLeft: 12, marginBottom: 14 }}>
                      <h4 style={{ fontSize: 13.5, marginBottom: 6, color: "#1f2d3d" }}>
                        {cust.customerName} 小計: ¥{cust.total.toLocaleString()}
                      </h4>
                      {cust.closings.map((closing) => (
                        <div key={String(closing.closingDay)} style={{ marginLeft: 12, marginBottom: 10 }}>
                          <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-faint)", marginBottom: 4 }}>
                            {formatClosingDay(closing.closingDay)}(¥{closing.total.toLocaleString()})
                          </p>
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>受注番号</th>
                                  <th>金額(未売上残)</th>
                                  <th>納期日</th>
                                </tr>
                              </thead>
                              <tbody>
                                {closing.orders.map((o) => (
                                  <tr key={o.order_no}>
                                    <td>{o.order_no}</td>
                                    <td>¥{o.unsold_amount.toLocaleString()}</td>
                                    <td>{o.due_date}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
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
