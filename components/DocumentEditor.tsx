"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { yen } from "@/lib/format";
import { calcTotals, type DocumentLine, type DocumentWithLines, type TaxType } from "@/lib/quoteTypes";
import { BRANCH_NAMES } from "@/lib/branch-names";
import { REP_NAMES } from "@/lib/rep-names";
import type { BranchRepPair } from "@/app/api/quote-customer-branch-reps/route";

type Kind = "quote" | "invoice";

type CustomerOption = { customer_code: string; customer_name: string };
type ProductOption = { product_code: string; product_name: string; spec: string | null; primary_supplier_price: number | null };
type SalesHistoryOption = { product_code: string; product_name: string; unit_price: number | null; qty: number | null; delivery_date: string };

function emptyLine(source: DocumentLine["source"]): DocumentLine {
  return {
    line_no: 0,
    product_code: null,
    product_name: "",
    spec: null,
    qty: 1,
    unit_price: 0,
    amount: 0,
    tax_type: "10",
    note: null,
    source,
  };
}

export default function DocumentEditor({
  kind,
  doc,
  title,
  backHref,
  backLabel,
}: {
  kind: Kind;
  doc: DocumentWithLines | null;
  title: string;
  backHref: string;
  backLabel: string;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const defaultDue = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  })();

  const [customerCode, setCustomerCode] = useState(doc?.customer_code ?? "");
  const [customerName, setCustomerName] = useState(doc?.customer_name ?? "");
  const [customerPostalCode, setCustomerPostalCode] = useState(doc?.customer_postal_code ?? "");
  const [customerAddress, setCustomerAddress] = useState(doc?.customer_address ?? "");
  const [subject, setSubject] = useState(doc?.subject ?? "");
  const [docDate, setDocDate] = useState(doc?.doc_date ?? today);
  const [dueOrValidDate, setDueOrValidDate] = useState(
    doc?.due_or_valid_date ?? (kind === "quote" ? defaultDue : defaultDue)
  );
  const [staffName, setStaffName] = useState(doc?.staff_name ?? "");
  const [note, setNote] = useState(doc?.note ?? "");
  const [lines, setLines] = useState<DocumentLine[]>(doc?.lines ?? []);

  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 得意先検索(拠点・担当で絞り込み)
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerOption[] | null>(null);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [branchRepPairs, setBranchRepPairs] = useState<BranchRepPair[]>([]);

  useEffect(() => {
    fetch("/api/quote-customer-branch-reps")
      .then((r) => r.json())
      .then((json) => setBranchRepPairs(json.pairs ?? []))
      .catch(() => {});
  }, []);

  const branchCodes = useMemo(
    () => Array.from(new Set(branchRepPairs.map((p) => p.branch_code))).sort(),
    [branchRepPairs]
  );
  const repCodesForBranch = useMemo(() => {
    const codes = branchRepPairs
      .filter((p) => (branchFilter ? p.branch_code === branchFilter : true))
      .map((p) => p.rep_code)
      .filter((c): c is string => !!c);
    return Array.from(new Set(codes)).sort();
  }, [branchRepPairs, branchFilter]);

  // 商品検索(明細追加)
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<ProductOption[] | null>(null);
  const [productSearching, setProductSearching] = useState(false);
  const [showProductSearch, setShowProductSearch] = useState(false);

  // 過去売上検索(明細追加)
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyResults, setHistoryResults] = useState<SalesHistoryOption[] | null>(null);
  const [historySearching, setHistorySearching] = useState(false);
  const [showHistorySearch, setShowHistorySearch] = useState(false);

  const totals = useMemo(() => calcTotals(lines), [lines]);

  function onBranchFilterChange(v: string) {
    setBranchFilter(v);
    // 拠点を変えたら、担当が新しい拠点に存在しない値のままにならないようリセットする。
    setRepFilter("");
  }

  async function searchCustomer() {
    if (!customerQuery.trim() && !branchFilter && !repFilter) return;
    setCustomerSearching(true);
    try {
      const params = new URLSearchParams();
      if (customerQuery.trim()) params.set("query", customerQuery.trim());
      if (branchFilter) params.set("branch", branchFilter);
      if (repFilter) params.set("rep", repFilter);
      const res = await fetch(`/api/quote-customer-search?${params.toString()}`);
      const json = await res.json();
      setCustomerResults(json.rows ?? []);
    } finally {
      setCustomerSearching(false);
    }
  }

  function selectCustomer(c: CustomerOption) {
    setCustomerCode(c.customer_code);
    setCustomerName(c.customer_name);
    setCustomerResults(null);
    setCustomerQuery("");
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

  function addLine(line: DocumentLine) {
    setLines((prev) => [...prev, { ...line, line_no: prev.length + 1, amount: line.qty * line.unit_price }]);
  }

  function addFromProduct(p: ProductOption) {
    addLine({
      ...emptyLine("product"),
      product_code: p.product_code,
      product_name: p.product_name,
      spec: p.spec,
      unit_price: 0,
    });
    setShowProductSearch(false);
    setProductQuery("");
    setProductResults(null);
  }

  async function searchHistory() {
    if (!customerCode) {
      setError("先に得意先を選択してください。");
      return;
    }
    setHistorySearching(true);
    try {
      const params = new URLSearchParams({ customer_code: customerCode });
      if (historyQuery.trim()) params.set("query", historyQuery.trim());
      const res = await fetch(`/api/quote-sales-history?${params.toString()}`);
      const json = await res.json();
      setHistoryResults(json.rows ?? []);
    } finally {
      setHistorySearching(false);
    }
  }

  function addFromHistory(h: SalesHistoryOption) {
    addLine({
      ...emptyLine("sales_history"),
      product_code: h.product_code,
      product_name: h.product_name,
      qty: h.qty ?? 1,
      unit_price: h.unit_price ?? 0,
    });
    setShowHistorySearch(false);
    setHistoryQuery("");
    setHistoryResults(null);
  }

  function addManualLine() {
    addLine(emptyLine("manual"));
  }

  function updateLine(index: number, patch: Partial<DocumentLine>) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const next = { ...l, ...patch };
        next.amount = next.qty * next.unit_price;
        return next;
      })
    );
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index).map((l, i) => ({ ...l, line_no: i + 1 })));
  }

  async function save(confirm: boolean) {
    if (!customerName.trim()) {
      setError("得意先名は必須です。");
      return;
    }
    setSaving(true);
    setError(null);
    const header = {
      customer_code: customerCode || null,
      customer_name: customerName.trim(),
      customer_postal_code: customerPostalCode || null,
      customer_address: customerAddress || null,
      subject: subject || null,
      doc_date: docDate,
      due_or_valid_date: dueOrValidDate || null,
      staff_name: staffName || null,
      note: note || null,
    };
    try {
      if (doc === null) {
        const res = await fetch(kind === "quote" ? "/api/quotes" : "/api/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ header, lines }),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        router.push(kind === "quote" ? `/sales-app/quotes/${json.row.id}` : `/sales-app/invoices/${json.row.id}`);
      } else {
        const res = await fetch(kind === "quote" ? `/api/quotes/${doc.id}` : `/api/invoices/${doc.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ header, lines, confirm: kind === "invoice" ? confirm : undefined }),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        if (kind === "quote" && confirm) {
          await fetch(`/api/quotes/${doc.id}/confirm`, { method: "POST" });
        }
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function convertToInvoice() {
    if (!doc) return;
    if (!confirm("この見積の内容で請求書を作成します。よろしいですか?")) return;
    setConverting(true);
    setError(null);
    try {
      const res = await fetch(`/api/quotes/${doc.id}/convert-to-invoice`, { method: "POST" });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      router.push(`/sales-app/invoices/${json.invoice.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConverting(false);
    }
  }

  async function remove() {
    if (!doc) return;
    if (!confirm(`この${kind === "quote" ? "見積" : "請求書"}を削除します。よろしいですか?`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(kind === "quote" ? `/api/quotes/${doc.id}` : `/api/invoices/${doc.id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      router.push(kind === "quote" ? "/sales-app/quotes" : "/sales-app/invoices");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  return (
    <div className="wrap" style={{ maxWidth: 1100 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>{title}</h1>
        </div>
        <Link href={backHref} className="ghost-btn-inline">
          {backLabel}
        </Link>
      </header>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>得意先</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <select value={branchFilter} onChange={(e) => onBranchFilterChange(e.target.value)} style={{ flex: 1 }}>
                <option value="">拠点(すべて)</option>
                {branchCodes.map((code) => (
                  <option key={code} value={code}>
                    {BRANCH_NAMES[code] ?? code}
                  </option>
                ))}
              </select>
              <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} style={{ flex: 1 }}>
                <option value="">担当(すべて)</option>
                {repCodesForBranch.map((code) => (
                  <option key={code} value={code}>
                    {REP_NAMES[code] ?? code}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                placeholder="得意先コード・得意先名で検索(拠点/担当のみでも一覧表示できます)"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchCustomer()}
                style={{ flex: 1, padding: "6px 10px" }}
              />
              <button type="button" onClick={searchCustomer} disabled={customerSearching}>
                検索
              </button>
            </div>
            {customerResults && (
              <div className="card" style={{ marginTop: 4, maxHeight: 180, overflowY: "auto" }}>
                {customerResults.length === 0 && <p className="cell-sub" style={{ padding: 8 }}>見つかりません。</p>}
                {customerResults.map((c) => (
                  <div
                    key={c.customer_code}
                    onClick={() => selectCustomer(c)}
                    style={{ padding: "6px 10px", cursor: "pointer", fontSize: 13 }}
                  >
                    {c.customer_code} {c.customer_name}
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 6, fontWeight: 600 }}>
              {customerName ? `${customerName}${customerCode ? `(${customerCode})` : ""}` : "(未選択)"}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>郵便番号・住所</label>
            <input
              type="text"
              placeholder="郵便番号"
              value={customerPostalCode ?? ""}
              onChange={(e) => setCustomerPostalCode(e.target.value)}
              style={{ width: "100%", padding: "6px 10px", marginBottom: 4 }}
            />
            <input
              type="text"
              placeholder="住所"
              value={customerAddress ?? ""}
              onChange={(e) => setCustomerAddress(e.target.value)}
              style={{ width: "100%", padding: "6px 10px" }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>件名</label>
            <input type="text" value={subject ?? ""} onChange={(e) => setSubject(e.target.value)} style={{ width: "100%", padding: "6px 10px" }} />
          </div>

          <div>
            <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>{kind === "quote" ? "見積日" : "請求日"}</label>
            <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} style={{ width: "100%", padding: "6px 10px" }} />
          </div>

          <div>
            <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>{kind === "quote" ? "有効期限" : "支払期限"}</label>
            <input
              type="date"
              value={dueOrValidDate ?? ""}
              onChange={(e) => setDueOrValidDate(e.target.value)}
              style={{ width: "100%", padding: "6px 10px" }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>担当</label>
            <input type="text" value={staffName ?? ""} onChange={(e) => setStaffName(e.target.value)} style={{ width: "100%", padding: "6px 10px" }} />
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <div className="card-head">
          <h2>明細</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setShowProductSearch((s) => !s)}>
              +商品から追加
            </button>
            <button type="button" onClick={() => setShowHistorySearch((s) => !s)}>
              +過去売上から追加
            </button>
            <button type="button" onClick={addManualLine}>
              +自由入力で追加
            </button>
          </div>
        </div>

        {showProductSearch && (
          <div style={{ padding: "0 20px 12px" }}>
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
                検索
              </button>
            </div>
            {productResults && (
              <div className="card" style={{ marginTop: 4, maxHeight: 220, overflowY: "auto" }}>
                {productResults.length === 0 && <p className="cell-sub" style={{ padding: 8 }}>見つかりません。</p>}
                {productResults.map((p) => (
                  <div
                    key={p.product_code}
                    onClick={() => addFromProduct(p)}
                    style={{ padding: "6px 10px", cursor: "pointer", fontSize: 13 }}
                  >
                    {p.product_code} {p.product_name} {p.spec ? `(${p.spec})` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showHistorySearch && (
          <div style={{ padding: "0 20px 12px" }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                placeholder="品名で絞り込み(空欄で全件、直近順)"
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchHistory()}
                style={{ flex: 1, padding: "6px 10px" }}
              />
              <button type="button" onClick={searchHistory} disabled={historySearching}>
                検索
              </button>
            </div>
            {historyResults && (
              <div className="card" style={{ marginTop: 4, maxHeight: 220, overflowY: "auto" }}>
                {historyResults.length === 0 && <p className="cell-sub" style={{ padding: 8 }}>見つかりません。</p>}
                {historyResults.map((h, i) => (
                  <div
                    key={`${h.product_code}_${i}`}
                    onClick={() => addFromHistory(h)}
                    style={{ padding: "6px 10px", cursor: "pointer", fontSize: 13 }}
                  >
                    {h.product_code} {h.product_name}(前回 {h.delivery_date} 数量{h.qty} 単価{h.unit_price ?? "—"})
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="matwrap">
          <table className="mat">
            <thead>
              <tr>
                <th className="namecol">品番/品名</th>
                <th>数量</th>
                <th>単価</th>
                <th>金額</th>
                <th>税区分</th>
                <th className="namecol">備考</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="namecol">
                    <input
                      type="text"
                      value={l.product_name}
                      onChange={(e) => updateLine(i, { product_name: e.target.value })}
                      style={{ width: "100%", padding: "4px 6px" }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={l.qty}
                      onChange={(e) => updateLine(i, { qty: Number(e.target.value) })}
                      style={{ width: 70, padding: "4px 6px", textAlign: "right" }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={l.unit_price}
                      onChange={(e) => updateLine(i, { unit_price: Number(e.target.value) })}
                      style={{ width: 90, padding: "4px 6px", textAlign: "right" }}
                    />
                  </td>
                  <td>{yen(l.amount)}</td>
                  <td>
                    <select value={l.tax_type} onChange={(e) => updateLine(i, { tax_type: e.target.value as TaxType })}>
                      <option value="10">10%</option>
                      <option value="8">8%(軽減)</option>
                      <option value="0">非課税</option>
                    </select>
                  </td>
                  <td className="namecol">
                    <input
                      type="text"
                      value={l.note ?? ""}
                      onChange={(e) => updateLine(i, { note: e.target.value || null })}
                      style={{ width: "100%", padding: "4px 6px" }}
                    />
                  </td>
                  <td>
                    <button type="button" onClick={() => removeLine(i)}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="cell-sub" style={{ padding: 16 }}>
                    明細がありません。上のボタンから追加してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ padding: "12px 20px", textAlign: "right", fontSize: 13 }}>
          <div>小計: {yen(totals.subtotal)}</div>
          <div>消費税(10%対象分): {yen(totals.tax_10)}</div>
          <div>消費税(8%軽減対象分): {yen(totals.tax_8)}</div>
          <div>非課税: {yen(totals.tax_exempt_amount)}</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>合計: {yen(totals.total)}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>備考</label>
        <textarea value={note ?? ""} onChange={(e) => setNote(e.target.value)} rows={3} style={{ width: "100%", padding: "6px 10px" }} />
      </div>

      {error && <p style={{ color: "var(--direct)" }}>{error}</p>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={() => save(false)} disabled={saving}>
          {saving ? "保存中..." : "下書き保存"}
        </button>
        <button type="button" onClick={() => save(true)} disabled={saving}>
          確定して保存
        </button>
        {doc && (
          <Link href={`/sales-app/${kind === "quote" ? "quotes" : "invoices"}/${doc.id}/print`} target="_blank" className="ghost-btn-inline">
            印刷プレビュー
          </Link>
        )}
        {doc && kind === "quote" && doc.status !== "converted" && (
          <button type="button" onClick={convertToInvoice} disabled={converting}>
            {converting ? "変換中..." : "請求書に変換"}
          </button>
        )}
        {doc && (
          <button type="button" onClick={remove} disabled={deleting} style={{ color: "var(--direct)" }}>
            {deleting ? "削除中..." : "削除"}
          </button>
        )}
      </div>
    </div>
  );
}
