"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { yen } from "@/lib/format";
import { calcTotals, TAX_ROUNDING_LABEL, type DocumentLine, type DocumentWithLines, type TaxRounding, type TaxType } from "@/lib/quoteTypes";
import { BRANCH_NAMES, ISSUING_BRANCH_CODES } from "@/lib/branch-names";
import { REP_NAMES } from "@/lib/rep-names";
import type { BranchRepPair } from "@/app/api/quote-customer-branch-reps/route";

type Kind = "quote" | "invoice";

type CustomerOption = {
  customer_code: string;
  customer_name: string;
  postal_code: string | null;
  address: string | null;
};
type ProductOption = { product_code: string; product_name: string; spec: string | null; primary_supplier_price: number | null };
type SalesHistoryOption = {
  product_code: string;
  product_name: string;
  unit_price: number | null;
  cost_price: number | null;
  cost_supplier_code: string | null;
  cost_supplier_name: string | null;
  customer_name: string | null;
  qty: number | null;
  delivery_date: string;
};

type OrderLineOption = {
  product_code: string | null;
  product_name: string;
  qty: number;
  unit_price: number;
  cost_price: number | null;
  supplier_code: string | null;
  supplier_name: string | null;
  customer_name: string | null;
  customer_code: string | null;
  delivery_date: string | null;
};

type ReferenceOption = { customer_code: string; customer_name: string; unit_price: number; delivery_date: string };
type SupplierOption = { supplier_code: string; supplier_name: string };

// 仕入値・利益率・参照売価は見積データとしては保存しない(単価を決めるための参考情報)。
// 仕入先(supplier_code/supplier_name)は、将来の販売管理・受注CSV取込との連動のため
// DocumentLineの一部として保存する(品番・品名と同じ扱い)。
// 保存時は EditableLine から DocumentLine の項目だけを取り出して送る。
type EditableLine = DocumentLine & {
  cost_price?: number | null;
  margin_pct?: number | null;
  // 参照売価: 販売実績のある得意先の中から選べるようにする(先頭=直近)。
  referenceOptions?: ReferenceOption[];
  selectedReferenceCode?: string | null;
};

function emptyLine(source: DocumentLine["source"]): EditableLine {
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
    supplier_code: null,
    supplier_name: null,
    department: null,
    transaction_date: null,
    cost_price: null,
    margin_pct: null,
    referenceOptions: [],
    selectedReferenceCode: null,
  };
}

function toSavedLines(lines: EditableLine[]): DocumentLine[] {
  return lines.map((l) => ({
    id: l.id,
    line_no: l.line_no,
    product_code: l.product_code,
    product_name: l.product_name,
    spec: l.spec,
    qty: l.qty,
    unit_price: l.unit_price,
    amount: l.amount,
    tax_type: l.tax_type,
    note: l.note,
    source: l.source,
    supplier_code: l.supplier_code,
    supplier_name: l.supplier_name,
    department: l.department,
    transaction_date: l.transaction_date,
  }));
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
  // 見積の有効期限は「見積日からNヶ月後」で素早く設定できるようにする(標準3ヶ月)。
  // 請求書の支払期限は、案件ごとに決まる(取引先の支払いサイト次第)ため標準はブランクにする。
  const addMonths = (dateStr: string, months: number) => {
    const d = new Date(dateStr);
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  };
  const defaultDue = kind === "quote" ? addMonths(today, 3) : "";

  const [branchCode, setBranchCode] = useState(doc?.branch_code ?? "");
  const [customerCode, setCustomerCode] = useState(doc?.customer_code ?? "");
  const [customerName, setCustomerName] = useState(doc?.customer_name ?? "");
  const [customerPostalCode, setCustomerPostalCode] = useState(doc?.customer_postal_code ?? "");
  const [customerAddress, setCustomerAddress] = useState(doc?.customer_address ?? "");
  const [subject, setSubject] = useState(doc?.subject ?? "");
  const [docDate, setDocDate] = useState(doc?.doc_date ?? today);
  const [dueOrValidDate, setDueOrValidDate] = useState(doc?.due_or_valid_date ?? defaultDue);
  const [staffName, setStaffName] = useState(doc?.staff_name ?? "");
  const [note, setNote] = useState(doc?.note ?? "");
  const [taxRounding, setTaxRounding] = useState<TaxRounding>(doc?.tax_rounding ?? "floor");
  const [lines, setLines] = useState<EditableLine[]>(doc?.lines ?? []);

  // 単価を決めるための参考情報(仕入値・仕入先・利益率・参照売価、保存されない)は、
  // 常時表示すると列が多すぎて商品名・備考等が窮屈になるため、既定では折りたたんでおく。
  const [showRefInfo, setShowRefInfo] = useState(false);

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

  // 拠点の選択肢は、見積・請求書を発行する17拠点(ISSUING_BRANCH_CODES)に固定する。
  // 得意先マスタの実績ベース(branchRepPairs)にすると、経理・在庫・物流など発行主体に
  // ならない拠点まで混ざって選びにくくなるため使わない。
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
  // 見積の得意先のみ検索するか、諸口コード等で見つからない場合に他の得意先も含めて
  // 検索するか。
  const [historyScope, setHistoryScope] = useState<"customer" | "all">("customer");

  // 受注番号から一括追加(明細追加)。1件ずつ探す「過去売上から追加」と違い、
  // 同じ受注の明細を丸ごと転記したい場合に使う。
  const [orderNoQuery, setOrderNoQuery] = useState("");
  const [orderLineResults, setOrderLineResults] = useState<OrderLineOption[] | null>(null);
  const [orderLineSearching, setOrderLineSearching] = useState(false);
  const [showOrderLineSearch, setShowOrderLineSearch] = useState(false);

  // 仕入先検索(明細行ごと。クリックした行だけ検索ボックスに切り替える方式)
  const [editingSupplierIndex, setEditingSupplierIndex] = useState<number | null>(null);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierResults, setSupplierResults] = useState<SupplierOption[] | null>(null);
  const [supplierSearching, setSupplierSearching] = useState(false);
  const supplierInputRef = useRef<HTMLInputElement>(null);
  // 検索欄の位置(画面基準)。明細テーブルはoverflow-x:autoで横スクロールする関係上、
  // CSSの仕様で縦方向もクリップされてしまい、テーブル内に通常の重ね表示(absolute)で
  // 候補一覧を出すと見えなくなることがある。position:fixedで画面に対して直接重ねることで
  // これを避ける。
  const [supplierDropdownPos, setSupplierDropdownPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (editingSupplierIndex === null || !supplierInputRef.current) {
      setSupplierDropdownPos(null);
      return;
    }
    const rect = supplierInputRef.current.getBoundingClientRect();
    setSupplierDropdownPos({ top: rect.bottom, left: rect.left });
  }, [editingSupplierIndex]);

  const totals = useMemo(() => calcTotals(lines, taxRounding), [lines, taxRounding]);

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

  // 得意先名の最終行の末尾を「御中」または「様」に付け替える(既に付いている
  // 御中・様は置き換える)。得意先名は住所と同様2行入力に対応しており、
  // 「○○部 ○○課\n○○様」のように最終行が個人名の場合にも使える。
  function applyHonorific(honorific: "御中" | "様") {
    setCustomerName((prev) => {
      const lines = prev.split("\n");
      const lastIndex = lines.length - 1;
      const stripped = (lines[lastIndex] ?? "").replace(/\s*(御中|様)\s*$/, "").trimEnd();
      lines[lastIndex] = stripped ? `${stripped} ${honorific}` : honorific;
      return lines.join("\n");
    });
  }

  function selectCustomer(c: CustomerOption) {
    setCustomerCode(c.customer_code);
    // 書類に印字される宛先名として、まず「会社名 御中」を初期値にする(そのまま手入力で
    // 「○○部 ○○課 ○○様」のように書き換えられる。その場合は「御中」を「様」に
    // 置き換える想定)。
    setCustomerName(`${c.customer_name} 御中`);
    // 得意先マスタに住所があれば自動入力する(無ければ手入力のまま)。
    if (c.postal_code) setCustomerPostalCode(c.postal_code);
    if (c.address) setCustomerAddress(c.address);
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

  function addLine(line: EditableLine) {
    const index = lines.length;
    setLines((prev) => [...prev, { ...line, line_no: prev.length + 1, amount: line.qty * line.unit_price }]);
    return index;
  }

  // 品番がセットされた明細行に、直近の仕入値・仕入先と他得意先への参照売価を取得して埋める。
  // 見積は作成中の画面であり、単価を決める材料として常に見えている必要があるため、
  // 品番が追加・変更されるたびに呼ぶ。
  // applyCost=falseの場合は参照売価のみ更新する(過去売上から追加した行は、その行自体に
  // 記録済みの仕入値・仕入先(assumed_cost/supplier_code)の方が、品番だけを頼りにした
  // purchases検索より正確なため上書きしない)。
  async function refreshLineMeta(index: number, productCode: string, applyCost = true) {
    if (!productCode.trim()) return;
    try {
      const params = new URLSearchParams({ product_code: productCode.trim() });
      if (customerCode) params.set("exclude_customer_code", customerCode);
      const res = await fetch(`/api/quote-product-cost?${params.toString()}`);
      const json = await res.json();
      const options: ReferenceOption[] = json.reference_options ?? [];
      setLines((prev) =>
        prev.map((l, i) => {
          if (i !== index) return l;
          const costPrice: number | null = applyCost ? json.cost_price ?? null : l.cost_price ?? null;
          const margin = computeMarginPct(costPrice, l.unit_price);
          return {
            ...l,
            ...(applyCost
              ? { cost_price: costPrice, supplier_code: json.cost_supplier_code ?? null, supplier_name: json.cost_supplier_name ?? null }
              : {}),
            ...(margin !== null ? { margin_pct: margin } : {}),
            referenceOptions: options,
            selectedReferenceCode: options[0]?.customer_code ?? null,
          };
        })
      );
    } catch {
      // 参考情報の取得失敗は無視する(単価入力自体は手動でできるため)。
    }
  }

  function selectReferenceOption(index: number, customerCode: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, selectedReferenceCode: customerCode } : l)));
  }

  // 選んだ参照売価をこの行の単価に反映する(利益率も連動して再計算)。
  function applyReferencePrice(index: number) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const option = l.referenceOptions?.find((o) => o.customer_code === l.selectedReferenceCode);
        if (!option) return l;
        const next: EditableLine = { ...l, unit_price: option.unit_price };
        const margin = computeMarginPct(next.cost_price, next.unit_price);
        if (margin !== null) next.margin_pct = margin;
        next.amount = next.qty * next.unit_price;
        return next;
      })
    );
  }

  function startEditSupplier(index: number, currentName: string | null) {
    setEditingSupplierIndex(index);
    setSupplierQuery(currentName ?? "");
    setSupplierResults(null);
  }

  async function searchSupplier() {
    if (!supplierQuery.trim()) {
      setSupplierResults([]);
      return;
    }
    setSupplierSearching(true);
    try {
      const res = await fetch(`/api/supplier-search?query=${encodeURIComponent(supplierQuery.trim())}`);
      const json = await res.json();
      setSupplierResults(json.rows ?? []);
    } finally {
      setSupplierSearching(false);
    }
  }

  function selectSupplier(index: number, s: SupplierOption) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, supplier_code: s.supplier_code, supplier_name: s.supplier_name } : l)));
    setEditingSupplierIndex(null);
    setSupplierQuery("");
    setSupplierResults(null);
  }

  function clearSupplier(index: number) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, supplier_code: null, supplier_name: null } : l)));
  }

  function addFromProduct(p: ProductOption) {
    const index = addLine({
      ...emptyLine("product"),
      product_code: p.product_code,
      product_name: p.product_name,
      spec: p.spec,
      unit_price: 0,
    });
    refreshLineMeta(index, p.product_code);
    setShowProductSearch(false);
    setProductQuery("");
    setProductResults(null);
  }

  async function searchHistory() {
    if (!customerCode) {
      setError("先に得意先を選択してください。");
      return;
    }
    if (historyScope === "all" && !historyQuery.trim()) {
      setError("他の得意先も含めて検索する場合は、検索キーワードを入力してください。");
      return;
    }
    setError(null);
    setHistorySearching(true);
    try {
      const params = new URLSearchParams();
      if (historyScope === "customer") params.set("customer_code", customerCode);
      if (historyQuery.trim()) params.set("query", historyQuery.trim());
      const res = await fetch(`/api/quote-sales-history?${params.toString()}`);
      const json = await res.json();
      setHistoryResults(json.rows ?? []);
    } finally {
      setHistorySearching(false);
    }
  }

  function addFromHistory(h: SalesHistoryOption) {
    const unitPrice = h.unit_price ?? 0;
    const index = addLine({
      ...emptyLine("sales_history"),
      product_code: h.product_code,
      product_name: h.product_name,
      qty: h.qty ?? 1,
      unit_price: unitPrice,
      cost_price: h.cost_price,
      supplier_code: h.cost_supplier_code,
      supplier_name: h.cost_supplier_name,
      margin_pct: computeMarginPct(h.cost_price, unitPrice),
    });
    // 仕入値・仕入先はこの行自体の実績値を使うので上書きしない。参照売価(他得意先)だけ取得する。
    if (h.product_code) refreshLineMeta(index, h.product_code, false);
    setShowHistorySearch(false);
    setHistoryQuery("");
    setHistoryResults(null);
  }

  async function searchOrderLines() {
    if (!orderNoQuery.trim()) return;
    setError(null);
    setOrderLineSearching(true);
    try {
      const res = await fetch(`/api/quote-order-lines?order_no=${encodeURIComponent(orderNoQuery.trim())}`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        setOrderLineResults(null);
        return;
      }
      setOrderLineResults(json.rows ?? []);
    } finally {
      setOrderLineSearching(false);
    }
  }

  // 受注番号で見つかった明細を全行まとめて追加する。
  function addAllOrderLines() {
    if (!orderLineResults || orderLineResults.length === 0) return;
    for (const r of orderLineResults) {
      addLine({
        ...emptyLine("sales_history"),
        product_code: r.product_code,
        product_name: r.product_name,
        qty: r.qty,
        unit_price: r.unit_price,
        cost_price: r.cost_price,
        supplier_code: r.supplier_code,
        supplier_name: r.supplier_name,
        margin_pct: computeMarginPct(r.cost_price, r.unit_price),
      });
    }
    setShowOrderLineSearch(false);
    setOrderNoQuery("");
    setOrderLineResults(null);
  }

  function addManualLine() {
    // 自由入力は諸口(通常税率)扱いが多いため、商品コードは77700を初期値にしておく
    // (仕入実績が無い前提のため、仕入値・仕入先は手入力で埋める)。
    addLine({ ...emptyLine("manual"), product_code: "77700" });
  }

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const next = { ...l, ...patch };
        next.amount = next.qty * next.unit_price;
        return next;
      })
    );
  }

  // 利益率 = (売値 − 仕入値) ÷ 売値 の考え方(他ページと同じ「利益 ÷ 売上」)。
  function computeMarginPct(costPrice: number | null | undefined, unitPrice: number): number | null {
    if (costPrice == null || unitPrice <= 0) return null;
    return Math.round(((unitPrice - costPrice) / unitPrice) * 1000) / 10;
  }

  // 利益率を入力したら、仕入値から売値(単価)を自動計算する。
  // 売値 = 仕入値 ÷ (1 − 利益率/100)。
  function updateMargin(index: number, marginStr: string) {
    const margin = marginStr === "" ? null : Number(marginStr);
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const next: EditableLine = { ...l, margin_pct: Number.isNaN(margin) ? null : margin };
        if (margin !== null && !Number.isNaN(margin) && margin < 100 && l.cost_price != null) {
          next.unit_price = Math.round(l.cost_price / (1 - margin / 100));
        }
        next.amount = next.qty * next.unit_price;
        return next;
      })
    );
  }

  // 単価を直接入力したら、仕入値から利益率を逆算して表示する(利益率⇄単価の双方向計算)。
  function updateUnitPrice(index: number, priceStr: string) {
    const price = Number(priceStr);
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const next: EditableLine = { ...l, unit_price: Number.isNaN(price) ? 0 : price };
        const margin = computeMarginPct(next.cost_price, next.unit_price);
        if (margin !== null) next.margin_pct = margin;
        next.amount = next.qty * next.unit_price;
        return next;
      })
    );
  }

  // 納品日・取引年月日は明細行ごとに持つが(1枚の請求書に複数回の納品分をまとめる
  // ことがあるため)、実際は全行同じ日付になることが多いので、一括入力の補助を用意する。
  const [bulkTransactionDate, setBulkTransactionDate] = useState("");
  function applyBulkTransactionDate() {
    if (!bulkTransactionDate) return;
    setLines((prev) => prev.map((l) => ({ ...l, transaction_date: bulkTransactionDate })));
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index).map((l, i) => ({ ...l, line_no: i + 1 })));
  }

  // 行を複製してすぐ下に挿入する(似た内容の行を素早く増やせるように)。
  // idは外して新規行として扱う(保存時に新しい行として挿入される)。
  function duplicateLine(index: number) {
    setLines((prev) => {
      const copy: EditableLine = { ...prev[index], id: undefined };
      const next = [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)];
      return next.map((l, i) => ({ ...l, line_no: i + 1 }));
    });
  }

  // 空の行をすぐ下に挿入する(末尾への追加だけでなく、任意の位置に行を増やせるように)。
  function insertLineAfter(index: number) {
    setLines((prev) => {
      const blank: EditableLine = { ...emptyLine("manual"), product_code: "77700" };
      const next = [...prev.slice(0, index + 1), blank, ...prev.slice(index + 1)];
      return next.map((l, i) => ({ ...l, line_no: i + 1 }));
    });
  }

  async function save(confirm: boolean) {
    if (!branchCode) {
      setError("発行拠点は必須です。");
      return;
    }
    if (!customerName.trim()) {
      setError("得意先名は必須です。");
      return;
    }
    setSaving(true);
    setError(null);
    const savedLines = toSavedLines(lines);
    const header = {
      branch_code: branchCode,
      customer_code: customerCode || null,
      customer_name: customerName.trim(),
      customer_postal_code: customerPostalCode || null,
      customer_address: customerAddress || null,
      subject: subject || null,
      doc_date: docDate,
      due_or_valid_date: dueOrValidDate || null,
      staff_name: staffName || null,
      note: note || null,
      tax_rounding: taxRounding,
    };
    try {
      if (doc === null) {
        const res = await fetch(kind === "quote" ? "/api/quotes" : "/api/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ header, lines: savedLines }),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        router.push(kind === "quote" ? `/sales-app/quotes/${json.row.id}` : `/sales-app/invoices/${json.row.id}`);
      } else {
        const res = await fetch(kind === "quote" ? `/api/quotes/${doc.id}` : `/api/invoices/${doc.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ header, lines: savedLines, confirm: kind === "invoice" ? confirm : undefined }),
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
    <div className="wrap" style={{ maxWidth: 1800 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>{title}</h1>
        </div>
        <Link href={backHref} className="ghost-btn-inline">
          {backLabel}
        </Link>
      </header>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        {/* 発行拠点・件名・日付・担当は1行入力で済み高さが揃うため、左側に縦積みでまとめる。
            得意先・住所は検索結果や宛先名のテキストエリアで縦に伸びやすいため、右側にまとめて
            左の縦積みブロックとおおよそ高さが揃うようにする。 */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 280px) 1fr", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label className="req" style={{ fontSize: 12, color: "var(--ink-faint)" }}>発行拠点</label>
              <select
                value={branchCode}
                onChange={(e) => setBranchCode(e.target.value)}
                style={{ width: "100%", padding: "6px 10px" }}
              >
                <option value="" disabled>
                  選択してください
                </option>
                {ISSUING_BRANCH_CODES.map((code) => (
                  <option key={code} value={code}>
                    {BRANCH_NAMES[code] ?? code}
                  </option>
                ))}
              </select>
              <div className="cell-sub" style={{ marginTop: 2 }}>
                書類に載る自社の住所・連絡先は、ここで選んだ拠点のものが使われます。
              </div>
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
              {kind === "quote" && (
                <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                  {[1, 2, 3, 4, 5, 6].map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`btn-sm${dueOrValidDate === addMonths(docDate, m) ? " btn-primary" : ""}`}
                      onClick={() => setDueOrValidDate(addMonths(docDate, m))}
                      title={`見積日(${docDate})から${m}ヶ月後`}
                    >
                      {m}ヶ月
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>担当</label>
              <input type="text" value={staffName ?? ""} onChange={(e) => setStaffName(e.target.value)} style={{ width: "100%", padding: "6px 10px" }} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
            <div>
              <label className="req" style={{ fontSize: 12, color: "var(--ink-faint)" }}>得意先</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <select value={branchFilter} onChange={(e) => onBranchFilterChange(e.target.value)} style={{ flex: 1 }}>
                  <option value="">拠点(すべて)</option>
                  {ISSUING_BRANCH_CODES.map((code) => (
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
                  {customerSearching ? "検索中…" : "検索"}
                </button>
              </div>
              {customerResults && (
                <div className="card" style={{ marginTop: 4, maxHeight: 180, overflowY: "auto" }}>
                  {customerResults.length === 0 && <p className="cell-sub" style={{ padding: 8 }}>見つかりません。</p>}
                  {customerResults.map((c) => (
                    <div key={c.customer_code} className="search-item" onClick={() => selectCustomer(c)}>
                      {c.customer_code} {c.customer_name}
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="書類に印字する宛先名(未選択)"
                rows={2}
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  marginTop: 6,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  fontSize: "inherit",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button type="button" className="btn-sm" onClick={() => applyHonorific("御中")}>
                  御中
                </button>
                <button type="button" className="btn-sm" onClick={() => applyHonorific("様")}>
                  様
                </button>
              </div>
              <div className="cell-sub" style={{ marginTop: 2 }}>
                {customerCode ? `得意先コード: ${customerCode}` : "得意先未選択"}・実際に書類に載る宛先名は変更できます。住所と同様2行まで入力できます。
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
              <textarea
                placeholder="住所(マスタと異なる届け先・請求先の場合は書き換えてください。2行目以降はEnterで改行できます)"
                value={customerAddress ?? ""}
                onChange={(e) => setCustomerAddress(e.target.value)}
                rows={2}
                style={{ width: "100%", padding: "6px 10px", resize: "vertical", fontFamily: "inherit" }}
              />
            </div>
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
            <button type="button" onClick={() => setShowOrderLineSearch((s) => !s)}>
              +受注番号から一括追加
            </button>
            <button type="button" onClick={addManualLine}>
              +自由入力で追加
            </button>
            <button type="button" className={showRefInfo ? "btn-primary" : ""} onClick={() => setShowRefInfo((s) => !s)}>
              {showRefInfo ? "参考情報を隠す" : "参考情報を表示(仕入値・仕入先など)"}
            </button>
            {kind === "invoice" && (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="date"
                  value={bulkTransactionDate}
                  onChange={(e) => setBulkTransactionDate(e.target.value)}
                  style={{ padding: "6px 8px" }}
                  title="納品日・取引年月日(インボイス制度上の必須項目。明細行ごとに設定できます)"
                />
                <button type="button" onClick={applyBulkTransactionDate} disabled={!bulkTransactionDate}>
                  納品日を全行に適用
                </button>
              </div>
            )}
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

        {showHistorySearch && (
          <div style={{ padding: "0 20px 12px" }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <button
                type="button"
                className={`btn-sm${historyScope === "customer" ? " btn-primary" : ""}`}
                onClick={() => setHistoryScope("customer")}
              >
                この得意先のみ
              </button>
              <button
                type="button"
                className={`btn-sm${historyScope === "all" ? " btn-primary" : ""}`}
                onClick={() => setHistoryScope("all")}
              >
                他の得意先も含める
              </button>
              <span className="cell-sub" style={{ alignSelf: "center" }}>
                {historyScope === "all" && "(諸口コード等で見つからない商品を探す場合。要キーワード)"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                placeholder={
                  historyScope === "all" ? "品名で検索(必須・全得意先が対象)" : "品名で絞り込み(空欄で全件、直近順)"
                }
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchHistory()}
                style={{ flex: 1, padding: "6px 10px" }}
              />
              <button type="button" onClick={searchHistory} disabled={historySearching}>
                {historySearching ? "検索中…" : "検索"}
              </button>
            </div>
            {historyResults && (
              <div className="card" style={{ marginTop: 4, maxHeight: 220, overflowY: "auto" }}>
                {historyResults.length === 0 && <p className="cell-sub" style={{ padding: 8 }}>見つかりません。</p>}
                {historyResults.map((h, i) => (
                  <div key={`${h.product_code}_${i}`} className="search-item" onClick={() => addFromHistory(h)}>
                    {h.product_code} {h.product_name}
                    {historyScope === "all" && h.customer_name && (
                      <span className="cell-sub"> [{h.customer_name}]</span>
                    )}
                    (前回 {h.delivery_date} 数量{h.qty} 単価{h.unit_price ?? "—"})
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showOrderLineSearch && (
          <div style={{ padding: "0 20px 12px" }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                placeholder="受注番号を入力(その受注の明細を全行まとめて追加します)"
                value={orderNoQuery}
                onChange={(e) => setOrderNoQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchOrderLines()}
                style={{ flex: 1, padding: "6px 10px" }}
              />
              <button type="button" onClick={searchOrderLines} disabled={orderLineSearching}>
                {orderLineSearching ? "検索中…" : "検索"}
              </button>
            </div>
            {orderLineResults && (
              <div className="card" style={{ marginTop: 4, padding: 10 }}>
                {orderLineResults.length === 0 ? (
                  <p className="cell-sub">見つかりません。</p>
                ) : (
                  <>
                    <div className="cell-sub" style={{ marginBottom: 6 }}>
                      {orderLineResults[0].customer_name ?? ""}・{orderLineResults.length}行見つかりました。
                    </div>
                    <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 8 }}>
                      {orderLineResults.map((r, i) => (
                        <div key={i} className="cell-sub">
                          {r.product_code} {r.product_name}(数量{r.qty} 単価{r.unit_price}・{r.delivery_date})
                        </div>
                      ))}
                    </div>
                    <button type="button" className="btn-primary btn-sm" onClick={addAllOrderLines}>
                      この{orderLineResults.length}行をすべて追加
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <div className="matwrap">
          <table className="mat doc-line-table">
            {/* table-layout:fixedでの列幅は<colgroup>の<col>で確定させる(ヘッダー2行目の
                th style={width}は、1行目がcolSpanのグループ見出し行になっていると
                ブラウザに無視されるため)。幅は実データ(sales_lines/purchases)の実績値を
                根拠にしている:
                - 数量: 99.9%ile=3,000(4桁)、過去実績の最大=68,400(5桁)
                - 単価: 99.9%ile=¥232,025(6桁)、過去実績の最大=¥549万(7桁)
                - 金額: 99.9%ile=¥703,200、過去実績の最大=¥2,605万(表示11文字)
                - 税区分: 選択式で最大ラベル「8%(軽減)」6文字固定
                - 商品コード: 商品マスタの実績最大14文字
                - 商品名: 実績は中央値13文字・90%ile19文字(2行textareaの折返しで足りる)
                極端な外れ値(1%未満)は、入力欄内で横スクロール/テキストの折返しで吸収し、
                そのために大多数の行の見やすさを犠牲にしない。 */}
            <colgroup>
              <col style={{ width: 120 }} />
              <col />
              <col style={{ width: 88 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 92 }} />
              <col style={{ width: 118 }} />
              <col style={{ width: showRefInfo ? 140 : 170 }} />
              <col style={{ width: showRefInfo ? 100 : 120 }} />
              {kind === "invoice" && <col style={{ width: 130 }} />}
              {showRefInfo && (
                <>
                  <col style={{ width: 100 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 150 }} />
                </>
              )}
              <col style={{ width: 170 }} />
            </colgroup>
            <thead>
              {showRefInfo && (
                <tr>
                  <th colSpan={kind === "invoice" ? 9 : 8} style={{ background: "var(--card)" }}></th>
                  <th
                    colSpan={4}
                    style={{
                      borderLeft: "2px solid var(--line)",
                      background: "#fbfcfe",
                      textAlign: "center",
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    単価を決めるための参考情報
                  </th>
                  <th style={{ background: "var(--card)" }}></th>
                </tr>
              )}
              <tr>
                <th className="codecol">商品コード</th>
                <th className="namecol">商品名</th>
                <th>数量</th>
                <th>単価</th>
                <th>金額</th>
                <th>税区分</th>
                <th>備考</th>
                <th title="物件用印刷で部門ごとにシートを分けるための項目です">部門</th>
                {kind === "invoice" && (
                  <th title="インボイス制度(適格請求書)上の必須項目。行ごとに設定できます">納品日・取引日</th>
                )}
                {showRefInfo && (
                  <>
                    <th style={{ borderLeft: "2px solid var(--line)" }}>仕入値</th>
                    <th>仕入先</th>
                    <th>利益率</th>
                    <th>参照売価</th>
                  </>
                )}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const options = l.referenceOptions ?? [];
                const selected = options.find((o) => o.customer_code === l.selectedReferenceCode) ?? options[0];
                return (
                  <tr key={i}>
                    <td className="codecol">
                      <input
                        type="text"
                        className="cell-input"
                        value={l.product_code ?? ""}
                        onChange={(e) => updateLine(i, { product_code: e.target.value || null })}
                        onBlur={(e) => refreshLineMeta(i, e.target.value)}
                        style={{ width: "100%", boxSizing: "border-box" }}
                      />
                    </td>
                    <td className="namecol" style={{ whiteSpace: "normal" }}>
                      <textarea
                        className="cell-input"
                        value={l.product_name}
                        onChange={(e) => updateLine(i, { product_name: e.target.value })}
                        rows={2}
                        style={{
                          width: "100%",
                          resize: "vertical",
                          fontFamily: "inherit",
                          fontSize: "inherit",
                          fontWeight: 600,
                          boxSizing: "border-box",
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="cell-input"
                        value={l.qty}
                        onChange={(e) => updateLine(i, { qty: Number(e.target.value) })}
                        style={{ width: "100%", textAlign: "right", boxSizing: "border-box" }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="cell-input"
                        value={l.unit_price}
                        onChange={(e) => updateUnitPrice(i, e.target.value)}
                        style={{ width: "100%", textAlign: "right", boxSizing: "border-box" }}
                      />
                    </td>
                    <td>{yen(l.amount)}</td>
                    <td>
                      <select
                        className="cell-input"
                        value={l.tax_type}
                        onChange={(e) => updateLine(i, { tax_type: e.target.value as TaxType })}
                        style={{ width: "100%" }}
                      >
                        <option value="10">10%</option>
                        <option value="8">8%(軽減)</option>
                        <option value="0">非課税</option>
                      </select>
                    </td>
                    <td style={{ whiteSpace: "normal" }}>
                      <input
                        type="text"
                        className="cell-input"
                        value={l.note ?? ""}
                        onChange={(e) => updateLine(i, { note: e.target.value || null })}
                        style={{ width: "100%", boxSizing: "border-box" }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="cell-input"
                        value={l.department ?? ""}
                        onChange={(e) => updateLine(i, { department: e.target.value || null })}
                        placeholder="例: 水産厨房"
                        style={{ width: "100%", boxSizing: "border-box" }}
                      />
                    </td>
                    {kind === "invoice" && (
                      <td>
                        <input
                          type="date"
                          className="cell-input"
                          value={l.transaction_date ?? ""}
                          onChange={(e) => updateLine(i, { transaction_date: e.target.value || null })}
                          style={{ width: "100%", boxSizing: "border-box" }}
                        />
                      </td>
                    )}
                    {showRefInfo && (
                    <td style={{ borderLeft: "2px solid var(--line)" }}>
                      <input
                        type="number"
                        className="cell-input"
                        value={l.cost_price ?? ""}
                        onChange={(e) => updateLine(i, { cost_price: e.target.value === "" ? null : Number(e.target.value) })}
                        style={{ width: "100%", textAlign: "right", boxSizing: "border-box" }}
                      />
                    </td>
                    )}
                    {showRefInfo && (
                    <td style={{ whiteSpace: "normal" }}>
                      {editingSupplierIndex === i ? (
                        <div>
                          <input
                            ref={supplierInputRef}
                            type="text"
                            className="cell-input"
                            autoFocus
                            value={supplierQuery}
                            onChange={(e) => setSupplierQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && searchSupplier()}
                            onBlur={() => setTimeout(() => setEditingSupplierIndex((cur) => (cur === i ? null : cur)), 150)}
                            placeholder="仕入先コード・名称で検索"
                            style={{ width: "100%", boxSizing: "border-box" }}
                          />
                          {supplierSearching && <div className="cell-sub">検索中…</div>}
                          {supplierResults && supplierDropdownPos && (
                            <div
                              className="card"
                              style={{
                                position: "fixed",
                                zIndex: 50,
                                top: supplierDropdownPos.top,
                                left: supplierDropdownPos.left,
                                width: 320,
                                maxHeight: 260,
                                overflowY: "auto",
                              }}
                            >
                              {supplierResults.length === 0 && (
                                <p className="cell-sub" style={{ padding: 8 }}>
                                  見つかりません。
                                </p>
                              )}
                              {supplierResults.map((s) => (
                                <div key={s.supplier_code} className="search-item" onMouseDown={() => selectSupplier(i, s)}>
                                  <span style={{ color: "var(--ink-faint)", fontSize: 11 }}>{s.supplier_code}</span> {s.supplier_name}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : l.supplier_code || l.supplier_name ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                          {l.supplier_code && (
                            <span
                              onClick={() => startEditSupplier(i, l.supplier_name)}
                              style={{
                                border: "1px solid var(--line)",
                                borderRadius: 4,
                                padding: "1px 5px",
                                fontSize: 11,
                                color: "var(--ink-faint)",
                                cursor: "pointer",
                              }}
                              title="クリックして変更"
                            >
                              {l.supplier_code}
                            </span>
                          )}
                          <span
                            onClick={() => startEditSupplier(i, l.supplier_name)}
                            style={{
                              cursor: "pointer",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              maxWidth: 95,
                            }}
                            title={`${l.supplier_name ?? "(名称なし)"}(クリックして変更)`}
                          >
                            {l.supplier_name ?? "(名称なし)"}
                          </span>
                          <button type="button" className="btn-icon" onClick={() => clearSupplier(i)} title="仕入先をクリア">
                            ×
                          </button>
                        </div>
                      ) : (
                        <button type="button" className="btn-sm" onClick={() => startEditSupplier(i, null)}>
                          仕入先を検索
                        </button>
                      )}
                    </td>
                    )}
                    {showRefInfo && (
                    <td>
                      <input
                        type="number"
                        className="cell-input"
                        value={l.margin_pct ?? ""}
                        onChange={(e) => updateMargin(i, e.target.value)}
                        placeholder="%"
                        style={{ width: "100%", textAlign: "right", boxSizing: "border-box" }}
                      />
                    </td>
                    )}
                    {showRefInfo && (
                    <td style={{ whiteSpace: "normal" }}>
                      {options.length > 0 ? (
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <select
                            className="cell-input"
                            value={selected?.customer_code ?? ""}
                            onChange={(e) => selectReferenceOption(i, e.target.value)}
                            style={{ flex: 1, minWidth: 0, fontSize: 12 }}
                          >
                            {options.map((o) => (
                              <option key={o.customer_code} value={o.customer_code}>
                                {o.customer_name} ¥{o.unit_price}({o.delivery_date})
                              </option>
                            ))}
                          </select>
                          <button type="button" className="btn-sm" onClick={() => applyReferencePrice(i)} title="この価格を単価に反映">
                            →単価
                          </button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    )}
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button type="button" className="btn-icon" onClick={() => insertLineAfter(i)} title="この下に空の行を挿入">
                          挿入
                        </button>
                        <button type="button" className="btn-icon" onClick={() => duplicateLine(i)} title="この行を複製">
                          複製
                        </button>
                        <button type="button" className="btn-icon btn-danger" onClick={() => removeLine(i)} title="この行を削除">
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={(showRefInfo ? 13 : 9) + (kind === "invoice" ? 1 : 0)} className="cell-sub" style={{ padding: 16 }}>
                    明細がありません。上のボタンから追加してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <style jsx>{`
            .doc-line-table {
              table-layout: fixed;
              width: 100%;
              min-width: ${(showRefInfo ? 1536 : 1136) + (kind === "invoice" ? 130 : 0)}px;
            }
            .doc-line-table td,
            .doc-line-table th {
              vertical-align: top;
            }
            /* 数量・単価・仕入値の上下スピナーは幅を取る割に実用性が低いため非表示にする */
            .doc-line-table input[type="number"] {
              -moz-appearance: textfield;
            }
            .doc-line-table input[type="number"]::-webkit-outer-spin-button,
            .doc-line-table input[type="number"]::-webkit-inner-spin-button {
              -webkit-appearance: none;
              margin: 0;
            }
          `}</style>
        </div>

        <div style={{ padding: "12px 20px", textAlign: "right", fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <label style={{ color: "var(--ink-faint)" }}>消費税の端数処理</label>
            <select value={taxRounding} onChange={(e) => setTaxRounding(e.target.value as TaxRounding)} style={{ padding: "4px 8px" }}>
              {(Object.entries(TAX_ROUNDING_LABEL) as [TaxRounding, string][]).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
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

      {error && <div className="alert alert-error">{error}</div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn-primary" onClick={() => save(true)} disabled={saving}>
          確定して保存
        </button>
        <button type="button" onClick={() => save(false)} disabled={saving}>
          {saving ? "保存中..." : "下書き保存"}
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
          <button type="button" className="btn-danger" onClick={remove} disabled={deleting} style={{ marginLeft: "auto" }}>
            {deleting ? "削除中..." : "削除"}
          </button>
        )}
      </div>
    </div>
  );
}
