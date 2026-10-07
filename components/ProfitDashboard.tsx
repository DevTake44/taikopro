"use client";

import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ProfitOrder, ProfitOrderLineDetail } from "@/lib/profitTypes";
import { branchLabel } from "@/lib/branch-names";
import { repLabel } from "@/lib/rep-names";
import Link from "next/link";
import {
  periodKeyFor,
  periodRangeFor,
  fiscalYearStartOf,
  fiscalYearRangeFor,
  fiscalYearLabel,
} from "@/lib/period";

// 経営レポート(/sales)・このページ(/sales/profit)・拠点・営業・得意先 利益
// (/sales/profit-summary)を相互に行き来できるようにするための共通ナビ。
// 経営レポートを常に先頭に置く。
export function CrossPageNav({ current }: { current: "report" | "profit" | "profit-summary" }) {
  const items: { key: typeof current; href: string; label: string }[] = [
    { key: "report", href: "/sales", label: "経営レポート" },
    { key: "profit", href: "/sales/profit", label: "売上利益" },
    { key: "profit-summary", href: "/sales/profit-summary", label: "拠点・営業・得意先 利益" },
  ];
  return (
    <>
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          className="ghost-btn"
          style={
            it.key === current
              ? { textDecoration: "none", border: "1px solid var(--rk-direct)", background: "var(--rk-direct)", color: "#fff" }
              : { textDecoration: "none" }
          }
        >
          {it.label}
        </Link>
      ))}
    </>
  );
}

function fmtYen(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `¥${Math.round(v).toLocaleString("ja-JP")}`;
}

function fmtPct(v: number | null) {
  if (v === null || Number.isNaN(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function marginPct(revenue: number, profit: number): number | null {
  if (!revenue) return null;
  return (profit / revenue) * 100;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function uniqueSortedNumeric(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b, "ja");
  });
}

type Dimension = "customer" | "order" | "project" | "rep";

type GroupRow = {
  key: string;
  label: string;
  orderCount: number;
  revenue: number;
  cost: number;
  profit: number;
  // "order" (受注番号)単位のときだけ埋まる、行の詳細情報
  customerCode?: string | null;
  customerName?: string | null;
  branchCode?: string | null;
  repCode?: string | null;
  projectName?: string | null;
  unconfirmedCostLineCount?: number;
  unconfirmedCostRevenue?: number;
};

function groupOrders(
  orders: ProfitOrder[],
  keyFn: (o: ProfitOrder) => string,
  labelFn: (o: ProfitOrder) => string
): GroupRow[] {
  const map = new Map<
    string,
    {
      label: string;
      orderCount: number;
      revenue: number;
      cost: number;
      profit: number;
      unconfirmedCostLineCount: number;
      unconfirmedCostRevenue: number;
    }
  >();
  for (const o of orders) {
    const key = keyFn(o);
    const existing = map.get(key);
    if (existing) {
      existing.orderCount += 1;
      existing.revenue += o.revenue;
      existing.cost += o.cost;
      existing.profit += o.profit;
      existing.unconfirmedCostLineCount += o.unconfirmed_cost_line_count ?? 0;
      existing.unconfirmedCostRevenue += o.unconfirmed_cost_revenue ?? 0;
    } else {
      map.set(key, {
        label: labelFn(o),
        orderCount: 1,
        revenue: o.revenue,
        cost: o.cost,
        profit: o.profit,
        unconfirmedCostLineCount: o.unconfirmed_cost_line_count ?? 0,
        unconfirmedCostRevenue: o.unconfirmed_cost_revenue ?? 0,
      });
    }
  }
  return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
}

const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: "order", label: "受注番号" },
  { key: "customer", label: "得意先" },
  { key: "project", label: "物件" },
  { key: "rep", label: "担当" },
];

type SortKey = "revenue" | "profit";

export default function ProfitDashboard({
  orders,
  headerExtra,
}: {
  orders: ProfitOrder[];
  // 2026-08-27追加: ブラウザ内キャッシュの「最終読み込み: HH:MM」表示と「更新」ボタンを
  // ProfitDashboardLoader側から差し込むためのスロット。このコンポーネント自体は
  // キャッシュの仕組みを知らなくてよいようにするため、任意のReactNodeを受け取るだけにしている。
  headerExtra?: ReactNode;
}) {
  const maxOrderDate = useMemo(() => {
    const dates = orders.map((o) => o.order_date).filter((d): d is string => !!d);
    return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
  }, [orders]);

  const maxDeliveryDate = useMemo(() => {
    const dates = orders.map((o) => o.delivery_date).filter((d): d is string => !!d);
    return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
  }, [orders]);

  // 期間(月度)キー("202606"のような形式)は、20日締めの納品日から機械的に作る。
  // 表示上は年・月のプルダウン2つだけにして、締め日の内訳(5/21〜6/20など)は
  // 裏側の絞り込み計算にのみ使う(見た目には出さない)。
  //
  // 2026-08-03追記: 当初は受注日(order_date)基準で期間を作っていたが、姉妹アプリ
  // sales-dashboard(月次売上集計)の数値と突き合わせたところ、受注日基準だと月によって
  // 数%〜50%以上の差が出ていた。原因を調査した結果、sales-dashboard側は納品日
  // (delivery_date)基準で月度を集計していることが判明。受注してから納品までにタイム
  // ラグがあるため、特に月末・月初にまたがる受注は「受注日基準の月度」と「納品日基準の
  // 月度」がずれる。納品日基準に揃えたところ、ほぼ全ての月で差が1〜1.5%以内に収まる
  // ことを確認できたため、期間の絞り込みは納品日基準に変更した。
  const availablePeriods = useMemo(() => {
    const keys = new Set<string>();
    orders.forEach((o) => {
      if (o.delivery_date) keys.add(periodKeyFor(o.delivery_date));
    });
    return Array.from(keys).sort((a, b) => b.localeCompare(a));
  }, [orders]);

  const availableYears = useMemo(() => {
    const ys = new Set(availablePeriods.map((k) => k.slice(0, 4)));
    return Array.from(ys).sort((a, b) => b.localeCompare(a));
  }, [availablePeriods]);

  // 決算期(10月始まり、9/21〜翌9/20が1期)単位での「今期」「前期」切り替え用。
  const availableFiscalYears = useMemo(() => {
    const ys = new Set(availablePeriods.map((k) => fiscalYearStartOf(k)));
    return Array.from(ys).sort((a, b) => b - a);
  }, [availablePeriods]);
  // 2026-09-07修正(重要): 以前は「データに含まれる決算期の期首年を新しい順に
  // 並べ、先頭を今期として扱う」方式だったが、この方式だと月末に翌月分の予定
  // 出荷などがdelivery_date=9/21以降(=次の決算期扱い)で1件でも登録されると、
  // その1件だけを理由に「今期」がまるごと1年先の決算期にすり替わってしまう
  // 不具合があった。
  // 実例: 2026-09-30納品の148件(東京拠点、合計利益359,709円)が売上データに
  // 含まれていただけで、periodKeyFor()が9/21以降を翌月度(202610)扱いにし、
  // fiscalYearStartOf(202610)が2026年10月期と判定するため、経営マトリクスの
  // 「今期」が実績のほとんど無い2026年10月期に切り替わり、本来の実績
  // (2025年10月期、実際の売上・利益のほぼ全て)が丸ごと「前期」扱いになって、
  // 経営マトリクスがほぼ空(359,709円の1マスだけ)に見えてしまっていた。
  // 決算期は本来カレンダー上の「今日がいつか」で決まるものなので、データの
  // 中身(に紛れ込む数件の未来日付)に左右されず、常に「今日」を基準に今期を
  // 決める方式に変更する。前期は「今期の1年前」だが、実際にその期のデータが
  // 無ければ(前期データ未アップロードなど)従来通りボタン自体を出さない。
  const todayFYStart = useMemo(() => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;
    return fiscalYearStartOf(periodKeyFor(todayStr));
  }, []);
  const currentFYStart = todayFYStart;
  const previousFYStart = availableFiscalYears.includes(todayFYStart - 1) ? todayFYStart - 1 : undefined;

  type PeriodMode = "all" | "fy-current" | "fy-previous" | "month";

  const filterCardRef = useRef<HTMLDivElement>(null);

  const [branch, setBranch] = useState("");
  const [rep, setRep] = useState("");
  const [periodMode, setPeriodMode] = useState<PeriodMode>(() =>
    availableFiscalYears.length ? "fy-current" : "all"
  );
  const [periodKey, setPeriodKey] = useState(""); // periodMode === "month" のときだけ使う
  const [dimension, setDimension] = useState<Dimension>("order");
  // 2026-10-07変更: 「得意先名・得意先コード・受注番号・物件名」をまとめた1つの検索欄だと、
  // 同じ文字列が複数の項目に偶然マッチして絞り込みにくい(かつ入力欄に枠が無く検索エリアと
  // 気づきにくい)という指摘を受け、項目ごとに別々の検索欄に分けた(複数入力時はAND絞り込み)。
  const [customerNameQuery, setCustomerNameQuery] = useState("");
  const [customerCodeQuery, setCustomerCodeQuery] = useState("");
  const [orderNoQuery, setOrderNoQuery] = useState("");
  const [projectNameQuery, setProjectNameQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [sortDir, setSortDir] = useState<1 | -1>(1); // 1=小さい順(赤字が上), -1=大きい順

  // 2026-10-07追加: 受注番号別内訳の「詳細」ボタン用。品番単位の明細(v_profit_lines)を
  // クリック時に1回だけ取得し、受注番号をキーに結果をキャッシュしておく(同じ受注を
  // 開き直すたびに再取得しない)。
  type OrderDetailState =
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "done"; rows: ProfitOrderLineDetail[] };
  const [expandedOrderNo, setExpandedOrderNo] = useState<string | null>(null);
  const [orderDetails, setOrderDetails] = useState<Record<string, OrderDetailState>>({});

  async function loadOrderDetail(orderNo: string) {
    setOrderDetails((prev) => ({ ...prev, [orderNo]: { status: "loading" } }));
    try {
      const res = await fetch(`/api/profit-order-detail?order_no=${encodeURIComponent(orderNo)}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOrderDetails((prev) => ({
          ...prev,
          [orderNo]: { status: "error", message: json?.error ?? "取得に失敗しました" },
        }));
        return;
      }
      setOrderDetails((prev) => ({ ...prev, [orderNo]: { status: "done", rows: json.rows ?? [] } }));
    } catch (e) {
      setOrderDetails((prev) => ({
        ...prev,
        [orderNo]: { status: "error", message: e instanceof Error ? e.message : String(e) },
      }));
    }
  }

  function toggleOrderDetail(orderNo: string) {
    if (expandedOrderNo === orderNo) {
      setExpandedOrderNo(null);
      return;
    }
    setExpandedOrderNo(orderNo);
    if (!orderDetails[orderNo]) {
      loadOrderDetail(orderNo);
    }
  }

  const selectedYear = periodMode === "month" ? periodKey.slice(0, 4) : "";
  const selectedMonth = periodMode === "month" ? periodKey.slice(4, 6) : "";

  const monthsForSelectedYear = useMemo(() => {
    if (!selectedYear) return [];
    return availablePeriods
      .filter((k) => k.startsWith(selectedYear))
      .map((k) => k.slice(4, 6))
      .sort();
  }, [availablePeriods, selectedYear]);

  function handleYearChange(y: string) {
    if (!y) {
      setPeriodMode("all");
      setPeriodKey("");
      return;
    }
    const months = availablePeriods
      .filter((k) => k.startsWith(y))
      .map((k) => k.slice(4, 6))
      .sort();
    const month = months.includes(selectedMonth) ? selectedMonth : months[months.length - 1] ?? "";
    setPeriodMode("month");
    setPeriodKey(month ? `${y}${month}` : "");
  }

  function handleMonthChange(m: string) {
    if (!selectedYear || !m) return;
    setPeriodMode("month");
    setPeriodKey(`${selectedYear}${m}`);
  }

  function resetFilters() {
    setBranch("");
    setRep("");
    setCustomerNameQuery("");
    setCustomerCodeQuery("");
    setOrderNoQuery("");
    setProjectNameQuery("");
    setDimension("order");
    setPeriodMode(availableFiscalYears.length ? "fy-current" : "all");
    setPeriodKey("");
    setSortKey("profit");
    setSortDir(1);
    setExpandedOrderNo(null);
  }

  const { from: dateFrom, to: dateTo } = useMemo(() => {
    if (periodMode === "month") {
      if (!periodKey) return { from: "", to: "" };
      return periodRangeFor(periodKey);
    }
    if (periodMode === "fy-current" && currentFYStart !== undefined) {
      return fiscalYearRangeFor(currentFYStart);
    }
    if (periodMode === "fy-previous" && previousFYStart !== undefined) {
      return fiscalYearRangeFor(previousFYStart);
    }
    return { from: "", to: "" };
  }, [periodMode, periodKey, currentFYStart, previousFYStart]);

  const branches = useMemo(() => uniqueSortedNumeric(orders.map((o) => o.branch_code)), [orders]);
  // 2026-08-28変更: 「拠点を選んだら、拠点の担当者だけを選べるようにして」に対応。
  // 拠点が選択されているときは、その拠点に所属する受注が実際にある担当だけに絞る
  // (拠点未選択時は従来通り全担当を表示)。
  const reps = useMemo(() => {
    const source = branch ? orders.filter((o) => o.branch_code === branch) : orders;
    return uniqueSortedNumeric(source.map((o) => o.rep_code));
  }, [orders, branch]);

  const filtered = useMemo(() => {
    const qName = customerNameQuery.trim().toLowerCase();
    const qCode = customerCodeQuery.trim().toLowerCase();
    const qOrder = orderNoQuery.trim().toLowerCase();
    const qProject = projectNameQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (branch && o.branch_code !== branch) return false;
      if (rep && o.rep_code !== rep) return false;
      if (dateFrom && (!o.delivery_date || o.delivery_date < dateFrom)) return false;
      if (dateTo && (!o.delivery_date || o.delivery_date > dateTo)) return false;
      if (qName && !(o.customer_name ?? "").toLowerCase().includes(qName)) return false;
      if (qCode && !(o.customer_code ?? "").toLowerCase().includes(qCode)) return false;
      if (qOrder && !o.order_no.toLowerCase().includes(qOrder)) return false;
      if (qProject && !(o.project_name ?? "").toLowerCase().includes(qProject)) return false;
      return true;
    });
  }, [orders, branch, rep, dateFrom, dateTo, customerNameQuery, customerCodeQuery, orderNoQuery, projectNameQuery]);

  // 2026-08-28追加: 「内訳の得意先をクリックやチェックで検索窓に転記するようにして」に対応。
  // 下の「◯◯別 内訳」テーブルで得意先名をクリックすると、得意先コード(無ければ得意先名)の
  // 検索欄に入れて、明細まで絞り込めるようにする。得意先コードは数字のみのため、数字だけの
  // 値はコード欄、それ以外は名前欄に入れる。
  function selectCustomerInSearch(code: string) {
    if (!code) return;
    if (/^\d+$/.test(code)) {
      setCustomerCodeQuery(code);
      setCustomerNameQuery("");
    } else {
      setCustomerNameQuery(code);
      setCustomerCodeQuery("");
    }
    filterCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, o) => {
        acc.revenue += o.revenue;
        acc.cost += o.cost;
        acc.profit += o.profit;
        acc.unconfirmedCostRevenue += o.unconfirmed_cost_revenue ?? 0;
        acc.unconfirmedCostLineCount += o.unconfirmed_cost_line_count ?? 0;
        return acc;
      },
      { revenue: 0, cost: 0, profit: 0, unconfirmedCostRevenue: 0, unconfirmedCostLineCount: 0 }
    );
  }, [filtered]);

  const groups: GroupRow[] = useMemo(() => {
    if (dimension === "order") {
      return filtered.map((o) => ({
        key: o.order_no,
        label: o.order_no,
        orderCount: 1,
        revenue: o.revenue,
        cost: o.cost,
        profit: o.profit,
        customerCode: o.customer_code,
        customerName: o.customer_name,
        branchCode: o.branch_code,
        repCode: o.rep_code,
        projectName: o.project_name,
        unconfirmedCostLineCount: o.unconfirmed_cost_line_count,
        unconfirmedCostRevenue: o.unconfirmed_cost_revenue,
      }));
    }
    if (dimension === "customer") {
      return groupOrders(
        filtered,
        (o) => o.customer_code || o.customer_name || "(得意先不明)",
        (o) => {
          if (o.customer_name && o.customer_code) return `${o.customer_name}(${o.customer_code})`;
          return o.customer_name || o.customer_code || "(得意先不明)";
        }
      );
    }
    if (dimension === "project") {
      return groupOrders(
        filtered,
        (o) => o.project_name || "__NONE__",
        (o) => o.project_name || "(物件なし・通常売上)"
      );
    }
    // rep
    return groupOrders(
      filtered,
      (o) => o.rep_code || "__NONE__",
      (o) => repLabel(o.rep_code)
    );
  }, [filtered, dimension]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1) as 1 | -1);
    } else {
      setSortKey(key);
      setSortDir(1);
    }
  }
  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === 1 ? "▴" : "▾") : "");

  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => (a[sortKey] - b[sortKey]) * sortDir);
  }, [groups, sortKey, sortDir]);

  function downloadCsv() {
    if (!sortedGroups.length) return;
    const dimLabel = DIMENSIONS.find((d) => d.key === dimension)?.label ?? "";
    const periodLabel =
      periodMode === "month" && periodKey
        ? `${selectedYear}年${parseInt(selectedMonth, 10)}月`
        : periodMode === "fy-current" && currentFYStart !== undefined
        ? fiscalYearLabel(currentFYStart)
        : periodMode === "fy-previous" && previousFYStart !== undefined
        ? fiscalYearLabel(previousFYStart)
        : "全期間";

    if (dimension === "order") {
      const headers = ["得意先コード", "得意先", "拠点", "担当", "受注番号", "物件名", "売上計", "原価計", "利益", "利益率(%)"];
      const lines = [headers.map(csvEscape).join(",")];
      sortedGroups.forEach((g) => {
        const m = marginPct(g.revenue, g.profit);
        lines.push(
          [
            g.customerCode ?? "",
            g.customerName ?? "",
            branchLabel(g.branchCode ?? null),
            repLabel(g.repCode ?? null),
            g.label,
            g.projectName ?? "",
            Math.round(g.revenue),
            Math.round(g.cost),
            Math.round(g.profit),
            m === null ? "" : m.toFixed(1),
          ]
            .map(csvEscape)
            .join(",")
        );
      });
      const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `売上利益_受注別_${periodLabel}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }

    const headers = [dimLabel, "受注件数", "売上", "原価", "利益", "利益率(%)"];
    const lines = [headers.map(csvEscape).join(",")];
    sortedGroups.forEach((g) => {
      const m = marginPct(g.revenue, g.profit);
      lines.push(
        [g.label, g.orderCount, Math.round(g.revenue), Math.round(g.cost), Math.round(g.profit), m === null ? "" : m.toFixed(1)]
          .map(csvEscape)
          .join(",")
      );
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `売上利益_${dimLabel}別_${periodLabel}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rk">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h1>売上利益</h1>
        <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
          <CrossPageNav current="profit" />
          <Link href="/dx/upload" className="ghost-btn" style={{ textDecoration: "none" }}>
            データ更新
          </Link>
          <Link href="/menu" className="ghost-btn" style={{ textDecoration: "none" }}>
            ← メインメニュー
          </Link>
        </div>
      </div>
      {headerExtra}
      <p className="subtitle">
        受注番号・件名(物件)単位で売上・原価・利益を検索・比較できる明細ツールです。受注番号・得意先・物件・担当のいずれかの単位で切り替えて見られます。
        原価は、在庫区分は売上データの原価、メーカー直送・手配区分は仕入データとの受注番号・行番号一致による実績原価(見つからない場合は売上データの原価で代用)を使っています。
        運賃・値引き等の商品外行も、実際の売上への影響としてそのまま含めています。
        年・月の絞り込みは納品日(20日締め)基準です(sales-dashboardの月次売上集計と基準を揃えています)。
        拠点別・担当別・得意先別の今期/前期比較は経営レポート・拠点/営業/得意先 利益でご確認ください。
        {maxOrderDate && <> データの最新受注日: {maxOrderDate}</>}
        {maxDeliveryDate && <> / 最新納品日: {maxDeliveryDate}</>}
      </p>

      <div className="card" style={{ marginBottom: 20 }} ref={filterCardRef}>
        <h2 style={{ marginTop: 0 }}>絞り込み・表示単位</h2>
        <div className="filter-row">
          <div className="filter-field">
            <label>拠点</label>
            <select
              value={branch}
              onChange={(e) => {
                setBranch(e.target.value);
                // 拠点を変えたら、担当は選び直してもらう(前の拠点の担当が
                // 新しい拠点にいないことがあるため、選択済みの値を引きずらない)。
                setRep("");
              }}
            >
              <option value="">すべて</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {branchLabel(b)}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label>担当</label>
            <select value={rep} onChange={(e) => setRep(e.target.value)}>
              <option value="">すべて</option>
              {reps.map((r) => (
                <option key={r} value={r}>
                  {repLabel(r)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          style={{
            marginTop: 12,
            padding: "12px 14px",
            border: "1px solid var(--rk-border)",
            borderRadius: 8,
            background: "var(--rk-bg)",
          }}
        >
          <label style={{ fontSize: 11.5, color: "var(--rk-text-muted)", display: "block", marginBottom: 8 }}>
            検索(複数入力時はすべてに一致する行だけ表示)
          </label>
          <div className="filter-row">
            <div className="filter-field">
              <label>得意先名</label>
              <input
                type="text"
                value={customerNameQuery}
                onChange={(e) => setCustomerNameQuery(e.target.value)}
                placeholder="例: イオン"
                style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--rk-border)", borderRadius: 6, fontSize: 12.5 }}
              />
            </div>
            <div className="filter-field">
              <label>得意先コード</label>
              <input
                type="text"
                value={customerCodeQuery}
                onChange={(e) => setCustomerCodeQuery(e.target.value)}
                placeholder="例: 2130029365"
                style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--rk-border)", borderRadius: 6, fontSize: 12.5 }}
              />
            </div>
            <div className="filter-field">
              <label>受注番号</label>
              <input
                type="text"
                value={orderNoQuery}
                onChange={(e) => setOrderNoQuery(e.target.value)}
                placeholder="例: 2130030434"
                style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--rk-border)", borderRadius: 6, fontSize: 12.5 }}
              />
            </div>
            <div className="filter-field">
              <label>物件名</label>
              <input
                type="text"
                value={projectNameQuery}
                onChange={(e) => setProjectNameQuery(e.target.value)}
                placeholder="例: 〇〇工事"
                style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--rk-border)", borderRadius: 6, fontSize: 12.5 }}
              />
            </div>
          </div>
        </div>

        <div className="filter-row" style={{ marginTop: 10 }}>
          <div className="filter-field" style={{ gridColumn: "span 4" }}>
            <label>期間(決算期・10月始まり)</label>
            <div className="segmented">
              <button type="button" className={periodMode === "all" ? "active" : ""} onClick={() => setPeriodMode("all")}>
                全期間
              </button>
              {currentFYStart !== undefined && (
                <button
                  type="button"
                  className={periodMode === "fy-current" ? "active" : ""}
                  onClick={() => setPeriodMode("fy-current")}
                >
                  今期({fiscalYearLabel(currentFYStart)})
                </button>
              )}
              {previousFYStart !== undefined ? (
                <button
                  type="button"
                  className={periodMode === "fy-previous" ? "active" : ""}
                  onClick={() => setPeriodMode("fy-previous")}
                >
                  前期({fiscalYearLabel(previousFYStart)})
                </button>
              ) : (
                <span className="cell-sub">前期データは未アップロードです</span>
              )}
            </div>
          </div>
        </div>
        <div className="filter-row" style={{ marginTop: 10 }}>
          <div className="filter-field">
            <label>年(特定の月を指定)</label>
            <select value={selectedYear} onChange={(e) => handleYearChange(e.target.value)}>
              <option value="">—</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}年
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label>月</label>
            <select value={selectedMonth} onChange={(e) => handleMonthChange(e.target.value)} disabled={!selectedYear}>
              {!selectedYear && <option value="">—</option>}
              {monthsForSelectedYear.map((m) => (
                <option key={m} value={m}>
                  {parseInt(m, 10)}月
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field" style={{ gridColumn: "span 2" }}>
            <label>表示単位</label>
            <div className="segmented">
              {DIMENSIONS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={dimension === d.key ? "active" : ""}
                  onClick={() => setDimension(d.key)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="filter-actions">
          <div style={{ display: "flex", gap: 10 }}>
            <button className="ghost-btn" onClick={resetFilters}>
              絞り込みをリセット
            </button>
            <button className="ghost-btn" onClick={downloadCsv} disabled={!sortedGroups.length}>
              この一覧をCSVでダウンロード
            </button>
          </div>
          <span className="result-count">{sortedGroups.length.toLocaleString("ja-JP")}件を表示中</span>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi-tile">
          <div className="label">売上合計</div>
          <div className="value">{fmtYen(totals.revenue)}</div>
        </div>
        <div className="kpi-tile">
          <div className="label">原価合計</div>
          <div className="value">{fmtYen(totals.cost)}</div>
        </div>
        <div className="kpi-tile">
          <div className="label">利益合計</div>
          <div className="value" style={{ color: totals.profit < 0 ? "var(--rk-critical)" : undefined }}>
            {fmtYen(totals.profit)}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="label">利益率</div>
          <div className="value">{fmtPct(marginPct(totals.revenue, totals.profit))}</div>
        </div>
      </div>

      {totals.unconfirmedCostLineCount > 0 && (
        <div className="card" style={{ marginBottom: 20, padding: "12px 16px", background: "rgba(220,180,40,0.08)" }}>
          <span className="badge warning">原価未確定</span>
          <span style={{ marginLeft: 8 }}>
            この絞り込みの中に、仕入・原価がまだ確定していない売上が {totals.unconfirmedCostLineCount.toLocaleString("ja-JP")}
            件(売上額 {fmtYen(totals.unconfirmedCostRevenue)})含まれています。該当ぶんは原価不明のため、暫定的に「原価=売上(利益0円)」として上記の利益・利益率を計算しています。実際の仕入が判明すると、対象の受注・得意先・担当の利益は変わる可能性があります。一覧内の「原価未確定」マーク付き行が該当します。
          </span>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>
          {DIMENSIONS.find((d) => d.key === dimension)?.label}別 内訳
          <span className="cell-sub" style={{ marginLeft: 12, fontWeight: 400 }}>
            「売上計」「利益」の見出しをクリックで並び替え
          </span>
        </h2>

        {dimension === "order" ? (
          <div className="record-panel">
            <div className="record-head">
              <div className="record-head-line">
                <span>得意先コード</span>
                <span>得意先</span>
                <span>拠点</span>
                <span>担当</span>
                <span>受注番号</span>
              </div>
              <div className="record-head-line">
                <span>物件名</span>
                <span className="sortable-field" onClick={() => toggleSort("revenue")}>
                  売上計 {sortArrow("revenue")}
                </span>
                <span>原価計</span>
                <span className="sortable-field" onClick={() => toggleSort("profit")}>
                  利益 {sortArrow("profit")}
                </span>
                <span>利益率</span>
              </div>
            </div>
            <div className="record-body">
              {sortedGroups.length === 0 && <div className="empty-state">この条件に一致するデータはありません</div>}
              {sortedGroups.map((g) => {
                const m = marginPct(g.revenue, g.profit);
                return (
                  <div className="record-item" key={g.key}>
                    <div className="record-line">
                      <span className="rf-value">{g.customerCode || "—"}</span>
                      <span
                        className={g.customerCode || g.customerName ? "rf-value clickable-cell" : "rf-value"}
                        onClick={
                          g.customerCode || g.customerName
                            ? () => selectCustomerInSearch(g.customerCode || g.customerName || "")
                            : undefined
                        }
                      >
                        {g.customerName || "—"}
                      </span>
                      <span className="rf-value">{branchLabel(g.branchCode ?? null)}</span>
                      <span className="rf-value">{repLabel(g.repCode ?? null)}</span>
                      <span className="rf-value">
                        {g.label}
                        {!!g.unconfirmedCostLineCount && (
                          <span
                            className="badge warning"
                            style={{ marginLeft: 6, padding: "0 5px", fontSize: 10 }}
                            title={`原価未確定売上 ${fmtYen(g.unconfirmedCostRevenue ?? 0)}を含む。原価が未登録のため暫定的に利益0円として計算しています。`}
                          >
                            原価未確定
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="record-line">
                      <span className="rf-value">{g.projectName || "(通常売上)"}</span>
                      <span className="rf-value num">{fmtYen(g.revenue)}</span>
                      <span className="rf-value num">{fmtYen(g.cost)}</span>
                      <span
                        className="rf-value num"
                        style={{ color: g.profit < 0 ? "var(--rk-critical)" : undefined, fontWeight: 600 }}
                      >
                        {fmtYen(g.profit)}
                      </span>
                      <span className="rf-value num">{fmtPct(m)}</span>
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <button
                        type="button"
                        className="ghost-btn"
                        style={{ padding: "3px 10px", fontSize: 11.5 }}
                        onClick={() => toggleOrderDetail(g.key)}
                      >
                        {expandedOrderNo === g.key ? "閉じる" : "詳細"}
                      </button>
                    </div>
                    {expandedOrderNo === g.key && (
                      <div style={{ marginTop: 8, padding: "10px 12px", background: "var(--rk-bg)", borderRadius: 6 }}>
                        {(() => {
                          const state = orderDetails[g.key];
                          if (!state || state.status === "loading") {
                            return (
                              <p className="empty-state" style={{ padding: "10px 0" }}>
                                <span className="spinner" /> 明細を読み込み中…
                              </p>
                            );
                          }
                          if (state.status === "error") {
                            return (
                              <div>
                                <p style={{ margin: 0, color: "var(--rk-critical)" }}>
                                  明細の取得に失敗しました: {state.message}
                                </p>
                                <button
                                  type="button"
                                  className="ghost-btn"
                                  style={{ marginTop: 6 }}
                                  onClick={() => loadOrderDetail(g.key)}
                                >
                                  もう一度読み込む
                                </button>
                              </div>
                            );
                          }
                          if (state.rows.length === 0) {
                            return (
                              <p className="empty-state" style={{ padding: "10px 0" }}>
                                明細が見つかりませんでした
                              </p>
                            );
                          }
                          return (
                            <div className="table-scroll">
                              <table style={{ minWidth: 760 }}>
                                <thead>
                                  <tr>
                                    <th>品番</th>
                                    <th>品名</th>
                                    <th>手配区分</th>
                                    <th className="num">数量</th>
                                    <th className="num">単価</th>
                                    <th className="num">売上</th>
                                    <th className="num">原価</th>
                                    <th className="num">利益</th>
                                    <th>原価の根拠</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {state.rows.map((r) => (
                                    <tr key={r.sales_line_id}>
                                      <td>{r.item_code || "—"}</td>
                                      <td className="wrap-2line-cell">{r.item_name || "—"}</td>
                                      <td>{r.arrange_type || "—"}</td>
                                      <td className="num">{r.qty.toLocaleString("ja-JP")}</td>
                                      <td className="num">{fmtYen(r.sell_price)}</td>
                                      <td className="num">{fmtYen(r.revenue)}</td>
                                      <td className="num">{fmtYen(r.cost)}</td>
                                      <td
                                        className="num"
                                        style={{ color: r.profit < 0 ? "var(--rk-critical)" : undefined, fontWeight: 600 }}
                                      >
                                        {fmtYen(r.profit)}
                                      </td>
                                      <td className="cell-sub">{r.cost_source || "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{DIMENSIONS.find((d) => d.key === dimension)?.label}</th>
                  <th className="num">受注件数</th>
                  <th className="num sortable-th" onClick={() => toggleSort("revenue")}>
                    売上 {sortArrow("revenue")}
                  </th>
                  <th className="num">原価</th>
                  <th className="num sortable-th" onClick={() => toggleSort("profit")}>
                    利益 {sortArrow("profit")}
                  </th>
                  <th className="num">利益率</th>
                </tr>
              </thead>
              <tbody>
                {sortedGroups.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      この条件に一致するデータはありません
                    </td>
                  </tr>
                )}
                {sortedGroups.map((g) => {
                  const m = marginPct(g.revenue, g.profit);
                  return (
                    <tr key={g.key}>
                      <td>
                        {dimension === "customer" && g.key !== "(得意先不明)" ? (
                          <span className="clickable-cell" onClick={() => selectCustomerInSearch(g.key)}>
                            {g.label}
                          </span>
                        ) : (
                          g.label
                        )}
                        {!!g.unconfirmedCostLineCount && (
                          <span
                            className="badge warning"
                            style={{ marginLeft: 6, padding: "0 5px", fontSize: 10 }}
                            title={`原価未確定売上 ${fmtYen(g.unconfirmedCostRevenue ?? 0)}(${g.unconfirmedCostLineCount}件)を含む。原価が未登録のため暫定的に利益0円として計算しています。`}
                          >
                            原価未確定
                          </span>
                        )}
                      </td>
                      <td className="num">{g.orderCount.toLocaleString("ja-JP")}</td>
                      <td className="num">{fmtYen(g.revenue)}</td>
                      <td className="num">{fmtYen(g.cost)}</td>
                      <td className="num" style={{ color: g.profit < 0 ? "var(--rk-critical)" : undefined, fontWeight: 600 }}>
                        {fmtYen(g.profit)}
                      </td>
                      <td className="num">{fmtPct(m)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
