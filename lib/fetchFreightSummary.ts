// 「運賃 売上・仕入」画面用のデータ取得・集計。
// 運賃は品番(item_code/product_code)="99"で識別する(buildStockMovement.tsで既に
// 確認済みのコード)。細かい除外条件などは設けず、単純にコード99の行を売上・仕入
// それぞれ全件集計するだけの画面。
//
// 期(会計年度)は、社内間金額機能などと同じ「20日締め」ルール(lib/period.ts)で
// 判定する。売上側は納品年月日(delivery_date、他機能でも金額集計に使っている基準日)、
// 仕入側は仕入年月日(purchase_date)を使う。

import { unstable_cache } from "next/cache";
import { getSupabaseServerClient } from "./supabaseServer";
import { fetchAllPagesConcurrent } from "./fetchPaged";
import { SALES_DATA_CACHE_TAG } from "./salesDataCache";
import { branchNameOnly } from "./branch-names";
import { repNameOnly } from "./rep-names";
import { periodKeyFor, fiscalYearStartOf, fiscalYearLabel } from "./period";

const PAGE_SIZE = 1000;
const FREIGHT_CODE = "99";

type FreightSalesRow = {
  branch_code: string | null;
  rep_code: string | null;
  customer_code: string | null;
  customer_name: string | null;
  qty: number | null;
  sell_price: number | null;
  delivery_date: string | null;
};

type FreightPurchaseRow = {
  location_code: string | null;
  staff_code: string | null;
  customer_code: string | null;
  customer_name: string | null;
  amount: number;
  purchase_date: string | null;
};

async function fetchFreightSalesRowsUncached(): Promise<FreightSalesRow[]> {
  const supabase = getSupabaseServerClient();
  return fetchAllPagesConcurrent<FreightSalesRow>(
    (from, to) =>
      supabase
        .from("sales_lines")
        .select("branch_code, rep_code, customer_code, customer_name, qty, sell_price, delivery_date")
        .eq("item_code", FREIGHT_CODE)
        .order("id", { ascending: true })
        .range(from, to),
    { pageSize: PAGE_SIZE, concurrency: 8 }
  );
}
export const fetchFreightSalesRows = unstable_cache(fetchFreightSalesRowsUncached, ["fetchFreightSalesRows"], {
  tags: [SALES_DATA_CACHE_TAG],
  revalidate: false,
});

async function fetchFreightPurchaseRowsUncached(): Promise<FreightPurchaseRow[]> {
  const supabase = getSupabaseServerClient();
  return fetchAllPagesConcurrent<FreightPurchaseRow>(
    (from, to) =>
      supabase
        .from("purchases")
        .select("location_code, staff_code, customer_code, customer_name, amount, purchase_date")
        .eq("product_code", FREIGHT_CODE)
        .order("id", { ascending: true })
        .range(from, to),
    { pageSize: PAGE_SIZE, concurrency: 8 }
  );
}
export const fetchFreightPurchaseRows = unstable_cache(fetchFreightPurchaseRowsUncached, ["fetchFreightPurchaseRows"], {
  tags: [SALES_DATA_CACHE_TAG],
  revalidate: false,
});

export type FreightGroupRow = {
  code: string;
  label: string;
  salesAmount: number;
  salesCount: number;
  purchaseAmount: number;
  purchaseCount: number;
  grossProfit: number; // 粗利 = 売上運賃 - 仕入運賃
  grossProfitRate: number | null; // 粗利率 = 粗利 / 売上運賃(売上運賃が0の場合はnull)
};

export type FreightSummary = {
  total: FreightGroupRow;
  byBranch: FreightGroupRow[];
  byRep: FreightGroupRow[];
  byCustomer: FreightGroupRow[];
};

export type FreightSummaryByPeriod = {
  fiscalYearStart: number; // 期首の西暦年
  label: string; // 「2025年10月期(2025/10〜2026/9)」
  summary: FreightSummary;
};

const UNKNOWN_CODE = "(不明)";

function withProfit(row: Omit<FreightGroupRow, "grossProfit" | "grossProfitRate">): FreightGroupRow {
  const grossProfit = row.salesAmount - row.purchaseAmount;
  const grossProfitRate = row.salesAmount !== 0 ? grossProfit / row.salesAmount : null;
  return { ...row, grossProfit, grossProfitRate };
}

function buildGroup(
  salesRows: FreightSalesRow[],
  purchaseRows: FreightPurchaseRow[],
  salesKeyOf: (r: FreightSalesRow) => string,
  purchaseKeyOf: (r: FreightPurchaseRow) => string,
  labelOf: (code: string, salesRow: FreightSalesRow | null, purchaseRow: FreightPurchaseRow | null) => string
): FreightGroupRow[] {
  type Acc = { code: string; label: string; salesAmount: number; salesCount: number; purchaseAmount: number; purchaseCount: number };
  const map = new Map<string, Acc>();
  const sampleSales = new Map<string, FreightSalesRow>();
  const samplePurchase = new Map<string, FreightPurchaseRow>();

  for (const r of salesRows) {
    const code = salesKeyOf(r) || UNKNOWN_CODE;
    if (!sampleSales.has(code)) sampleSales.set(code, r);
    const g = map.get(code) ?? { code, label: code, salesAmount: 0, salesCount: 0, purchaseAmount: 0, purchaseCount: 0 };
    g.salesAmount += (r.qty ?? 0) * (r.sell_price ?? 0);
    g.salesCount += 1;
    map.set(code, g);
  }
  for (const r of purchaseRows) {
    const code = purchaseKeyOf(r) || UNKNOWN_CODE;
    if (!samplePurchase.has(code)) samplePurchase.set(code, r);
    const g = map.get(code) ?? { code, label: code, salesAmount: 0, salesCount: 0, purchaseAmount: 0, purchaseCount: 0 };
    g.purchaseAmount += r.amount ?? 0;
    g.purchaseCount += 1;
    map.set(code, g);
  }

  for (const [code, g] of map) {
    g.label = labelOf(code, sampleSales.get(code) ?? null, samplePurchase.get(code) ?? null);
  }

  return Array.from(map.values())
    .map(withProfit)
    .sort((a, b) => b.salesAmount + b.purchaseAmount - (a.salesAmount + a.purchaseAmount));
}

export function buildFreightSummary(
  salesRows: FreightSalesRow[],
  purchaseRows: FreightPurchaseRow[]
): FreightSummary {
  const total = withProfit({
    code: "ALL",
    label: "合計",
    salesAmount: salesRows.reduce((s, r) => s + (r.qty ?? 0) * (r.sell_price ?? 0), 0),
    salesCount: salesRows.length,
    purchaseAmount: purchaseRows.reduce((s, r) => s + (r.amount ?? 0), 0),
    purchaseCount: purchaseRows.length,
  });

  const byBranch = buildGroup(
    salesRows,
    purchaseRows,
    (r) => r.branch_code ?? "",
    (r) => r.location_code ?? "",
    (code) => (code === UNKNOWN_CODE ? code : branchNameOnly(code))
  );

  const byRep = buildGroup(
    salesRows,
    purchaseRows,
    (r) => r.rep_code ?? "",
    (r) => r.staff_code ?? "",
    (code) => (code === UNKNOWN_CODE ? code : repNameOnly(code))
  );

  const byCustomer = buildGroup(
    salesRows,
    purchaseRows,
    (r) => r.customer_code ?? "",
    (r) => r.customer_code ?? "",
    (code, salesRow, purchaseRow) =>
      code === UNKNOWN_CODE ? code : salesRow?.customer_name ?? purchaseRow?.customer_name ?? code
  );

  return { total, byBranch, byRep, byCustomer };
}

function fiscalYearStartFor(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return fiscalYearStartOf(periodKeyFor(dateStr));
}

// 売上(delivery_date)・仕入(purchase_date)を20日締めルールで期(会計年度)に振り分け、
// データが存在する期ごとに合計・拠点別・担当別・得意先別の集計を作る。新しい期が先。
export function buildFreightSummaryByPeriod(
  salesRows: FreightSalesRow[],
  purchaseRows: FreightPurchaseRow[]
): FreightSummaryByPeriod[] {
  const salesByYear = new Map<number, FreightSalesRow[]>();
  for (const r of salesRows) {
    const y = fiscalYearStartFor(r.delivery_date);
    if (y === null) continue;
    if (!salesByYear.has(y)) salesByYear.set(y, []);
    salesByYear.get(y)!.push(r);
  }

  const purchaseByYear = new Map<number, FreightPurchaseRow[]>();
  for (const r of purchaseRows) {
    const y = fiscalYearStartFor(r.purchase_date);
    if (y === null) continue;
    if (!purchaseByYear.has(y)) purchaseByYear.set(y, []);
    purchaseByYear.get(y)!.push(r);
  }

  const years = Array.from(new Set([...salesByYear.keys(), ...purchaseByYear.keys()])).sort((a, b) => b - a);

  return years.map((y) => ({
    fiscalYearStart: y,
    label: fiscalYearLabel(y),
    summary: buildFreightSummary(salesByYear.get(y) ?? [], purchaseByYear.get(y) ?? []),
  }));
}
