"use client";

import { useState } from "react";
import Link from "next/link";
import OrderCsvForm, { type LineState } from "@/components/OrderCsvForm";
import type { OrderCsvHeaderInput } from "@/lib/orderCsvLayout";
import type { SmapsPdf } from "@/lib/smapsPdf";
import type { ItemCandidate } from "@/lib/smapsMatch";

/**
 * SMAPS(イオンリテール 購買部)の取引詳細PDFから受注取込CSVを作る。
 * 1. PDFをドロップ → サーバー(/api/smaps-pdf)で読み取り、過去の受注から明細ごとの候補を付けて返す
 * 2. 明細ごとに候補(品番・仕入先・原価)を選ぶ(使わなければ汎用品番77700)
 * 3. 受注CSV作成フォームに流し込み、一式見積の分割・値引・発注備考などを画面で直してCSV出力
 */

const SMAPS_CUSTOMER_CODE = "210960444";
const SMAPS_DELIVERY_CODE = "777";
const GENERIC_PRODUCT_CODE = "77700";
const DEFAULT_INTERNAL_NOTE = "請求先:イオンリテール購買部";

type Trade = {
  fileName: string;
  pdf: SmapsPdf;
  existingOrderNos: string[];
  customerContact: string;
  receiverName: string;
  historyCount: number;
  historyError: string | null;
  candidates: ItemCandidate[][];
  // 明細ごとに選んだ候補の番号(-1 = 候補を使わない)
  choice: number[];
};

type Loading = { fileName: string; error: string | null };

function ymd(s: string): string {
  const m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

function mmddArrival(s: string): string {
  const m = s.match(/\d{4}\/(\d{1,2})\/(\d{1,2})/);
  return m ? `${Number(m[1])}／${Number(m[2])}着` : "";
}

function postal(s: string): string {
  const d = s.replace(/\D/g, "");
  return d.length === 7 ? `${d.slice(0, 3)}-${d.slice(3)}` : s;
}

// 納品先の2行目は「イオンモール広島府中 北搬入口」のように店名が重複するので、店名部分を外す
// (マックスバリュー一日橋店 のように店名だけの場合は空欄)。
function placeWithoutStore(place: string, store: string): string {
  const compact = (v: string) => v.replace(/[\s\u3000ー－-]/g, "");
  const p = place.trim();
  if (!p) return "";
  const s = compact(store);
  if (s && compact(p) === s) return "";
  if (s && compact(p).startsWith(s)) {
    let i = 0;
    let seen = 0;
    while (i < p.length && seen < s.length) {
      if (!/[\s\u3000ー－-]/.test(p[i])) seen++;
      i++;
    }
    return p.slice(i).trim();
  }
  if (compact(p).replace(/ー/g, "") === s.replace(/ー/g, "")) return "";
  return p;
}

function yen(n: number | null | undefined): string {
  return n == null ? "―" : `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

function buildHeader(t: Trade): Partial<OrderCsvHeaderInput> {
  const p = t.pdf;
  const date = ymd(p.confirmedDate || p.desiredDate);
  const billing = p.billingCompany.replace(/株式会社/g, "").trim();
  const internalNote =
    !billing || billing.startsWith("イオンリテール") ? DEFAULT_INTERNAL_NOTE : `請求先:${p.billingCompany}`;
  return {
    customer_code: SMAPS_CUSTOMER_CODE,
    delivery_code: SMAPS_DELIVERY_CODE,
    delivery_name1: p.store,
    delivery_name2: t.receiverName,
    delivery_address1: p.deliveryAddress,
    delivery_address2: placeWithoutStore(p.deliveryPlace, p.store),
    delivery_postal_code: postal(p.deliveryPostalCode),
    delivery_tel: p.tel,
    delivery_contact: p.receiver,
    customer_po_no: p.tradeNo,
    customer_contact: t.customerContact,
    note: "",
    desired_date: date,
    receive_location: "200",
    subject: "",
    subject_amount: "",
    internal_note: internalNote,
    article1: mmddArrival(p.confirmedDate || p.desiredDate),
  };
}

function buildLines(t: Trade): LineState[] {
  const p = t.pdf;
  const today = new Date().toISOString().slice(0, 10);
  const base = {
    ship_date: today,
    ship_location: "200",
    delivery_method: "1",
    arrival_spec: "2",
    time_spec: "0",
    department1: "",
    department2: "",
    purchase_note: "",
  };
  const lines: LineState[] = p.items.map((it, i) => {
    const c = t.choice[i] >= 0 ? t.candidates[i][t.choice[i]] : null;
    return {
      ...base,
      product_code: c?.product_code ?? GENERIC_PRODUCT_CODE,
      product_name: c?.product_name || it.name,
      spec: c ? c.spec || null : it.model || null,
      qty: it.qty ?? 1,
      unit_price: it.unitPrice ?? 0,
      note: c?.note || null,
      unit: c?.unit || "個",
      arrange_code: "80",
      supplier_code: c?.supplier_code || null,
      supplier_name: c?.supplier_name || "",
      cost_price: c?.cost ?? null,
      arrival_date: ymd(it.confirmedDate || p.confirmedDate),
    };
  });
  if (p.freightTotal && p.freightTotal > 0) {
    lines.push({
      ...base,
      product_code: "99",
      product_name: "運賃",
      spec: null,
      qty: 1,
      unit_price: p.freightTotal,
      note: null,
      unit: "式",
      arrange_code: "99",
      supplier_code: "2",
      supplier_name: "運賃",
      cost_price: null,
      arrival_date: ymd(p.confirmedDate),
    });
  }
  return lines;
}

export default function SmapsOrderImport() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState<Loading[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    for (const f of list) {
      setLoading((prev) => [...prev, { fileName: f.name, error: null }]);
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/smaps-pdf", { method: "POST", body: fd });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? res.statusText);
        const candidates: ItemCandidate[][] = json.candidates ?? [];
        const trade: Trade = {
          fileName: f.name,
          pdf: json.pdf,
          existingOrderNos: json.existingOrderNos ?? [],
          customerContact: json.customerContact ?? "",
          receiverName: json.receiverName ?? "",
          historyCount: json.historyCount ?? 0,
          historyError: json.historyError ?? null,
          candidates,
          choice: candidates.map((c) => (c.length > 0 && c[0].score >= 60 ? 0 : -1)),
        };
        setTrades((prev) => {
          const next = [...prev.filter((t) => t.pdf.tradeNo !== trade.pdf.tradeNo), trade];
          setSelected((cur) => (cur === null ? next.length - 1 : cur));
          return next;
        });
        setLoading((prev) => prev.filter((l) => l.fileName !== f.name));
      } catch (e) {
        setLoading((prev) =>
          prev.map((l) => (l.fileName === f.name ? { ...l, error: e instanceof Error ? e.message : String(e) } : l))
        );
      }
    }
  }

  function setChoice(itemIndex: number, value: number) {
    if (selected === null) return;
    setTrades((prev) =>
      prev.map((t, i) => (i === selected ? { ...t, choice: t.choice.map((c, k) => (k === itemIndex ? value : c)) } : t))
    );
  }

  const trade = selected !== null ? trades[selected] : null;

  if (trade && editing) {
    return (
      <div>
        <div className="wrap" style={{ maxWidth: 1600, paddingBottom: 0 }}>
          <button className="ghost-btn" onClick={() => setEditing(false)}>
            ← 候補の選択に戻る(この画面での修正は消えます)
          </button>
        </div>
        <OrderCsvForm
          key={trade.pdf.tradeNo}
          title={`SMAPS 受注CSV作成(取引通番 ${trade.pdf.tradeNo})`}
          backHref="/sales-app"
          backLabel="← 営業アプリ"
          downloadFileNameBase={`受注_SMAPS_${trade.pdf.tradeNo}`}
          initialHeader={buildHeader(trade)}
          initialLines={buildLines(trade)}
        />
      </div>
    );
  }

  return (
    <div className="wrap" style={{ maxWidth: 1200 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>SMAPS 受注取込</h1>
          <p>SMAPSの取引詳細画面を印刷したPDFを読み込み、過去の受注を参考に受注取込CSVを作ります。</p>
        </div>
        <Link href="/sales-app" className="ghost-btn-inline">
          ← 営業アプリ
        </Link>
      </header>

      <div
        className="card"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
        }}
        style={{ padding: 20, marginBottom: 16, ...(dragging ? { outline: "2px dashed var(--brand)", outlineOffset: -2 } : {}) }}
      >
        <h2 style={{ marginTop: 0, fontSize: 16 }}>取引詳細PDF(複数可)</h2>
        <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--ink-faint)" }}>
          ここにドラッグ&ドロップするか、ボタンで選んでください。同じ取引通番を入れ直すと上書きします。
        </p>
        <input
          type="file"
          accept=".pdf"
          multiple
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {loading.map((l) => (
          <div key={l.fileName} style={{ fontSize: 12.5, marginTop: 6, color: l.error ? "var(--neg)" : "var(--ink-faint)" }}>
            {l.error ? `${l.fileName}: ${l.error}` : (
              <>
                <span className="spinner" /> {l.fileName} を読み取り中…
              </>
            )}
          </div>
        ))}
      </div>

      {trades.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {trades.map((t, i) => (
            <button key={t.pdf.tradeNo} className={i === selected ? "btn-primary" : "ghost-btn"} onClick={() => setSelected(i)}>
              {t.pdf.tradeNo} {t.pdf.store}
              {t.existingOrderNos.length > 0 ? " ⚠" : ""}
            </button>
          ))}
        </div>
      )}

      {trade && (
        <>
          {trade.existingOrderNos.length > 0 && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              この取引通番({trade.pdf.tradeNo})は、すでに受注 {trade.existingOrderNos.join("・")} として登録されています。二重登録に注意してください。
            </div>
          )}
          {trade.historyError && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              過去の受注データを読めませんでした({trade.historyError})。PDFの内容だけで進められます。
            </div>
          )}
          {!trade.historyError && trade.historyCount === 0 && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              過去の受注データが登録されていないため、候補を出せません。データ更新画面の「受注データ」から受注出力CSVを登録してください。
            </div>
          )}

          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <style>{`.smaps-info th, .smaps-info td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line); vertical-align: top; } .smaps-info th { color: var(--ink-faint); font-weight: 500; white-space: nowrap; }`}</style>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>
              取引通番 {trade.pdf.tradeNo}:{trade.pdf.title}
            </h2>
            <table className="smaps-info" style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", textAlign: "left" }}>
              <tbody>
                <tr><th style={{ width: 140 }}>会社 / 客先担当</th><td>{trade.pdf.company} → 客先担当「{trade.customerContact}」</td></tr>
                <tr><th>店舗</th><td>{trade.pdf.store}(店舗担当 {trade.pdf.storeContact})</td></tr>
                <tr><th>納品先</th><td>〒{postal(trade.pdf.deliveryPostalCode)} {trade.pdf.deliveryAddress} {trade.pdf.deliveryPlace}</td></tr>
                <tr><th>受入担当 / TEL</th><td>{trade.pdf.receiver} / {trade.pdf.tel}{trade.pdf.mobile ? `(携帯 ${trade.pdf.mobile})` : ""}</td></tr>
                <tr><th>希望納期 / 納期確定日</th><td>{trade.pdf.desiredDate} / {trade.pdf.confirmedDate}</td></tr>
                <tr><th>金額</th><td>商品 {yen(trade.pdf.goodsTotal)}・運搬費 {yen(trade.pdf.freightTotal)}・設置/作業費 {yen(trade.pdf.installTotal)}</td></tr>
                <tr><th>請求書送付先</th><td>{trade.pdf.billingCompany || "(空欄 → 社内連絡は「" + DEFAULT_INTERNAL_NOTE + "」)"} {trade.pdf.billingDept}</td></tr>
                {trade.pdf.comments.length > 0 && (
                  <tr><th>コメント</th><td style={{ whiteSpace: "pre-wrap" }}>{trade.pdf.comments.join("\n")}</td></tr>
                )}
              </tbody>
            </table>
            {(trade.pdf.installTotal ?? 0) > 0 && (
              <p style={{ color: "var(--neg)", fontSize: 12.5 }}>設置費・作業費があります。受注CSV作成の画面で行を追加してください。</p>
            )}
          </div>

          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>明細ごとの品番・仕入先(過去の受注から)</h2>
            <p style={{ marginTop: 0, fontSize: 12.5, color: "var(--ink-faint)" }}>
              品名・型番・単価が近い過去の受注を候補に出しています。使う候補を選んでください。該当が無ければ「候補を使わない」で汎用品番 {GENERIC_PRODUCT_CODE} になり、仕入先・原価は次の画面で入力します。
            </p>
            {trade.pdf.items.map((it, i) => (
              <div key={i} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                  {it.no}. {it.name}
                  <span className="cell-sub" style={{ fontWeight: 400, marginLeft: 8 }}>
                    イオン品番 {it.aeonCode}{it.model ? `・型番 ${it.model}` : ""}{it.size ? `・${it.size}` : ""}・{yen(it.unitPrice)} × {it.qty}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, fontSize: 12.5 }}>
                  {trade.candidates[i].map((c, k) => (
                    <label key={k} style={{ display: "flex", gap: 8, alignItems: "baseline", cursor: "pointer" }}>
                      <input type="radio" checked={trade.choice[i] === k} onChange={() => setChoice(i, k)} />
                      <span>
                        <b>{c.product_code}</b> {c.product_name} {c.spec}
                        <span className="cell-sub">
                          {" "}／ 仕入先 {c.supplier_code} {c.supplier_name}・原価 {yen(c.cost)}・単価 {yen(c.unit_price)}
                          {c.note ? `・備考 ${c.note}` : ""}／ 受注 {c.order_no}({c.order_date}・通番 {c.customer_po_no})・一致度 {c.score}
                        </span>
                      </span>
                    </label>
                  ))}
                  <label style={{ display: "flex", gap: 8, alignItems: "baseline", cursor: "pointer" }}>
                    <input type="radio" checked={trade.choice[i] === -1} onChange={() => setChoice(i, -1)} />
                    <span>候補を使わない(品番 {GENERIC_PRODUCT_CODE}・品名はPDFのまま){trade.candidates[i].length === 0 ? " ― 該当する過去の受注なし" : ""}</span>
                  </label>
                </div>
              </div>
            ))}
            {trade.pdf.freightTotal ? (
              <p style={{ marginBottom: 0, fontSize: 12.5, color: "var(--ink-faint)" }}>運搬費 {yen(trade.pdf.freightTotal)} は、品番99「運賃」の行として追加します。</p>
            ) : null}
          </div>

          <button className="btn-primary" onClick={() => setEditing(true)}>
            この内容で受注CSV作成へ進む
          </button>
        </>
      )}
    </div>
  );
}
