"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { yen, jpn } from "@/lib/format";
import { BRANCH_NAMES, branchNameOnly } from "@/lib/branch-names";
import { REP_NAMES, repNameOnly } from "@/lib/rep-names";
import type { BranchRepPair } from "@/app/api/quote-customer-branch-reps/route";
import { QUOTE_DRAFT_SESSION_KEY, type QuoteDraft } from "@/lib/quoteDraftHandoff";

type CustomerOption = {
  customer_code: string;
  customer_name: string;
  postal_code: string | null;
  address: string | null;
  phone_number: string | null;
};

type PhoneNumber = {
  id: number;
  customer_code: string;
  phone_number: string;
  created_at: string;
};

type CustomerNote = {
  id: number;
  customer_code: string;
  note: string;
  created_at: string;
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 電話中に見積書に載せたい商品を「ロック」して集めておくためのカート。
// 1件の見積書は得意先1件分なので、カートに入れた商品の得意先がすべて同じであることを
// 見積書作成時にチェックする。
type QuoteCartItem = {
  key: string;
  customer_code: string;
  customer_name: string;
  branch_code: string | null;
  order_no: string | null;
  order_line: string | null;
  item_code: string | null;
  item_name: string;
  spec: string | null;
  qty: number;
  unit_price: number;
  cost_price: number | null;
  supplier_code: string | null;
  supplier_name: string | null;
  delivery_date: string | null;
};

type HistoryRow = {
  customer_code: string | null;
  customer_name: string | null;
  delivery_date: string | null;
  order_no: string | null;
  order_line: string | null;
  item_code: string | null;
  item_name: string | null;
  spec: string | null;
  qty: number | null;
  sell_price: number | null;
  branch_code: string | null;
  rep_code: string | null;
  project_name: string | null;
  assumed_cost: number | null;
  supplier_code: string | null;
  supplier_name: string | null;
};

// コールセンター対応中など、電話口で得意先名・コードを聞いたらすぐに直近の取引実績を
// 呼び出せるようにするための画面。経営レポート(/sales)とは別に、直接検索のみの
// 軽量な作りにして応答速度を優先する(取引履歴のみ表示・集計はしない)。
export default function CustomerHistorySearch() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<CustomerOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 同じ会社が拠点ごとに別の得意先コードに分かれている場合(例:高速)、どの拠点で
  // 取引があったかまとめて検索できるよう、得意先は複数選択できるようにしている。
  const [selected, setSelected] = useState<CustomerOption[]>([]);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 拠点・担当を先に選んでおくと、名前検索(ilike)の対象をその拠点・担当の得意先だけに
  // DB側で絞り込めるため、拠点が大きい(得意先が多い)場合ほど検索が速くなる。
  const [branchFilter, setBranchFilter] = useState("");
  const [repFilter, setRepFilter] = useState("");
  const [branchRepPairs, setBranchRepPairs] = useState<BranchRepPair[]>([]);

  useEffect(() => {
    fetch("/api/quote-customer-branch-reps")
      .then((r) => r.json())
      .then((json) => setBranchRepPairs(json.pairs ?? []))
      .catch(() => {});
  }, []);

  const branchCodes = useMemo(() => {
    const codes = new Set(branchRepPairs.map((p) => p.branch_code));
    // 文字列のままsort()すると"10"が"2"より前に来てしまうため、数値として並べる。
    return Array.from(codes).sort((a, b) => Number(a) - Number(b));
  }, [branchRepPairs]);

  const repCodesForBranch = useMemo(() => {
    const codes = branchRepPairs
      .filter((p) => (branchFilter ? p.branch_code === branchFilter : true))
      .map((p) => p.rep_code)
      .filter((c): c is string => !!c);
    return Array.from(new Set(codes)).sort();
  }, [branchRepPairs, branchFilter]);

  function onBranchFilterChange(v: string) {
    setBranchFilter(v);
    // 拠点を変えたら、担当が新しい拠点に存在しない値のままにならないようリセットする。
    setRepFilter("");
  }

  // 検索結果が返ってくる順番は保証されないため、入力中に連打すると古い応答が後から
  // 画面に表示されてしまうことがある。リクエストごとに連番を振り、最新のものだけ反映する。
  const latestRequestId = useRef(0);

  async function search() {
    if (!query.trim() && !branchFilter && !repFilter) {
      setResults(null);
      return;
    }
    const requestId = ++latestRequestId.current;
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      if (branchFilter) params.set("branch", branchFilter);
      if (repFilter) params.set("rep", repFilter);
      const res = await fetch(`/api/quote-customer-search?${params.toString()}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      if (requestId === latestRequestId.current) setResults(json.rows ?? []);
    } catch (e) {
      if (requestId === latestRequestId.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (requestId === latestRequestId.current) setSearching(false);
    }
  }

  // 検索エンジンのように、入力するたびに(少し待ってから)自動で絞り込む。
  // Enter・検索ボタンを押さなくても、「イオン」→ 空白 →「岡崎」と打つにつれて
  // 候補が自動で絞られていく。
  useEffect(() => {
    const timer = setTimeout(() => {
      search();
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, branchFilter, repFilter]);

  // 得意先選択後、さらに商品で絞り込むための検索語。「直近50件」の中だけでなく、
  // その商品の取引実績をDB側から探し直す(直近には出てこない過去の購入も見つけられるように)。
  const [productFilter, setProductFilter] = useState("");
  const latestHistoryRequestId = useRef(0);

  async function fetchHistory(customerCodes: string[], product: string) {
    if (customerCodes.length === 0) {
      setHistory(null);
      return;
    }
    const requestId = ++latestHistoryRequestId.current;
    setHistoryLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ customer_code: customerCodes.join(",") });
      if (product.trim()) params.set("product", product.trim());
      const res = await fetch(`/api/customer-sales-history?${params.toString()}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      if (requestId === latestHistoryRequestId.current) setHistory(json.rows ?? []);
    } catch (e) {
      if (requestId === latestHistoryRequestId.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (requestId === latestHistoryRequestId.current) setHistoryLoading(false);
    }
  }

  // クリックした得意先を選択に追加/解除する(複数の拠点をまとめて検索できるように、
  // 単一選択の置き換えではなくトグルにしている)。検索結果はそのまま残すので、
  // 同じ検索語のリストから続けて別の拠点も選べる。
  function toggleCustomer(c: CustomerOption) {
    setSelected((prev) => {
      const exists = prev.some((p) => p.customer_code === c.customer_code);
      if (exists) return prev.filter((p) => p.customer_code !== c.customer_code);
      return [...prev, c];
    });
  }

  function removeCustomer(customerCode: string) {
    setSelected((prev) => prev.filter((p) => p.customer_code !== customerCode));
  }

  function clearSelection() {
    setSelected([]);
    setHistory(null);
    setProductFilter("");
  }

  const selectedCodesKey = useMemo(
    () => selected.map((c) => c.customer_code).sort().join(","),
    [selected]
  );

  // 商品での絞り込みも、得意先検索と同じく入力するたびに自動で絞り込む。
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchHistory(selected.map((c) => c.customer_code), productFilter);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productFilter, selectedCodesKey]);

  // 得意先マスタに電話番号が無いため、コールセンター対応でその場で分かった番号を
  // 日々登録していけるようにするための機能。選択した得意先ごとに登録済み番号を表示し、
  // 追加・削除できる。
  const [phoneNumbersByCode, setPhoneNumbersByCode] = useState<Record<string, PhoneNumber[]>>({});
  const [phoneInputByCode, setPhoneInputByCode] = useState<Record<string, string>>({});
  const [phoneBusyByCode, setPhoneBusyByCode] = useState<Record<string, boolean>>({});

  async function fetchPhoneNumbers(customerCodes: string[]) {
    if (customerCodes.length === 0) {
      setPhoneNumbersByCode({});
      return;
    }
    try {
      const res = await fetch(`/api/customer-phone-numbers?customer_code=${customerCodes.join(",")}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      const grouped: Record<string, PhoneNumber[]> = {};
      for (const row of (json.rows ?? []) as PhoneNumber[]) {
        (grouped[row.customer_code] ??= []).push(row);
      }
      setPhoneNumbersByCode(grouped);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    fetchPhoneNumbers(selected.map((c) => c.customer_code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCodesKey]);

  async function addPhoneNumber(customerCode: string) {
    const value = (phoneInputByCode[customerCode] ?? "").trim();
    if (!value) return;
    setPhoneBusyByCode((s) => ({ ...s, [customerCode]: true }));
    setError(null);
    try {
      const res = await fetch("/api/customer-phone-numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_code: customerCode, phone_number: value }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setPhoneNumbersByCode((s) => ({
        ...s,
        [customerCode]: [json.row as PhoneNumber, ...(s[customerCode] ?? [])],
      }));
      setPhoneInputByCode((s) => ({ ...s, [customerCode]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhoneBusyByCode((s) => ({ ...s, [customerCode]: false }));
    }
  }

  async function removePhoneNumber(customerCode: string, id: number) {
    setError(null);
    try {
      const res = await fetch(`/api/customer-phone-numbers?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setPhoneNumbersByCode((s) => ({
        ...s,
        [customerCode]: (s[customerCode] ?? []).filter((p) => p.id !== id),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // 通話中に気づいたことをその場でメモしておき、別の担当者が次に電話を受けたときも
  // 経緯が分かるようにするための機能。選択した得意先ごとにメモを表示し、追加・削除できる。
  const [notesByCode, setNotesByCode] = useState<Record<string, CustomerNote[]>>({});
  const [noteInputByCode, setNoteInputByCode] = useState<Record<string, string>>({});
  const [noteBusyByCode, setNoteBusyByCode] = useState<Record<string, boolean>>({});
  // メモが増えると実績の表が下にいって見にくくなるため、過去のメモ一覧は既定で
  // 折り畳んでおく(メモの追加自体はいつでもできる)。
  const [notesExpandedByCode, setNotesExpandedByCode] = useState<Record<string, boolean>>({});

  async function fetchNotes(customerCodes: string[]) {
    if (customerCodes.length === 0) {
      setNotesByCode({});
      return;
    }
    try {
      const res = await fetch(`/api/customer-notes?customer_code=${customerCodes.join(",")}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      const grouped: Record<string, CustomerNote[]> = {};
      for (const row of (json.rows ?? []) as CustomerNote[]) {
        (grouped[row.customer_code] ??= []).push(row);
      }
      setNotesByCode(grouped);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    fetchNotes(selected.map((c) => c.customer_code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCodesKey]);

  async function addNote(customerCode: string) {
    const value = (noteInputByCode[customerCode] ?? "").trim();
    if (!value) return;
    setNoteBusyByCode((s) => ({ ...s, [customerCode]: true }));
    setError(null);
    try {
      const res = await fetch("/api/customer-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_code: customerCode, note: value }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setNotesByCode((s) => ({
        ...s,
        [customerCode]: [json.row as CustomerNote, ...(s[customerCode] ?? [])],
      }));
      setNoteInputByCode((s) => ({ ...s, [customerCode]: "" }));
      // 追加したメモがすぐ見えるよう、折り畳みは自動で開く。
      setNotesExpandedByCode((s) => ({ ...s, [customerCode]: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNoteBusyByCode((s) => ({ ...s, [customerCode]: false }));
    }
  }

  async function removeNote(customerCode: string, id: number) {
    setError(null);
    try {
      const res = await fetch(`/api/customer-notes?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setNotesByCode((s) => ({
        ...s,
        [customerCode]: (s[customerCode] ?? []).filter((n) => n.id !== id),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const showCustomerColumn = selected.length > 1;
  const columnCount = (showCustomerColumn ? 12 : 11) + 1;

  // 電話中に、取引実績の行から見積書に載せたい商品を選んで(ロックして)おき、
  // 複数選び終わったらまとめて見積書の新規作成画面に渡す機能。
  const [quoteCart, setQuoteCart] = useState<QuoteCartItem[]>([]);

  function rowKey(r: HistoryRow, i: number): string {
    return `${r.customer_code ?? ""}_${r.order_no ?? ""}_${r.item_code ?? ""}_${r.delivery_date ?? ""}_${i}`;
  }

  function toggleCartItem(r: HistoryRow, key: string) {
    setQuoteCart((prev) => {
      if (prev.some((c) => c.key === key)) return prev.filter((c) => c.key !== key);
      const customerCode = r.customer_code ?? "";
      const customerName = (r.customer_code && selectedNameByCode.get(r.customer_code)) || r.customer_name || "";
      return [
        ...prev,
        {
          key,
          customer_code: customerCode,
          customer_name: customerName,
          branch_code: r.branch_code,
          order_no: r.order_no,
          order_line: r.order_line,
          item_code: r.item_code,
          item_name: r.item_name ?? "",
          spec: r.spec,
          qty: r.qty ?? 1,
          unit_price: r.sell_price ?? 0,
          cost_price: r.assumed_cost,
          supplier_code: r.supplier_code,
          supplier_name: r.supplier_name,
          delivery_date: r.delivery_date,
        },
      ];
    });
  }

  function updateCartQty(key: string, qty: number) {
    setQuoteCart((prev) => prev.map((c) => (c.key === key ? { ...c, qty } : c)));
  }

  function removeCartItem(key: string) {
    setQuoteCart((prev) => prev.filter((c) => c.key !== key));
  }

  const cartCustomerCodes = useMemo(() => new Set(quoteCart.map((c) => c.customer_code)), [quoteCart]);

  function createQuoteFromCart() {
    if (quoteCart.length === 0) return;
    if (cartCustomerCodes.size > 1) {
      setError("見積書は1つの得意先分しか作成できません。複数の得意先の商品が選ばれています。");
      return;
    }
    const customerCode = quoteCart[0].customer_code;
    const customer = selected.find((c) => c.customer_code === customerCode);
    // 拠点は、選んだ商品の取引実績の拠点(先頭行のもの)を初期値にする。
    const branchCode = quoteCart.find((c) => c.branch_code)?.branch_code ?? null;
    const draft: QuoteDraft = {
      customer_code: customerCode,
      customer_name: quoteCart[0].customer_name,
      postal_code: customer?.postal_code ?? null,
      address: customer?.address ?? null,
      branch_code: branchCode,
      lines: quoteCart.map((c) => ({
        product_code: c.item_code,
        product_name: c.item_name,
        spec: c.spec,
        qty: c.qty,
        unit_price: c.unit_price,
        order_no: c.order_no,
        order_line: c.order_line,
        cost_price: c.cost_price,
        supplier_code: c.supplier_code,
        supplier_name: c.supplier_name,
        delivery_date: c.delivery_date,
      })),
    };
    sessionStorage.setItem(QUOTE_DRAFT_SESSION_KEY, JSON.stringify(draft));
    setQuoteCart([]);
    // コールセンター対応中は顧客実績のタブ・検索状態を保ったまま、見積書は別タブで
    // 何度でも開けるようにする(同じタブで遷移すると検索し直しになってしまうため)。
    window.open("/sales-app/quotes/new", "_blank");
  }

  // 売上明細(sales_lines)のcustomer_nameは古い伝票などで支店名が省略されて
  // 「㈱高速」のように会社名だけのことがあり、どの支店か区別できない。
  // 得意先マスタ(customer_master)から取得した選択時の正式名称を優先して表示する。
  const selectedNameByCode = useMemo(
    () => new Map(selected.map((c) => [c.customer_code, c.customer_name])),
    [selected]
  );

  return (
    <div>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>拠点・担当で絞り込み(先に選ぶと検索が速くなります・任意)</label>
        <div style={{ display: "flex", gap: 6, marginTop: 4, marginBottom: 10 }}>
          <select value={branchFilter} onChange={(e) => onBranchFilterChange(e.target.value)} style={{ flex: 1, padding: "8px 10px" }}>
            <option value="">拠点(すべて)</option>
            {branchCodes.map((code) => (
              <option key={code} value={code}>
                {BRANCH_NAMES[code] ?? code}
              </option>
            ))}
          </select>
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} style={{ flex: 1, padding: "8px 10px" }}>
            <option value="">担当(すべて)</option>
            {repCodesForBranch.map((code) => (
              <option key={code} value={code}>
                {REP_NAMES[code] ?? code}
              </option>
            ))}
          </select>
        </div>

        <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>
          得意先コード・得意先名・電話番号で検索(入力するたびに自動で絞り込みます。「イオン 岡崎」のように空白区切りでさらに絞り込めます。
          クリックで得意先を選択に追加できます。同じ会社の別拠点もまとめて選べます)
        </label>
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <input
              type="text"
              autoFocus
              placeholder="例: イオン 岡崎 / 03-1234-5678"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              style={{ width: "100%", padding: "10px 34px 10px 12px", fontSize: 15, boxSizing: "border-box" }}
            />
            {query && (
              <button
                type="button"
                className="btn-icon"
                onClick={() => {
                  setQuery("");
                  setResults(null);
                }}
                title="検索語をクリア"
                style={{
                  position: "absolute",
                  right: 6,
                  top: "50%",
                  transform: "translateY(-50%)",
                }}
              >
                ×
              </button>
            )}
          </div>
          <button type="button" className="btn-primary" onClick={search} disabled={searching}>
            {searching ? "検索中…" : "検索"}
          </button>
        </div>

        {results && (
          <div className="card" style={{ marginTop: 8, maxHeight: 280, overflowY: "auto" }}>
            {results.length === 0 && <p className="cell-sub" style={{ padding: 10 }}>見つかりません。</p>}
            {results.map((c) => {
              const isSelected = selected.some((s) => s.customer_code === c.customer_code);
              return (
                <div
                  key={c.customer_code}
                  className="search-item"
                  onClick={() => toggleCustomer(c)}
                  style={isSelected ? { background: "var(--line)" } : undefined}
                >
                  <span style={{ fontWeight: 600 }}>
                    {isSelected ? "✓ " : ""}
                    {c.customer_name}
                  </span>
                  <span className="cell-sub" style={{ marginLeft: 8 }}>
                    {c.customer_code}
                    {c.address ? `・${c.address}` : ""}
                    {c.phone_number ? `・${c.phone_number}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {selected.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 16 }}>
          <div className="card-head">
            <div>
              <h2>選択中の得意先({selected.length}件)</h2>
            </div>
            <button type="button" onClick={clearSelection}>
              すべて解除
            </button>
          </div>
          <div style={{ padding: "0 20px 16px", display: "flex", flexWrap: "wrap", gap: 8 }}>
            {selected.map((c) => (
              <span
                key={c.customer_code}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: "1px solid var(--line)",
                  borderRadius: 999,
                  padding: "4px 6px 4px 12px",
                  fontSize: 13,
                }}
              >
                {c.customer_name}
                <span className="cell-sub">{c.customer_code}</span>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => removeCustomer(c.customer_code)}
                  title="この得意先を外す"
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <div style={{ padding: "0 20px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {selected.map((c) => (
              <div key={c.customer_code}>
                <div style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 4 }}>
                  {c.customer_name}の電話番号
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  {c.phone_number && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        border: "1px solid var(--line)",
                        borderRadius: 999,
                        padding: "2px 10px",
                        fontSize: 13,
                      }}
                      title="得意先マスタの電話番号"
                    >
                      {c.phone_number}
                      <span className="cell-sub">(マスタ)</span>
                    </span>
                  )}
                  {(phoneNumbersByCode[c.customer_code] ?? []).map((p) => (
                    <span
                      key={p.id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        border: "1px solid var(--line)",
                        borderRadius: 999,
                        padding: "2px 4px 2px 10px",
                        fontSize: 13,
                      }}
                    >
                      {p.phone_number}
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => removePhoneNumber(c.customer_code, p.id)}
                        title="この電話番号を削除"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    placeholder="電話番号を追加"
                    value={phoneInputByCode[c.customer_code] ?? ""}
                    onChange={(e) => setPhoneInputByCode((s) => ({ ...s, [c.customer_code]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addPhoneNumber(c.customer_code)}
                    style={{ width: 150, padding: "4px 8px", fontSize: 13 }}
                  />
                  <button
                    type="button"
                    onClick={() => addPhoneNumber(c.customer_code)}
                    disabled={!!phoneBusyByCode[c.customer_code]}
                  >
                    追加
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding: "0 20px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {selected.map((c) => {
              const notes = notesByCode[c.customer_code] ?? [];
              const expanded = !!notesExpandedByCode[c.customer_code];
              return (
              <div key={c.customer_code}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>{c.customer_name}の問い合わせメモ</div>
                  {notes.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setNotesExpandedByCode((s) => ({ ...s, [c.customer_code]: !expanded }))
                      }
                    >
                      {expanded ? "閉じる" : `過去のメモを表示する(${notes.length}件)`}
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input
                    type="text"
                    placeholder="例: 納期を10日に変更希望と連絡あり"
                    value={noteInputByCode[c.customer_code] ?? ""}
                    onChange={(e) => setNoteInputByCode((s) => ({ ...s, [c.customer_code]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addNote(c.customer_code)}
                    style={{ flex: 1, padding: "6px 10px", fontSize: 13 }}
                  />
                  <button type="button" onClick={() => addNote(c.customer_code)} disabled={!!noteBusyByCode[c.customer_code]}>
                    追加
                  </button>
                </div>
                {expanded && notes.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {(notesByCode[c.customer_code] ?? []).map((n) => (
                      <div
                        key={n.id}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          fontSize: 13,
                          borderBottom: "1px solid var(--line)",
                          paddingBottom: 4,
                        }}
                      >
                        <span className="cell-sub" style={{ whiteSpace: "nowrap" }}>
                          {fmtDateTime(n.created_at)}
                        </span>
                        <span style={{ flex: 1 }}>{n.note}</span>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => removeNote(c.customer_code, n.id)}
                          title="このメモを削除"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              );
            })}
          </div>

          <div style={{ padding: "0 20px 0" }}>
            <label style={{ fontSize: 12, color: "var(--ink-faint)" }}>
              商品コード・商品名で絞り込み(入力するたびに自動で絞り込みます)
            </label>
            <div style={{ position: "relative", marginTop: 4, maxWidth: 420 }}>
              <input
                type="text"
                placeholder="例: ラップ"
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                style={{ width: "100%", padding: "8px 34px 8px 10px", boxSizing: "border-box" }}
              />
              {productFilter && (
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => setProductFilter("")}
                  title="絞り込みをクリア"
                  style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {quoteCart.length > 0 && (
            <div style={{ padding: "0 20px 16px" }}>
              <div style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 4 }}>
                見積書に追加する商品({quoteCart.length}件)・チェックを入れた行を数量を確認して「見積書を作成」を押してください
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {quoteCart.map((c) => (
                  <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span className="cell-sub" style={{ width: 90, flexShrink: 0 }}>{c.customer_name}</span>
                    <span className="cell-sub" style={{ width: 110, flexShrink: 0 }}>{c.item_code ?? "—"}</span>
                    <span style={{ flex: 1 }}>
                      {c.item_name}
                      {c.spec ? `(${c.spec})` : ""}
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={c.qty}
                      onChange={(e) => updateCartQty(c.key, Number(e.target.value) || 1)}
                      style={{ width: 70, padding: "4px 6px" }}
                    />
                    <span className="cell-sub">{yen(c.unit_price)}</span>
                    <button type="button" className="btn-icon" onClick={() => removeCartItem(c.key)} title="カートから外す">
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {cartCustomerCodes.size > 1 && (
                <p style={{ color: "var(--neg)", fontSize: 12, marginTop: 6 }}>
                  複数の得意先の商品が混ざっています。見積書は1つの得意先分しか作成できません。
                </p>
              )}
              <button type="button" className="btn-primary" style={{ marginTop: 8 }} onClick={createQuoteFromCart}>
                見積書を作成
              </button>
            </div>
          )}

          <div className="matwrap">
            <table className="mat">
              <thead>
                <tr>
                  <th>見積</th>
                  {showCustomerColumn && <th className="namecol">得意先</th>}
                  <th>納品日</th>
                  <th>受注番号</th>
                  <th className="codecol">商品コード</th>
                  <th className="namecol">商品名</th>
                  <th className="namecol">仕様</th>
                  <th>数量</th>
                  <th>単価</th>
                  <th>金額</th>
                  <th>拠点</th>
                  <th>担当</th>
                  <th className="namecol">物件名</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading && (
                  <tr>
                    <td colSpan={columnCount} className="cell-sub" style={{ padding: 16 }}>
                      読み込み中…
                    </td>
                  </tr>
                )}
                {!historyLoading && history && history.length === 0 && (
                  <tr>
                    <td colSpan={columnCount} className="cell-sub" style={{ padding: 16 }}>
                      取引実績がありません。
                    </td>
                  </tr>
                )}
                {!historyLoading &&
                  history?.map((r, i) => {
                    const key = rowKey(r, i);
                    const locked = quoteCart.some((c) => c.key === key);
                    return (
                    <tr key={i}>
                      <td>
                        <input
                          type="checkbox"
                          checked={locked}
                          disabled={!r.item_code}
                          onChange={() => toggleCartItem(r, key)}
                          title="見積書に追加する商品としてロック"
                        />
                      </td>
                      {showCustomerColumn && (
                        <td className="namecol">
                          {(r.customer_code && selectedNameByCode.get(r.customer_code)) ?? r.customer_name ?? "—"}
                          {r.customer_code && (
                            <span className="cell-sub" style={{ display: "block", fontWeight: 400 }}>
                              {r.customer_code}
                            </span>
                          )}
                        </td>
                      )}
                      <td>{r.delivery_date ?? "—"}</td>
                      <td className="cell-sub">{r.order_no ?? "—"}</td>
                      <td className="codecol">{r.item_code ?? "—"}</td>
                      <td className="namecol">{r.item_name ?? "—"}</td>
                      <td className="namecol">{r.spec ?? "—"}</td>
                      <td>{r.qty != null ? jpn(r.qty) : "—"}</td>
                      <td>{r.sell_price != null ? yen(r.sell_price) : "—"}</td>
                      <td>{r.qty != null && r.sell_price != null ? yen(r.qty * r.sell_price) : "—"}</td>
                      <td>{branchNameOnly(r.branch_code)}</td>
                      <td>{repNameOnly(r.rep_code)}</td>
                      <td className="namecol">{r.project_name ?? "—"}</td>
                    </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {history && history.length > 0 && (
            <div className="cell-sub" style={{ padding: "10px 20px" }}>
              {productFilter
                ? `「${productFilter}」に該当する直近${history.length}件(納品日の新しい順)を表示しています。`
                : `直近${history.length}件(納品日の新しい順)を表示しています。`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
