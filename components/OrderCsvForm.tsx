"use client";
import { useState } from "react";
import Link from "next/link";
import {
  SHIPPING_LOCATION_OPTIONS,
  ARRANGE_CODE_OPTIONS,
  ARRIVAL_SPEC_OPTIONS,
  TIME_SPEC_OPTIONS,
  DELIVERY_METHOD_OPTIONS,
  UNIT_SUGGESTIONS,
  splitZenkaku20,
  type OrderCsvHeaderInput,
  type OrderCsvLineInput,
} from "@/lib/orderCsvLayout";

type CustomerOption = { customer_code: string; customer_name: string; postal_code: string | null; address: string | null; phone_number: string | null };
type ProductOption = { product_code: string; product_name: string; spec: string | null };
type SupplierOption = { supplier_code: string; supplier_name: string };

// コードを直接入力してもよいし、名前で検索して候補から選んでもよい共通入力部品。
// 得意先コード・品目コード・仕入先など、コードだけでは覚えにくい項目で使う。
function SearchableCodeField<T>({
  label,
  required,
  value,
  onChangeValue,
  searchUrl,
  renderOption,
  onSelect,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChangeValue: (v: string) => void;
  searchUrl: string;
  renderOption: (row: T) => React.ReactNode;
  onSelect: (row: T) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${searchUrl}?query=${encodeURIComponent(query.trim())}`);
      const json = await res.json();
      setResults(json.rows ?? []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <Field label={label + (required ? " *必須" : "")}>
      <input value={value} onChange={(e) => onChangeValue(e.target.value)} style={inputStyle} placeholder="コード" />
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch();
            }
          }}
          placeholder="名前で検索"
          style={{ ...inputStyle, fontSize: 12, padding: "4px 8px" }}
        />
        <button type="button" className="btn-sm" onClick={runSearch} disabled={searching}>
          検索
        </button>
      </div>
      {results && (
        <div className="card" style={{ marginTop: 4, maxHeight: 160, overflowY: "auto" }}>
          {results.length === 0 && <p className="cell-sub" style={{ padding: 8 }}>見つかりません。</p>}
          {results.map((r, idx) => (
            <div
              key={idx}
              className="search-item"
              onClick={() => {
                onSelect(r);
                setResults(null);
                setQuery("");
              }}
            >
              {renderOption(r)}
            </div>
          ))}
        </div>
      )}
    </Field>
  );
}

// supplier_nameはCSVには出さない(仕入先コードのみ)が、選んだ仕入先が合っているか
// 画面上で確認できるよう、表示専用でlineの中に持たせておく。
type LineState = OrderCsvLineInput & { supplier_name?: string };

const DEFAULT_LINE_VALUES = {
  ship_date: "",
  arrival_date: "",
  ship_location: "200",
  delivery_method: "1",
  arrival_spec: "0",
  time_spec: "0",
};

function emptyLine(): LineState {
  return {
    product_code: "",
    product_name: "",
    spec: "",
    qty: 1,
    unit_price: 0,
    note: "",
    unit: "",
    arrange_code: "",
    supplier_code: "",
    supplier_name: "",
    cost_price: null,
    purchase_note: "",
    department1: "",
    department2: "",
    ...DEFAULT_LINE_VALUES,
  };
}

// この画面は受注CSV作成単体で完結させている(見積とは切り離してある)。
// 見積から連動する場合は、呼び出し側(見積詳細画面など)がinitialHeader/initialLinesに
// 見積の内容を詰めて渡すだけでよい(この画面自体は見積の存在を一切知らない)。
export default function OrderCsvForm({
  title,
  backHref,
  backLabel,
  downloadFileNameBase,
  initialHeader,
  initialLines,
}: {
  title: string;
  backHref: string;
  backLabel: string;
  downloadFileNameBase: string;
  initialHeader?: Partial<OrderCsvHeaderInput>;
  initialLines?: LineState[];
}) {
  const h = initialHeader ?? {};

  const [customerCode, setCustomerCode] = useState(h.customer_code ?? "");
  const [deliveryCode, setDeliveryCode] = useState(h.delivery_code ?? "");
  const [deliveryName1, setDeliveryName1] = useState(h.delivery_name1 ?? "");
  const [deliveryName2, setDeliveryName2] = useState(h.delivery_name2 ?? "");
  const [deliveryAddress1, setDeliveryAddress1] = useState(h.delivery_address1 ?? "");
  const [deliveryAddress2, setDeliveryAddress2] = useState(h.delivery_address2 ?? "");
  const [deliveryPostalCode, setDeliveryPostalCode] = useState(h.delivery_postal_code ?? "");
  const [deliveryTel, setDeliveryTel] = useState(h.delivery_tel ?? "");
  const [deliveryContact, setDeliveryContact] = useState(h.delivery_contact ?? "");
  const [customerPoNo, setCustomerPoNo] = useState(h.customer_po_no ?? "");
  const [customerContact, setCustomerContact] = useState(h.customer_contact ?? "");
  const [note, setNote] = useState(h.note ?? "");
  const [desiredDate, setDesiredDate] = useState(h.desired_date ?? "");
  const [receiveLocation, setReceiveLocation] = useState(h.receive_location ?? "200");
  const [subject, setSubject] = useState(h.subject ?? "");
  const [subjectAmount, setSubjectAmount] = useState(h.subject_amount ?? "");
  const [internalNote, setInternalNote] = useState(h.internal_note ?? "");

  // 出荷日・着日・出荷場所・配送方法・着日指定・時間帯指定は、受注入力画面を確認したところ
  // 明細行ごとに違う値を持てる(例: 在庫出荷の行とメーカー直送の行で出荷場所が違う)。
  // ここでは「全行への初期値」として持ち、下の明細行(lines)を実際にCSVへ書き出す値として扱う。
  const [defaults, setDefaults] = useState(DEFAULT_LINE_VALUES);

  const [lines, setLines] = useState<LineState[]>(
    initialLines && initialLines.length > 0 ? initialLines : [emptyLine()]
  );

  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // 「+商品から追加」は見積画面と同じ入力方法(検索→選んだ商品をそのまま1行追加)。
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<ProductOption[] | null>(null);
  const [productSearching, setProductSearching] = useState(false);

  function updateLine(index: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { ...emptyLine(), ...defaults }]);
  }

  async function searchProduct() {
    if (!productQuery.trim()) return;
    setProductSearching(true);
    try {
      const res = await fetch(`/api/quote-product-search?query=${encodeURIComponent(productQuery.trim())}`);
      const json = await res.json();
      setProductResults(json.rows ?? []);
    } finally {
      setProductSearching(false);
    }
  }

  function addFromProduct(p: ProductOption) {
    const index = lines.length;
    setLines((prev) => [
      ...prev,
      { ...emptyLine(), ...defaults, product_code: p.product_code, product_name: p.product_name, spec: p.spec ?? "" },
    ]);
    setShowProductSearch(false);
    setProductQuery("");
    setProductResults(null);
    refreshLineCost(index, p.product_code);
  }

  // 見積画面と同じく、品番がセットされたら直近の仕入値・仕入先を自動で取得して埋める
  // (quote-product-cost: 仕入実績(purchases)があればその直近1件、無ければ商品マスタの
  // 登録仕入単価にフォールバックする、既存ロジックそのまま)。
  async function refreshLineCost(index: number, productCode: string) {
    if (!productCode.trim()) return;
    try {
      const res = await fetch(`/api/quote-product-cost?product_code=${encodeURIComponent(productCode.trim())}`);
      const json = await res.json();
      if (json.cost_price == null && !json.cost_supplier_code) return;
      updateLine(index, {
        cost_price: json.cost_price ?? null,
        supplier_code: json.cost_supplier_code ?? null,
        supplier_name: json.cost_supplier_name ?? "",
      });
    } catch {
      // 参考情報の取得失敗は無視する(仕入先・仕入単価は手動でも入力できるため)。
    }
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function applyDefaultsToAllLines() {
    setLines((prev) => prev.map((l) => ({ ...l, ...defaults })));
  }

  async function handleDownload() {
    setError(null);
    const header: OrderCsvHeaderInput = {
      customer_code: customerCode,
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
      desired_date: desiredDate,
      receive_location: receiveLocation,
      subject,
      subject_amount: subjectAmount,
      internal_note: internalNote,
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
      a.download = `${downloadFileNameBase}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  const totalAmount = lines.reduce((sum, l) => sum + (l.qty || 0) * (l.unit_price || 0), 0);
  const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;

  return (
    <div style={{ maxWidth: 1300, margin: "0 auto", padding: "20px 16px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{title}</h1>
        <Link href={backHref} className="ghost-btn-inline">
          {backLabel}
        </Link>
      </header>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="cell-sub" style={{ marginBottom: 12 }}>得意先・納入先・配送まわりの情報を入力してください。</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {/* 受注入力画面の並び: 得意先コード→納入先コード→TEL→郵便番号→名称→住所→担当
              →客先注番→客先担当→件名→伝票備考→希望納期→入荷場所 */}
          <SearchableCodeField<CustomerOption>
            label="得意先コード"
            required
            value={customerCode}
            onChangeValue={setCustomerCode}
            searchUrl="/api/quote-customer-search"
            renderOption={(c) => <>{c.customer_code} {c.customer_name}</>}
            onSelect={(c) => {
              setCustomerCode(c.customer_code);
              setDeliveryCode(c.customer_code);
              const [n1, n2] = splitZenkaku20(c.customer_name);
              setDeliveryName1(n1);
              setDeliveryName2(n2);
              const [a1, a2] = splitZenkaku20(c.address);
              setDeliveryAddress1(a1);
              setDeliveryAddress2(a2);
              setDeliveryPostalCode((c.postal_code ?? "").replaceAll("-", ""));
              setDeliveryTel((c.phone_number ?? "").replaceAll("-", ""));
            }}
          />
          <Field label="納入先コード">
            <input value={deliveryCode} onChange={(e) => setDeliveryCode(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="納入先TEL">
            <input value={deliveryTel} onChange={(e) => setDeliveryTel(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="納入先郵便番号">
            <input value={deliveryPostalCode} onChange={(e) => setDeliveryPostalCode(e.target.value)} style={inputStyle} />
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
          <Field label="件名金額">
            <input
              type="number"
              value={subjectAmount}
              onChange={(e) => setSubjectAmount(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="伝票備考">
            <input value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="社内連絡">
            <input value={internalNote} onChange={(e) => setInternalNote(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="希望納期">
            <input type="date" value={desiredDate} onChange={(e) => setDesiredDate(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="入荷場所">
            <select value={receiveLocation} onChange={(e) => setReceiveLocation(e.target.value)} style={inputStyle}>
              {SHIPPING_LOCATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="cell-sub" style={{ marginBottom: 8 }}>
          出荷日・着日・出荷場所・配送方法・着日指定・時間帯指定は、明細行(商品)ごとに違う場合があるため、下の明細表で行ごとに設定します。
          ここではまとめて初期値を設定し、「全行に適用」で一括反映できます(行ごとに個別の調整も可能です)。
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="出荷場所">
            <select value={defaults.ship_location} onChange={(e) => setDefaults((d) => ({ ...d, ship_location: e.target.value }))} style={inputStyle}>
              {SHIPPING_LOCATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="出荷日">
            <input type="date" value={defaults.ship_date} onChange={(e) => setDefaults((d) => ({ ...d, ship_date: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="着日">
            <input type="date" value={defaults.arrival_date} onChange={(e) => setDefaults((d) => ({ ...d, arrival_date: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="着日指定">
            <select value={defaults.arrival_spec} onChange={(e) => setDefaults((d) => ({ ...d, arrival_spec: e.target.value }))} style={inputStyle}>
              {ARRIVAL_SPEC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="時間帯指定">
            <select value={defaults.time_spec} onChange={(e) => setDefaults((d) => ({ ...d, time_spec: e.target.value }))} style={inputStyle}>
              {TIME_SPEC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="配送方法">
            <select value={defaults.delivery_method} onChange={(e) => setDefaults((d) => ({ ...d, delivery_method: e.target.value }))} style={inputStyle}>
              {DELIVERY_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <button type="button" onClick={applyDefaultsToAllLines}>全行に適用</button>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div className="cell-sub">明細を入力してください(単位・手配コードは全行必須)。</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <strong style={{ fontSize: 14 }}>合計(数量×単価): {yen(totalAmount)}</strong>
            <button type="button" onClick={() => setShowProductSearch((s) => !s)}>
              +商品から追加
            </button>
            <button type="button" onClick={addLine}>+明細行を追加(自由入力)</button>
          </div>
        </div>

        {showProductSearch && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                placeholder="品番・品名で検索"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchProduct()}
                style={{ flex: 1, padding: "6px 10px" }}
              />
              <button type="button" onClick={searchProduct} disabled={productSearching}>
                {productSearching ? "検索中…" : "検索"}
              </button>
            </div>
            {productResults && (
              <div className="card" style={{ marginTop: 4, maxHeight: 220, overflowY: "auto" }}>
                {productResults.length === 0 && <p className="cell-sub" style={{ padding: 8 }}>見つかりません。</p>}
                {productResults.map((p) => (
                  <div key={p.product_code} className="search-item" onClick={() => addFromProduct(p)}>
                    {p.product_code} {p.product_name} {p.spec ? `(${p.spec})` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {lines.map((l, i) => (
          <div
            key={i}
            style={{
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-sm)",
              padding: 14,
              marginTop: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <strong style={{ fontSize: 13 }}>
                明細 {i + 1}
                <span className="cell-sub" style={{ marginLeft: 10, fontWeight: 400 }}>
                  金額: {yen((l.qty || 0) * (l.unit_price || 0))}
                </span>
              </strong>
              <button type="button" className="btn-danger" onClick={() => removeLine(i)} disabled={lines.length <= 1}>
                この行を削除
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
              {/* 受注入力画面の並びをベースに、単価のすぐ下(隣)に仕入単価・仕入先を置いて
                  見比べやすくしている(品名は長くなりやすいため2列分広げる)。 */}
              <Field label="品目コード">
                <input value={l.product_code ?? ""} onChange={(e) => updateLine(i, { product_code: e.target.value })} style={inputStyle} />
              </Field>
              <div style={{ gridColumn: "span 2" }}>
                <Field label="品名">
                  <input value={l.product_name} onChange={(e) => updateLine(i, { product_name: e.target.value })} style={inputStyle} />
                </Field>
              </div>
              <Field label="仕様">
                <input value={l.spec ?? ""} onChange={(e) => updateLine(i, { spec: e.target.value })} style={inputStyle} />
              </Field>
              <Field label="数量">
                <input
                  type="number"
                  value={l.qty}
                  onChange={(e) => updateLine(i, { qty: Number(e.target.value) || 0 })}
                  style={inputStyle}
                />
              </Field>
              <Field label="単位">
                <input
                  list="unit-suggestions"
                  value={l.unit}
                  onChange={(e) => updateLine(i, { unit: e.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label="単価">
                <input
                  type="number"
                  value={l.unit_price}
                  onChange={(e) => updateLine(i, { unit_price: Number(e.target.value) || 0 })}
                  style={inputStyle}
                />
              </Field>
              <Field label="仕入単価">
                <input
                  type="number"
                  value={l.cost_price ?? ""}
                  onChange={(e) => updateLine(i, { cost_price: e.target.value === "" ? null : Number(e.target.value) })}
                  style={inputStyle}
                />
              </Field>
              <SearchableCodeField<SupplierOption>
                label="仕入先"
                value={l.supplier_code ?? ""}
                onChangeValue={(v) => updateLine(i, { supplier_code: v })}
                searchUrl="/api/supplier-search"
                renderOption={(s) => <>{s.supplier_code} {s.supplier_name}</>}
                onSelect={(s) => updateLine(i, { supplier_code: s.supplier_code, supplier_name: s.supplier_name })}
              />
              {l.supplier_name && (
                <div className="cell-sub" style={{ gridColumn: "1 / -1", marginTop: -6 }}>
                  選択中の仕入先: {l.supplier_code} {l.supplier_name}
                </div>
              )}
              <Field label="備考">
                <input value={l.note ?? ""} onChange={(e) => updateLine(i, { note: e.target.value })} style={inputStyle} />
              </Field>
              <Field label="発注備考">
                <input value={l.purchase_note ?? ""} onChange={(e) => updateLine(i, { purchase_note: e.target.value })} style={inputStyle} />
              </Field>
              <Field label="手配コード *必須">
                <select value={l.arrange_code} onChange={(e) => updateLine(i, { arrange_code: e.target.value })} style={inputStyle}>
                  <option value="">選択</option>
                  {ARRANGE_CODE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="出荷場所">
                <select value={l.ship_location} onChange={(e) => updateLine(i, { ship_location: e.target.value })} style={inputStyle}>
                  {SHIPPING_LOCATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="出荷日">
                <input type="date" value={l.ship_date} onChange={(e) => updateLine(i, { ship_date: e.target.value })} style={inputStyle} />
              </Field>
              <Field label="着日">
                <input type="date" value={l.arrival_date} onChange={(e) => updateLine(i, { arrival_date: e.target.value })} style={inputStyle} />
              </Field>
              <Field label="着日指定">
                <select value={l.arrival_spec} onChange={(e) => updateLine(i, { arrival_spec: e.target.value })} style={inputStyle}>
                  {ARRIVAL_SPEC_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="時間帯指定">
                <select value={l.time_spec} onChange={(e) => updateLine(i, { time_spec: e.target.value })} style={inputStyle}>
                  {TIME_SPEC_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="配送方法">
                <select value={l.delivery_method} onChange={(e) => updateLine(i, { delivery_method: e.target.value })} style={inputStyle}>
                  {DELIVERY_METHOD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="部門1">
                <input value={l.department1} onChange={(e) => updateLine(i, { department1: e.target.value })} style={inputStyle} />
              </Field>
              <Field label="部門2">
                <input value={l.department2} onChange={(e) => updateLine(i, { department2: e.target.value })} style={inputStyle} />
              </Field>
            </div>
          </div>
        ))}

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
