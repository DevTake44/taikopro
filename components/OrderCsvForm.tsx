"use client";
import { Fragment, useState } from "react";
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

// 販売管理の受注入力画面(罫線区切りの表形式)に合わせた、密度の高い入力マス。
// ラベルを小さく左上に出し、入力欄は枠を持たせず背景に馴染ませる(表の1マスに見えるように)。
function Cell({
  label,
  width,
  grow,
  children,
}: {
  label: string;
  width?: number;
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        padding: "2px 6px 3px",
        width,
        flex: grow ? "1 1 160px" : undefined,
        minWidth: 0,
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 10, color: "var(--ink-faint)", lineHeight: 1.3, whiteSpace: "nowrap" }}>{label}</div>
      {children}
    </div>
  );
}

const denseInput: React.CSSProperties = {
  width: "100%",
  border: "none",
  outline: "none",
  padding: "1px 0",
  fontSize: 12,
  background: "transparent",
};

// コードを直接入力してもよいし、名前で検索して候補から選んでもよい共通入力部品。
function SearchableCodeField<T>({
  label,
  width,
  grow,
  value,
  onChangeValue,
  searchUrl,
  renderOption,
  onSelect,
}: {
  label: string;
  width?: number;
  grow?: boolean;
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
    <div style={{ position: "relative" }}>
      <Cell label={label} width={width} grow={grow}>
        <div style={{ display: "flex", gap: 4 }}>
          <input value={value} onChange={(e) => onChangeValue(e.target.value)} style={denseInput} placeholder="コード" />
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
            style={{ ...denseInput, color: "var(--ink-faint)", borderLeft: "1px solid var(--line)", paddingLeft: 4 }}
          />
          <button type="button" className="btn-sm" onClick={runSearch} disabled={searching} style={{ padding: "0 6px", fontSize: 11 }}>
            検索
          </button>
        </div>
      </Cell>
      {results && (
        <div className="card" style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, minWidth: 260, maxHeight: 180, overflowY: "auto" }}>
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
    </div>
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
  const selStyle: React.CSSProperties = { ...denseInput, padding: 0 };
  const rowStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", marginTop: -1 };

  return (
    <div style={{ maxWidth: 1500, margin: "0 auto", padding: "20px 16px", fontSize: 13 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>{title}</h1>
        <Link href={backHref} className="ghost-btn-inline">
          {backLabel}
        </Link>
      </header>

      {/* 受注入力画面(販売管理)に合わせた、罫線区切りの密な表形式。 */}
      <div style={{ marginBottom: 14, border: "1px solid var(--line)", borderBottom: "none" }}>
        <div style={rowStyle}>
          <SearchableCodeField<CustomerOption>
            label="得意先コード *必須"
            width={340}
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
          <Cell label="納入先コード" width={100}>
            <input value={deliveryCode} onChange={(e) => setDeliveryCode(e.target.value)} style={denseInput} />
          </Cell>
          <Cell label="納入先TEL" width={140}>
            <input value={deliveryTel} onChange={(e) => setDeliveryTel(e.target.value)} style={denseInput} />
          </Cell>
          <Cell label="納入先郵便番号" width={110}>
            <input value={deliveryPostalCode} onChange={(e) => setDeliveryPostalCode(e.target.value)} style={denseInput} />
          </Cell>
          <Cell label="客先注番 *必須" grow>
            <input value={customerPoNo} onChange={(e) => setCustomerPoNo(e.target.value)} style={denseInput} />
          </Cell>
        </div>

        <div style={rowStyle}>
          <Cell label="納入先名称1" width={230}>
            <input value={deliveryName1} onChange={(e) => setDeliveryName1(e.target.value)} style={denseInput} />
          </Cell>
          <Cell label="納入先名称2" width={230}>
            <input value={deliveryName2} onChange={(e) => setDeliveryName2(e.target.value)} style={denseInput} />
          </Cell>
          <Cell label="納入先担当" width={150}>
            <input value={deliveryContact} onChange={(e) => setDeliveryContact(e.target.value)} style={denseInput} />
          </Cell>
          <Cell label="客先担当" width={120}>
            <input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} style={denseInput} />
          </Cell>
          <Cell label="希望納期" width={150}>
            <input type="date" value={desiredDate} onChange={(e) => setDesiredDate(e.target.value)} style={denseInput} />
          </Cell>
          <Cell label="入荷場所" width={100}>
            <select value={receiveLocation} onChange={(e) => setReceiveLocation(e.target.value)} style={selStyle}>
              {SHIPPING_LOCATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Cell>
        </div>

        <div style={rowStyle}>
          <Cell label="納入先住所1" width={230}>
            <input value={deliveryAddress1} onChange={(e) => setDeliveryAddress1(e.target.value)} style={denseInput} />
          </Cell>
          <Cell label="納入先住所2" width={230}>
            <input value={deliveryAddress2} onChange={(e) => setDeliveryAddress2(e.target.value)} style={denseInput} />
          </Cell>
          <Cell label="件名" width={200}>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} style={denseInput} />
          </Cell>
          <Cell label="件名金額" width={110}>
            <input type="number" value={subjectAmount} onChange={(e) => setSubjectAmount(e.target.value)} style={denseInput} />
          </Cell>
          <Cell label="伝票備考" grow>
            <input value={note} onChange={(e) => setNote(e.target.value)} style={denseInput} />
          </Cell>
          <Cell label="社内連絡" grow>
            <input value={internalNote} onChange={(e) => setInternalNote(e.target.value)} style={denseInput} />
          </Cell>
        </div>
      </div>

      <div style={{ marginBottom: 14, border: "1px solid var(--line)", borderBottom: "none" }}>
        <div style={{ ...rowStyle, background: "#f6f8fb" }}>
          <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--ink-faint)" }}>
            出荷日・着日・出荷場所・配送方法・着日指定・時間帯指定は明細行(商品)ごとに違う場合があるため、下の明細表で行ごとに設定します。ここでまとめて初期値を設定し「全行に適用」で一括反映できます。
          </div>
        </div>
        <div style={rowStyle}>
          <Cell label="出荷場所" width={100}>
            <select value={defaults.ship_location} onChange={(e) => setDefaults((d) => ({ ...d, ship_location: e.target.value }))} style={selStyle}>
              {SHIPPING_LOCATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Cell>
          <Cell label="出荷日" width={140}>
            <input type="date" value={defaults.ship_date} onChange={(e) => setDefaults((d) => ({ ...d, ship_date: e.target.value }))} style={denseInput} />
          </Cell>
          <Cell label="着日" width={140}>
            <input type="date" value={defaults.arrival_date} onChange={(e) => setDefaults((d) => ({ ...d, arrival_date: e.target.value }))} style={denseInput} />
          </Cell>
          <Cell label="着日指定" width={90}>
            <select value={defaults.arrival_spec} onChange={(e) => setDefaults((d) => ({ ...d, arrival_spec: e.target.value }))} style={selStyle}>
              {ARRIVAL_SPEC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Cell>
          <Cell label="時間帯指定" width={90}>
            <select value={defaults.time_spec} onChange={(e) => setDefaults((d) => ({ ...d, time_spec: e.target.value }))} style={selStyle}>
              {TIME_SPEC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Cell>
          <Cell label="配送方法" width={110}>
            <select value={defaults.delivery_method} onChange={(e) => setDefaults((d) => ({ ...d, delivery_method: e.target.value }))} style={selStyle}>
              {DELIVERY_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Cell>
          <div style={{ border: "1px solid var(--line)", display: "flex", alignItems: "center", padding: "0 10px" }}>
            <button type="button" className="btn-sm" onClick={applyDefaultsToAllLines}>全行に適用</button>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div className="cell-sub">明細(行ごとに売上側・仕入側の2段で入力。単位・手配コードは必須)</div>
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

      {/* 実際の受注入力画面のヘッダー(行No./取引/区分/コード/品名/仕様/倉庫/バラ数/単位/単価/
          備考/手配コード/出荷場所/出荷日 ・ 2段目=仕入先/申請理由/申請番号/上代/入数/在庫/
          総数量/原価/発注備考/着日/着日指定/時間帯指定)と列位置を合わせている。
          倉庫・バラ数(総数量)・在庫・上代・入数・申請理由・申請番号は参照しない項目のため
          省略し、区分+コードの位置に品目コード、その下に仕入先を置く。配送方法だけは
          実画面の12列に無い項目(受注CSVの新レイアウトでのみ必須)のため、全行共通の
          列として右端に別途追加している。 */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 16 }}>
        <thead>
          <tr style={{ background: "#f6f8fb" }}>
            <th style={th} rowSpan={2}>No.</th>
            <th style={th}>品目コード</th>
            <th style={th}>品名</th>
            <th style={th}>仕様</th>
            <th style={th}>数量</th>
            <th style={th}>単位</th>
            <th style={th}>単価</th>
            <th style={th}>備考</th>
            <th style={th}>手配コード</th>
            <th style={th}>出荷場所</th>
            <th style={th}>出荷日</th>
            <th style={th} rowSpan={2}>配送方法</th>
            <th style={th} rowSpan={2}></th>
          </tr>
          <tr style={{ background: "#f6f8fb" }}>
            <th style={th} colSpan={2}>仕入先</th>
            <th style={th}>部門1/部門2</th>
            <th style={thSub}></th>
            <th style={thSub}></th>
            <th style={th}>仕入単価(原価)</th>
            <th style={th}>発注備考</th>
            <th style={th}>着日</th>
            <th style={th}>着日指定</th>
            <th style={th}>時間帯指定</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <Fragment key={i}>
              <tr>
                <td style={td} rowSpan={2}>{i + 1}</td>
                <td style={{ ...td, width: 90 }}>
                  <input value={l.product_code ?? ""} onChange={(e) => updateLine(i, { product_code: e.target.value })} style={denseInput} />
                </td>
                <td style={{ ...td, minWidth: 280 }}>
                  <input value={l.product_name} onChange={(e) => updateLine(i, { product_name: e.target.value })} style={denseInput} />
                </td>
                <td style={{ ...td, width: 110 }}>
                  <input value={l.spec ?? ""} onChange={(e) => updateLine(i, { spec: e.target.value })} style={denseInput} />
                </td>
                <td style={{ ...td, width: 60 }}>
                  <input type="number" value={l.qty} onChange={(e) => updateLine(i, { qty: Number(e.target.value) || 0 })} style={denseInput} />
                </td>
                <td style={{ ...td, width: 60 }}>
                  <input list="unit-suggestions" value={l.unit} onChange={(e) => updateLine(i, { unit: e.target.value })} style={denseInput} />
                </td>
                <td style={{ ...td, width: 80 }}>
                  <input type="number" value={l.unit_price} onChange={(e) => updateLine(i, { unit_price: Number(e.target.value) || 0 })} style={denseInput} />
                </td>
                <td style={{ ...td, width: 100 }}>
                  <input value={l.note ?? ""} onChange={(e) => updateLine(i, { note: e.target.value })} style={denseInput} />
                </td>
                <td style={{ ...td, width: 90 }}>
                  <select value={l.arrange_code} onChange={(e) => updateLine(i, { arrange_code: e.target.value })} style={selStyle}>
                    <option value="">選択</option>
                    {ARRANGE_CODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
                <td style={{ ...td, width: 70 }}>
                  <select value={l.ship_location} onChange={(e) => updateLine(i, { ship_location: e.target.value })} style={selStyle}>
                    {SHIPPING_LOCATION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
                <td style={{ ...td, width: 130 }}>
                  <input type="date" value={l.ship_date} onChange={(e) => updateLine(i, { ship_date: e.target.value })} style={denseInput} />
                </td>
                <td style={{ ...td, width: 90 }} rowSpan={2}>
                  <select value={l.delivery_method} onChange={(e) => updateLine(i, { delivery_method: e.target.value })} style={selStyle}>
                    {DELIVERY_METHOD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
                <td style={td} rowSpan={2}>
                  <button type="button" className="btn-danger" onClick={() => removeLine(i)} disabled={lines.length <= 1} style={{ fontSize: 11, padding: "2px 6px" }}>
                    削除
                  </button>
                </td>
              </tr>
              <tr style={{ background: "#fafbfd" }}>
                <td style={{ ...td, position: "relative" }} colSpan={2}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input value={l.supplier_code ?? ""} onChange={(e) => updateLine(i, { supplier_code: e.target.value })} style={{ ...denseInput, width: 70 }} placeholder="コード" />
                    <SupplierInlineSearch
                      onSelect={(s) => updateLine(i, { supplier_code: s.supplier_code, supplier_name: s.supplier_name })}
                    />
                    {l.supplier_name && <span className="cell-sub" style={{ fontSize: 11 }}>{l.supplier_name}</span>}
                  </div>
                </td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input value={l.department1} onChange={(e) => updateLine(i, { department1: e.target.value })} style={{ ...denseInput, width: "50%" }} placeholder="部門1" />
                    <input value={l.department2} onChange={(e) => updateLine(i, { department2: e.target.value })} style={{ ...denseInput, width: "50%" }} placeholder="部門2" />
                  </div>
                </td>
                <td style={td}></td>
                <td style={td}></td>
                <td style={td}>
                  <input
                    type="number"
                    value={l.cost_price ?? ""}
                    onChange={(e) => updateLine(i, { cost_price: e.target.value === "" ? null : Number(e.target.value) })}
                    style={denseInput}
                  />
                </td>
                <td style={td}>
                  <input value={l.purchase_note ?? ""} onChange={(e) => updateLine(i, { purchase_note: e.target.value })} style={denseInput} />
                </td>
                <td style={td}>
                  <input type="date" value={l.arrival_date} onChange={(e) => updateLine(i, { arrival_date: e.target.value })} style={denseInput} />
                </td>
                <td style={td}>
                  <select value={l.arrival_spec} onChange={(e) => updateLine(i, { arrival_spec: e.target.value })} style={selStyle}>
                    {ARRIVAL_SPEC_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
                <td style={td}>
                  <select value={l.time_spec} onChange={(e) => updateLine(i, { time_spec: e.target.value })} style={selStyle}>
                    {TIME_SPEC_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>

      <datalist id="unit-suggestions">
        {UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <button type="button" className="btn-primary" onClick={handleDownload} disabled={downloading}>
        {downloading ? "作成中..." : "CSVダウンロード"}
      </button>
    </div>
  );
}

// 明細テーブルの仕入先セルは幅が狭いため、専用の小さな検索ポップオーバーにする。
function SupplierInlineSearch({ onSelect }: { onSelect: (s: SupplierOption) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SupplierOption[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/supplier-search?query=${encodeURIComponent(query.trim())}`);
      const json = await res.json();
      setResults(json.rows ?? []);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button type="button" className="btn-sm" onClick={() => setOpen((o) => !o)} style={{ fontSize: 11, padding: "0 4px" }}>
        検索
      </button>
      {open && (
        <div className="card" style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, width: 260, padding: 6 }}>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="仕入先名で検索"
              style={{ flex: 1, padding: "2px 6px", fontSize: 12 }}
              autoFocus
            />
            <button type="button" className="btn-sm" onClick={runSearch} disabled={searching}>検索</button>
          </div>
          {results && (
            <div style={{ maxHeight: 160, overflowY: "auto", marginTop: 4 }}>
              {results.length === 0 && <p className="cell-sub" style={{ padding: 6 }}>見つかりません。</p>}
              {results.map((s) => (
                <div
                  key={s.supplier_code}
                  className="search-item"
                  onClick={() => {
                    onSelect(s);
                    setOpen(false);
                    setQuery("");
                    setResults(null);
                  }}
                >
                  {s.supplier_code} {s.supplier_name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { border: "1px solid var(--line)", padding: "3px 6px", fontSize: 11, color: "var(--ink-faint)", fontWeight: 500, whiteSpace: "nowrap" };
const thSub: React.CSSProperties = { border: "1px solid var(--line)" };
const td: React.CSSProperties = { border: "1px solid var(--line)", padding: "2px 4px" };
