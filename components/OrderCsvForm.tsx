"use client";
import { useState } from "react";
import Link from "next/link";
import type { DocumentWithLines } from "@/lib/quoteTypes";
import {
  SHIPPING_LOCATION_OPTIONS,
  ARRANGE_CODE_OPTIONS,
  ARRIVAL_SPEC_OPTIONS,
  TIME_SPEC_OPTIONS,
  DELIVERY_METHOD_OPTIONS,
  UNIT_SUGGESTIONS,
  type OrderCsvHeaderInput,
  type OrderCsvLineInput,
} from "@/lib/orderCsvLayout";

// 全角20文字ずつ2つのフィールド(名称1/2、住所1/2)に分ける簡易ヘルパー。
function splitZenkaku20(s: string | null | undefined): [string, string] {
  const chars = Array.from(s ?? "");
  return [chars.slice(0, 20).join(""), chars.slice(20, 40).join("")];
}

type LineState = OrderCsvLineInput;

export default function OrderCsvForm({
  doc,
  defaultPostalCode,
  defaultPhone,
}: {
  doc: DocumentWithLines;
  defaultPostalCode: string | null;
  defaultPhone: string | null;
}) {
  const [name1, name2Init] = splitZenkaku20(doc.customer_name);
  const [addr1, addr2Init] = splitZenkaku20(doc.customer_address);

  const [deliveryCode, setDeliveryCode] = useState(doc.customer_code ?? "");
  const [deliveryName1, setDeliveryName1] = useState(name1);
  const [deliveryName2, setDeliveryName2] = useState(name2Init);
  const [deliveryAddress1, setDeliveryAddress1] = useState(addr1);
  const [deliveryAddress2, setDeliveryAddress2] = useState(addr2Init);
  const [deliveryPostalCode, setDeliveryPostalCode] = useState((defaultPostalCode ?? "").replaceAll("-", ""));
  const [deliveryTel, setDeliveryTel] = useState((defaultPhone ?? "").replaceAll("-", ""));
  const [deliveryContact, setDeliveryContact] = useState("");
  const [customerPoNo, setCustomerPoNo] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [note, setNote] = useState(doc.note ?? "");
  const [shipDate, setShipDate] = useState("");
  const [desiredDate, setDesiredDate] = useState(doc.due_or_valid_date ?? "");
  const [arrivalDate, setArrivalDate] = useState("");
  const [shipLocation, setShipLocation] = useState("200");
  const [receiveLocation, setReceiveLocation] = useState("200");
  const [deliveryMethod, setDeliveryMethod] = useState("1");
  const [arrivalSpec, setArrivalSpec] = useState("0");
  const [timeSpec, setTimeSpec] = useState("0");
  const [subject, setSubject] = useState(doc.subject ?? "");

  const [lines, setLines] = useState<LineState[]>(
    doc.lines.map((l) => ({
      product_code: l.product_code,
      product_name: l.product_name,
      spec: l.spec,
      qty: l.qty,
      unit_price: l.unit_price,
      note: l.note,
      unit: "",
      arrange_code: "",
      supplier_code: l.supplier_code,
      cost_price: l.cost_price,
      department1: "",
      department2: "",
    }))
  );

  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  function updateLine(index: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function handleDownload() {
    setError(null);
    const header: OrderCsvHeaderInput = {
      customer_code: doc.customer_code ?? "",
      delivery_code: deliveryCode,
      delivery_name1: deliveryName1,
      delivery_name2: deliveryName2,
      delivery_address1: deliveryAddress1,
      delivery_address2: deliveryAddress2,
      delivery_postal_code: deliveryPostalCode,
      delivery_tel: deliveryTel,
      delivery_contact: deliveryContact,
      customer_po_no: customerPoNo,
      customer_contact: customerContact,
      note,
      ship_date: shipDate,
      desired_date: desiredDate,
      arrival_date: arrivalDate,
      ship_location: shipLocation,
      receive_location: receiveLocation,
      delivery_method: deliveryMethod,
      arrival_spec: arrivalSpec,
      time_spec: timeSpec,
      subject,
    };
    setDownloading(true);
    try {
      const res = await fetch("/api/quote-order-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ header, lines }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: "CSV生成に失敗しました。" }));
        throw new Error(json.error ?? "CSV生成に失敗しました。");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `受注_${doc.doc_no}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>受注CSV作成 - {doc.doc_no}</h1>
        <Link href={`/sales-app/quotes/${doc.id}`} className="ghost-btn-inline">
          ← 見積書に戻る
        </Link>
      </header>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="cell-sub" style={{ marginBottom: 12 }}>
          見積の得意先コード({doc.customer_code ?? "未設定"})・品番・品名・数量・単価・仕入先・仕入単価は見積からそのまま使います。
          納入先・配送まわりの情報だけここで入力してください。
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <Field label="納入先コード">
            <input value={deliveryCode} onChange={(e) => setDeliveryCode(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="納入先名称1">
            <input value={deliveryName1} onChange={(e) => setDeliveryName1(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="納入先名称2">
            <input value={deliveryName2} onChange={(e) => setDeliveryName2(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="納入先住所1">
            <input value={deliveryAddress1} onChange={(e) => setDeliveryAddress1(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="納入先住所2">
            <input value={deliveryAddress2} onChange={(e) => setDeliveryAddress2(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="納入先郵便番号">
            <input value={deliveryPostalCode} onChange={(e) => setDeliveryPostalCode(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="納入先TEL">
            <input value={deliveryTel} onChange={(e) => setDeliveryTel(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="納入先担当">
            <input value={deliveryContact} onChange={(e) => setDeliveryContact(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="客先注番 *必須">
            <input value={customerPoNo} onChange={(e) => setCustomerPoNo(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="客先担当">
            <input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="件名">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="伝票備考">
            <input value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="出荷日">
            <input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="希望納期">
            <input type="date" value={desiredDate} onChange={(e) => setDesiredDate(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="着日">
            <input type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="出荷場所">
            <select value={shipLocation} onChange={(e) => setShipLocation(e.target.value)} style={inputStyle}>
              {SHIPPING_LOCATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="入荷場所">
            <select value={receiveLocation} onChange={(e) => setReceiveLocation(e.target.value)} style={inputStyle}>
              {SHIPPING_LOCATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="配送方法">
            <select value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)} style={inputStyle}>
              {DELIVERY_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="着日指定">
            <select value={arrivalSpec} onChange={(e) => setArrivalSpec(e.target.value)} style={inputStyle}>
              {ARRIVAL_SPEC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="時間帯指定">
            <select value={timeSpec} onChange={(e) => setTimeSpec(e.target.value)} style={inputStyle}>
              {TIME_SPEC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16, overflowX: "auto" }}>
        <div className="cell-sub" style={{ marginBottom: 8 }}>明細ごとに単位・手配コードを選択してください(手配コードは全行必須)。</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={thStyle}>品目コード</th>
              <th style={thStyle}>品名</th>
              <th style={thStyle}>数量</th>
              <th style={thStyle}>単価</th>
              <th style={thStyle}>単位</th>
              <th style={thStyle}>手配コード *必須</th>
              <th style={thStyle}>仕入先</th>
              <th style={thStyle}>仕入単価</th>
              <th style={thStyle}>部門1</th>
              <th style={thStyle}>部門2</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={tdStyle}>{l.product_code}</td>
                <td style={tdStyle}>{l.product_name}</td>
                <td style={tdStyle}>{l.qty}</td>
                <td style={tdStyle}>{l.unit_price}</td>
                <td style={tdStyle}>
                  <input
                    list="unit-suggestions"
                    value={l.unit}
                    onChange={(e) => updateLine(i, { unit: e.target.value })}
                    style={{ ...inputStyle, width: 70 }}
                  />
                </td>
                <td style={tdStyle}>
                  <select value={l.arrange_code} onChange={(e) => updateLine(i, { arrange_code: e.target.value })} style={inputStyle}>
                    <option value="">選択</option>
                    {ARRANGE_CODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
                <td style={tdStyle}>
                  <input value={l.supplier_code ?? ""} onChange={(e) => updateLine(i, { supplier_code: e.target.value })} style={{ ...inputStyle, width: 100 }} />
                </td>
                <td style={tdStyle}>
                  <input
                    type="number"
                    value={l.cost_price ?? ""}
                    onChange={(e) => updateLine(i, { cost_price: e.target.value === "" ? null : Number(e.target.value) })}
                    style={{ ...inputStyle, width: 90 }}
                  />
                </td>
                <td style={tdStyle}>
                  <input value={l.department1} onChange={(e) => updateLine(i, { department1: e.target.value })} style={{ ...inputStyle, width: 70 }} />
                </td>
                <td style={tdStyle}>
                  <input value={l.department2} onChange={(e) => updateLine(i, { department2: e.target.value })} style={{ ...inputStyle, width: 70 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="unit-suggestions">
          {UNIT_SUGGESTIONS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <button type="button" className="btn-primary" onClick={handleDownload} disabled={downloading}>
        {downloading ? "作成中..." : "CSVダウンロード"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: "100%", padding: "6px 10px" };
const thStyle: React.CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "4px 8px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
