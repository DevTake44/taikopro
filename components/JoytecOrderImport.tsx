"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { decodeCsvBuffer } from "@/lib/csvDecode";
import {
  ARRANGE_CODE_OPTIONS,
  ARRIVAL_SPEC_OPTIONS,
  DELIVERY_METHOD_OPTIONS,
  SHIPPING_LOCATION_OPTIONS,
  TIME_SPEC_OPTIONS,
} from "@/lib/orderCsvLayout";
import {
  convertJoytec,
  parseJoytecCsv,
  parseJoytecMasterSheet,
  type JoytecMaster,
  type JoytecOrder,
  type JoytecSourceRow,
} from "@/lib/joytecOrder";

/**
 * ジョイテック(ベルク各店)の発注データCSV(setYYYYMMDD.csv)から、販売管理の受注取込CSVを作る。
 * 2025-04作成の「変換用エクセル」をアプリにしたもの。商品マスタ(自社管理商品コード→品番・単価・
 * 仕入先・原価)は画面で更新する。単価はマスタを正とし、発注データと違う行には注意を出す。
 */

type MasterRow = JoytecMaster & { updated_at?: string };

const ARRANGE_LABEL: Record<string, string> = Object.fromEntries(ARRANGE_CODE_OPTIONS.map((o) => [o.value, o.label]));

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function yen(n: number | null | undefined): string {
  return n == null ? "―" : `¥${Math.round(Number(n)).toLocaleString("ja-JP")}`;
}

const EMPTY_MASTER: MasterRow = {
  own_code: "",
  product_code: "",
  product_name: "",
  spec: "",
  sell_price: null,
  note: "",
  ship_location: "200",
  arrange_code: "80",
  supplier_code: "",
  supplier_name: "",
  cost: null,
  unit: "1",
};

function useMaster() {
  const [rows, setRows] = useState<MasterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/joytec/master")
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? res.statusText);
        if (alive) {
          setRows(json.rows ?? []);
          setError(null);
        }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [version]);
  return { rows, error, reload: () => setVersion((v) => v + 1) };
}

export default function JoytecOrderImport() {
  const [tab, setTab] = useState<"order" | "master">("order");
  const master = useMaster();
  const [editing, setEditing] = useState<MasterRow | null>(null);

  return (
    <div className="wrap" style={{ maxWidth: 1500 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>ジョイテック受注CSV作成</h1>
          <p>ベルク各店の発注データCSV(setYYYYMMDD.csv)から、販売管理の受注取込CSVを作ります。単価・品番・仕入先・原価は商品マスタから当てます。</p>
        </div>
        <Link href="/sales-app" className="ghost-btn-inline">
          ← 営業アプリ
        </Link>
      </header>

      <div className="maintabs" style={{ marginBottom: 14 }}>
        <button className={tab === "order" ? "active" : ""} onClick={() => setTab("order")}>
          受注CSV作成
        </button>
        <button className={tab === "master" ? "active" : ""} onClick={() => setTab("master")}>
          商品マスタ{master.rows ? `(${master.rows.length})` : ""}
        </button>
      </div>

      {master.error && <div className="alert alert-error" style={{ marginBottom: 12 }}>商品マスタの読み込みに失敗しました: {master.error}</div>}

      {tab === "order" ? (
        <OrderTab
          master={master.rows}
          onAddMaster={(m) => {
            setEditing(m);
            setTab("master");
          }}
        />
      ) : (
        <MasterTab rows={master.rows} reload={master.reload} editing={editing} setEditing={setEditing} />
      )}
    </div>
  );
}

function OrderTab({ master, onAddMaster }: { master: MasterRow[] | null; onAddMaster: (m: MasterRow) => void }) {
  const [src, setSrc] = useState<{ fileName: string; rows: JoytecSourceRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [shipDate, setShipDate] = useState(today());
  const [arrivalDate, setArrivalDate] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("1");
  const [arrivalSpec, setArrivalSpec] = useState("2");
  const [timeSpec, setTimeSpec] = useState("0");
  const [receiveLocation, setReceiveLocation] = useState("200");
  const [onlyWarn, setOnlyWarn] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleFile(f: File) {
    setError(null);
    try {
      const text = decodeCsvBuffer(await f.arrayBuffer());
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
      const rows = parseJoytecCsv(parsed.data);
      if (rows.length === 0) throw new Error("明細がありません。");
      setSrc({ fileName: f.name, rows });
      const dates = Array.from(new Set(rows.map((r) => r.deliveryDate).filter(Boolean))).sort();
      if (dates.length > 0) {
        setArrivalDate(dates[0]);
        // 出荷日の初期値は着日の前日(変換用エクセルと同じ)
        const d = new Date(`${dates[0]}T00:00:00`);
        d.setDate(d.getDate() - 1);
        setShipDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
      }
    } catch (e) {
      setSrc(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const masterMap = useMemo(() => new Map((master ?? []).map((m) => [m.own_code, m])), [master]);
  const orders: JoytecOrder[] = useMemo(
    () =>
      src && master
        ? convertJoytec(src.rows, masterMap, { shipDate, arrivalDate, deliveryMethod, arrivalSpec, timeSpec, receiveLocation })
        : [],
    [src, master, masterMap, shipDate, arrivalDate, deliveryMethod, arrivalSpec, timeSpec, receiveLocation]
  );

  const allLines = orders.flatMap((o) => o.lines);
  const missing = new Map<string, { name: string; price: number | null; count: number }>();
  for (const l of allLines) {
    if (!l.warnings.includes("マスタ未登録")) continue;
    const cur = missing.get(l.ownCode) ?? { name: l.sourceName, price: l.sourcePrice, count: 0 };
    cur.count++;
    missing.set(l.ownCode, cur);
  }
  const priceDiff = allLines.filter((l) => l.warnings.includes("単価相違"));
  const deliveryDates = src ? Array.from(new Set(src.rows.map((r) => r.deliveryDate).filter(Boolean))).sort() : [];
  const total = allLines.reduce((s, l) => s + l.unit_price * l.qty, 0);
  const freight = allLines.filter((l) => l.kind === "運賃").reduce((s, l) => s + l.unit_price, 0);
  const shown = onlyWarn ? orders.filter((o) => o.lines.some((l) => l.warnings.length > 0)) : orders;

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch("/api/joytec/order-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: orders.map((o) => ({ header: o.header, lines: o.lines })) }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? res.statusText);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `受注_ジョイテック_${(src?.fileName ?? "").replace(/\.csv$/i, "")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`CSVの作成に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
          <Field label="出荷日">
            <input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
          </Field>
          <Field label="着日(希望納期)">
            <input type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} />
          </Field>
          <Field label="配送方法">
            <select value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)}>
              {DELIVERY_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="着日指定">
            <select value={arrivalSpec} onChange={(e) => setArrivalSpec(e.target.value)}>
              {ARRIVAL_SPEC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="時間帯指定">
            <select value={timeSpec} onChange={(e) => setTimeSpec(e.target.value)}>
              {TIME_SPEC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="入荷場所">
            <select value={receiveLocation} onChange={(e) => setReceiveLocation(e.target.value)}>
              {SHIPPING_LOCATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
          style={{
            border: "2px dashed var(--line)",
            borderRadius: 10,
            padding: 16,
            ...(dragging ? { borderColor: "var(--brand)", background: "#f5f8ff" } : {}),
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>発注データCSV(setYYYYMMDD.csv)をドロップ、または選択</div>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          {src && (
            <span style={{ marginLeft: 10, fontSize: 12.5, color: "var(--ink-faint)" }}>
              {src.fileName}(明細 {src.rows.length} 行・納品日 {deliveryDates.join("・") || "―"})
            </span>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      {src && !master && (
        <div className="card" style={{ padding: 20 }}>
          <span className="spinner" /> 商品マスタを読み込み中…
        </div>
      )}

      {orders.length > 0 && (
        <>
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13.5, marginBottom: 10 }}>
              <span>伝票 <b>{orders.length}</b> 件</span>
              <span>受注CSV <b>{allLines.length}</b> 行(商品 {allLines.filter((l) => l.kind === "商品").length}・刃付け代 {allLines.filter((l) => l.kind === "刃付け代").length}・運賃 {orders.length})</span>
              <span>金額合計 <b>{yen(total)}</b>(うち運賃 {yen(freight)})</span>
              {deliveryDates.length > 1 && <span style={{ color: "var(--neg)" }}>⚠ 納品日が複数あります({deliveryDates.join("・")})</span>}
            </div>
            {missing.size > 0 && (
              <div className="alert alert-error" style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  商品マスタに無い自社管理商品コードが {missing.size} 件あります。マスタに追加するまでCSVは作れません。
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {Array.from(missing).map(([code, v]) => (
                    <div key={code} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
                      <span>
                        {code} {v.name}(発注単価 {yen(v.price)}・{v.count}行)
                      </span>
                      <button
                        className="ghost-btn"
                        style={{ padding: "2px 10px" }}
                        onClick={() =>
                          onAddMaster({ ...EMPTY_MASTER, own_code: code, product_name: v.name, sell_price: v.price, note: code })
                        }
                      >
                        マスタに追加
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {priceDiff.length > 0 && (
              <div className="alert" style={{ marginBottom: 10, background: "#fff7e6", borderColor: "#f5c26b", color: "#8a5300" }}>
                ⚠ 発注データの単価とマスタの単価が違う行が {priceDiff.length} 行あります(CSVはマスタの単価で作ります)。
                下の一覧の「単価」欄で確認し、マスタが古い場合は商品マスタを更新してください。
              </div>
            )}
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button className="btn-primary" disabled={missing.size > 0 || downloading || !arrivalDate || !shipDate} onClick={download}>
                {downloading ? "作成中…" : "受注CSVダウンロード"}
              </button>
              <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={onlyWarn} onChange={(e) => setOnlyWarn(e.target.checked)} />
                注意のある伝票だけ表示
              </label>
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="table-scroll table-scroll-v" style={{ maxHeight: "70vh" }}>
              <table className="smaps-tbl">
                <thead>
                  <tr>
                    <th>伝票No / 店舗</th>
                    <th>自社コード</th>
                    <th>品目コード</th>
                    <th>品名・仕様</th>
                    <th style={{ textAlign: "right" }}>数量</th>
                    <th>単位</th>
                    <th style={{ textAlign: "right" }}>単価</th>
                    <th>手配</th>
                    <th>出荷場所</th>
                    <th>仕入先</th>
                    <th style={{ textAlign: "right" }}>原価</th>
                    <th>注意</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((o) =>
                    o.lines.map((l, i) => {
                      const warn = l.warnings.length > 0;
                      return (
                        <tr
                          key={`${o.slipNo}-${i}`}
                          style={{
                            ...(i === 0 ? { borderTop: "2px solid var(--line)" } : {}),
                            ...(l.kind === "運賃" ? { color: "var(--ink-faint)" } : {}),
                            ...(warn ? { background: l.warnings.includes("マスタ未登録") ? "#fdecec" : "#fff7e6" } : {}),
                          }}
                        >
                          <td>
                            {i === 0 ? (
                              <>
                                <b>{o.slipNo}</b>
                                <div className="cell-sub">
                                  {o.storeCode} {o.storeName}
                                </div>
                                <div className="cell-sub">担当: {o.header.delivery_contact}</div>
                              </>
                            ) : null}
                          </td>
                          <td className="nw">{l.kind === "運賃" ? "" : l.ownCode}</td>
                          <td className="nw">{l.product_code || "―"}</td>
                          <td>
                            {l.product_name} {l.spec}
                            {l.kind === "刃付け代" && <span className="cell-sub">(刃付け代)</span>}
                          </td>
                          <td className="nw" style={{ textAlign: "right" }}>{l.qty}</td>
                          <td className="nw">{l.unit}</td>
                          <td className="nw" style={{ textAlign: "right" }}>
                            {yen(l.unit_price)}
                            {l.warnings.includes("単価相違") && (
                              <div style={{ color: "#b45309", fontSize: 11.5 }}>発注 {yen(l.sourcePrice)}</div>
                            )}
                          </td>
                          <td className="nw">{ARRANGE_LABEL[l.arrange_code] ?? l.arrange_code}</td>
                          <td className="nw">{l.ship_location}</td>
                          <td className="nw">{l.supplier_code}</td>
                          <td className="nw" style={{ textAlign: "right" }}>{yen(l.cost_price)}</td>
                          <td className="nw" style={{ fontWeight: 600, color: l.warnings.includes("マスタ未登録") ? "var(--neg)" : "#b45309" }}>
                            {l.warnings.join("・")}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink-faint)" }}>
      {label}
      {children}
    </label>
  );
}

function MasterTab({
  rows,
  reload,
  editing,
  setEditing,
}: {
  rows: MasterRow[] | null;
  reload: () => void;
  editing: MasterRow | null;
  setEditing: (m: MasterRow | null) => void;
}) {
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (rows ?? []).filter((r) => {
      const s = [r.own_code, r.product_code, r.product_name, r.spec, r.supplier_code, r.supplier_name].join(" ").toLowerCase();
      return words.every((w) => s.includes(w));
    });
  }, [rows, q]);

  async function save(list: Partial<MasterRow>[], replaceAll = false) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/joytec/master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: list, replaceAll }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setMsg({ ok: true, text: `${json.saved} 件を保存しました。` });
      reload();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function importExcel(f: File) {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: "array" });
      const sheetName = wb.SheetNames.find((n) => n.includes("商品マスタ")) ?? wb.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null }) as (string | number | null)[][];
      const parsed = parseJoytecMasterSheet(data);
      if (
        !window.confirm(
          `「${sheetName}」シートから ${parsed.items.length} 件を読み取りました。\n今の商品マスタ(${rows?.length ?? 0} 件)をこの内容で丸ごと入れ替えます。よろしいですか?`
        )
      )
        return;
      await save(parsed.items, true);
    } catch (e) {
      setMsg({ ok: false, text: `Excelを読み取れませんでした: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function remove(code: string) {
    if (!window.confirm(`自社コード ${code} を商品マスタから削除します。よろしいですか?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/joytec/master?own_code=${encodeURIComponent(code)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setMsg({ ok: true, text: `${code} を削除しました。` });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {editing && (
        <MasterEditor
          value={editing}
          busy={busy}
          exists={!!rows?.some((r) => r.own_code === editing.own_code)}
          onCancel={() => setEditing(null)}
          onSave={async (m) => {
            if (await save([m])) setEditing(null);
          }}
        />
      )}
      {msg && (
        <div className={msg.ok ? "alert" : "alert alert-error"} style={{ marginBottom: 12 }}>
          {msg.text}
        </div>
      )}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <input
            type="search"
            placeholder="自社コード・品番・品名・仕入先で検索"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 300 }}
          />
          <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>{filtered.length} 件</span>
          <button className="btn-primary" onClick={() => setEditing({ ...EMPTY_MASTER })} disabled={busy}>
            + 商品を追加
          </button>
          <label className="ghost-btn" style={{ cursor: "pointer" }}>
            変換用エクセルから取り込む(丸ごと入れ替え)
            <input
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importExcel(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {!rows ? (
          <div>
            <span className="spinner" /> 読み込み中…
          </div>
        ) : rows.length === 0 ? (
          <p style={{ fontSize: 13 }}>まだ商品マスタがありません。「変換用エクセルから取り込む」で、変換用エクセル(商品マスタシート)を取り込んでください。</p>
        ) : (
          <div className="table-scroll table-scroll-v" style={{ maxHeight: "70vh" }}>
            <table className="smaps-tbl">
              <thead>
                <tr>
                  <th>自社コード</th>
                  <th>品番</th>
                  <th>品名・仕様</th>
                  <th style={{ textAlign: "right" }}>販売単価</th>
                  <th>手配</th>
                  <th>出荷場所</th>
                  <th>仕入先</th>
                  <th style={{ textAlign: "right" }}>原価</th>
                  <th>単位</th>
                  <th>備考</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.own_code}>
                    <td className="nw" style={{ fontWeight: 600 }}>{r.own_code}</td>
                    <td className="nw">{r.product_code}</td>
                    <td>
                      {r.product_name} {r.spec}
                    </td>
                    <td className="nw" style={{ textAlign: "right" }}>{yen(r.sell_price)}</td>
                    <td className="nw">{ARRANGE_LABEL[r.arrange_code ?? ""] ?? r.arrange_code}</td>
                    <td className="nw">{r.ship_location}</td>
                    <td>
                      {r.supplier_code} {r.supplier_name}
                    </td>
                    <td className="nw" style={{ textAlign: "right" }}>{yen(r.cost)}</td>
                    <td className="nw">{r.unit}</td>
                    <td className="nw">{r.note}</td>
                    <td className="nw">
                      <button className="ghost-btn" style={{ padding: "2px 10px" }} onClick={() => setEditing({ ...r })}>
                        編集
                      </button>{" "}
                      <button className="ghost-btn" style={{ padding: "2px 10px", color: "var(--neg)" }} onClick={() => remove(r.own_code)}>
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function MasterEditor({
  value,
  busy,
  exists,
  onCancel,
  onSave,
}: {
  value: MasterRow;
  busy: boolean;
  exists: boolean;
  onCancel: () => void;
  onSave: (m: MasterRow) => void;
}) {
  const [m, setM] = useState<MasterRow>(value);
  useEffect(() => setM(value), [value]);
  const set = (k: keyof MasterRow, v: string) =>
    setM((cur) => ({ ...cur, [k]: k === "sell_price" || k === "cost" ? (v === "" ? null : Number(v)) : v }));
  const input = (k: keyof MasterRow, label: string, width = 140, type = "text") => (
    <Field label={label}>
      <input type={type} value={(m[k] as string | number | null) ?? ""} onChange={(e) => set(k, e.target.value)} style={{ width }} />
    </Field>
  );
  return (
    <div className="card" style={{ padding: 20, marginBottom: 16, outline: "2px solid var(--brand)" }}>
      <h2 style={{ marginTop: 0, fontSize: 16 }}>{exists ? `商品マスタの修正(${m.own_code})` : "商品マスタに追加"}</h2>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        {input("own_code", "自社コード *", 90)}
        {input("product_code", "品番 *", 150)}
        {input("product_name", "品名", 260)}
        {input("spec", "仕様", 200)}
        {input("sell_price", "販売単価", 100, "number")}
        <Field label="手配">
          <select value={m.arrange_code ?? ""} onChange={(e) => set("arrange_code", e.target.value)}>
            {ARRANGE_CODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        {input("ship_location", "出荷場所(200=直送・91=土浦 など)", 120)}
        {input("supplier_code", "仕入先コード", 110)}
        {input("supplier_name", "仕入先名", 200)}
        {input("cost", "原価", 100, "number")}
        {input("unit", "単位コード(1=個 3=枚 4=式 5=本 6=台)", 90)}
        {input("note", "備考", 100)}
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
        <button className="btn-primary" disabled={busy || !m.own_code || !m.product_code} onClick={() => onSave(m)}>
          {busy ? "保存中…" : "保存"}
        </button>
        <button className="ghost-btn" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </div>
  );
}
