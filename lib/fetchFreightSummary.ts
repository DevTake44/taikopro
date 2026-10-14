// 「運賃 売上・仕入」画面用のデータ取得・集計。
//
// 2026-10-14改修: 以前はsales_lines(item_code=99)とpurchases(product_code=99)を
// 拠点別・担当別・得意先別にそれぞれ独立して合計していたが、これだと「仕入先への
// 支払い(仕入運賃)」と「運送会社(西濃・福山)への実費」を両方とも同じ運賃売上と
// 突き合わせてしまい、どちらも黒字に見えてしまう不具合があった
// (例: 売上1,000・仕入運賃800・運送会社運賃800の伝票は、本来は仕入計1,600で赤字▲600
// なのに、仕入運賃だけなら+200、運送会社運賃だけでも+200に見えてしまう)。
//
// そのため、DB側でまず受注番号(伝票)単位に売上・仕入先運賃・運送会社運賃を
// 突き合わせてから(v_freight_profit_by_order_mv)、期間×拠点×担当×得意先に集計した
// ビュー(v_freight_profit_summary_mv)を作り、ここではそれを取得して画面表示用に
// 再集計するだけにした。損益の計算自体はDB側のビューで完結している。
//
// 【重要】当初はプレーンview(v_freight_profit_by_order/v_freight_profit_summary)で
// 作ったが、アクセスのたびに受注番号単位の重い集計(sales_lines 151,680行・
// purchases 134,006行のUNION・集計)を再計算することになり、PostgRESTの
// statement_timeout(2分)を超えてタイムアウトしていた。v_profit_lines等と同じく
// マテリアライズドビュー化し、「更新」ボタン(refresh_freight_profit_views)でのみ
// 再計算するようにした(2026-10-14)。

import { unstable_cache } from "next/cache";
import { getSupabaseServerClient } from "./supabaseServer";
import { fetchAllPagesConcurrent } from "./fetchPaged";
import { SALES_DATA_CACHE_TAG } from "./salesDataCache";
import { branchNameOnly } from "./branch-names";
import { repNameOnly } from "./rep-names";
import { fiscalYearStartOf, fiscalYearLabel } from "./period";

const PAGE_SIZE = 1000;

type FreightProfitSummaryRow = {
  period_end: string | null;
  branch_code: string | null;
  rep_code: string | null;
  customer_code: string | null;
  customer_name: string | null;
  order_count: number;
  freight_revenue: number;
  supplier_freight_cost: number;
  carrier_freight_cost: number;
  total_freight_cost: number;
  freight_profit: number;
};

async function fetchFreightProfitSummaryRowsUncached(): Promise<FreightProfitSummaryRow[]> {
  const supabase = getSupabaseServerClient();
  return fetchAllPagesConcurrent<FreightProfitSummaryRow>(
    (from, to) =>
      supabase
        .from("v_freight_profit_summary_mv")
        .select("*")
        .order("period_end", { ascending: true })
        .order("branch_code", { ascending: true })
        .order("rep_code", { ascending: true })
        .order("customer_code", { ascending: true })
        .range(from, to),
    { pageSize: PAGE_SIZE, concurrency: 8 }
  );
}
export const fetchFreightProfitSummaryRows = unstable_cache(
  fetchFreightProfitSummaryRowsUncached,
  ["fetchFreightProfitSummaryRows"],
  { tags: [SALES_DATA_CACHE_TAG], revalidate: false }
);

export type FreightGroupRow = {
  code: string;
  label: string;
  freightRevenue: number; // 運賃売上
  supplierCost: number; // 仕入先運賃(purchases product_code=99)
  carrierCost: number; // 運送会社運賃(西濃・福山などの実費、freight_actual_order_lines)
  totalCost: number; // 仕入計 = supplierCost + carrierCost
  grossProfit: number; // 粗利 = 運賃売上 - 仕入計
  grossProfitRate: number | null;
  orderCount: number; // 件数(受注番号の数)
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
  const grossProfit = row.freightRevenue - row.totalCost;
  const grossProfitRate = row.freightRevenue !== 0 ? grossProfit / row.freightRevenue : null;
  return { ...row, grossProfit, grossProfitRate };
}

function buildGroup(
  rows: FreightProfitSummaryRow[],
  keyOf: (r: FreightProfitSummaryRow) => string,
  labelOf: (code: string, sample: FreightProfitSummaryRow) => string
): FreightGroupRow[] {
  type Acc = {
    code: string;
    label: string;
    freightRevenue: number;
    supplierCost: number;
    carrierCost: number;
    totalCost: number;
    orderCount: number;
  };
  const map = new Map<string, Acc>();
  const sample = new Map<string, FreightProfitSummaryRow>();

  for (const r of rows) {
    const code = keyOf(r) || UNKNOWN_CODE;
    if (!sample.has(code)) sample.set(code, r);
    const g =
      map.get(code) ??
      { code, label: code, freightRevenue: 0, supplierCost: 0, carrierCost: 0, totalCost: 0, orderCount: 0 };
    g.freightRevenue += r.freight_revenue;
    g.supplierCost += r.supplier_freight_cost;
    g.carrierCost += r.carrier_freight_cost;
    g.totalCost += r.total_freight_cost;
    g.orderCount += r.order_count;
    map.set(code, g);
  }

  for (const [code, g] of map) {
    g.label = labelOf(code, sample.get(code)!);
  }

  return Array.from(map.values())
    .map(withProfit)
    .sort((a, b) => b.freightRevenue + b.totalCost - (a.freightRevenue + a.totalCost));
}

export function buildFreightSummary(rows: FreightProfitSummaryRow[]): FreightSummary {
  const total = withProfit({
    code: "ALL",
    label: "合計",
    freightRevenue: rows.reduce((s, r) => s + r.freight_revenue, 0),
    supplierCost: rows.reduce((s, r) => s + r.supplier_freight_cost, 0),
    carrierCost: rows.reduce((s, r) => s + r.carrier_freight_cost, 0),
    totalCost: rows.reduce((s, r) => s + r.total_freight_cost, 0),
    orderCount: rows.reduce((s, r) => s + r.order_count, 0),
  });

  const byBranch = buildGroup(
    rows,
    (r) => r.branch_code ?? "",
    (code) => (code === UNKNOWN_CODE ? code : branchNameOnly(code))
  );

  const byRep = buildGroup(
    rows,
    (r) => r.rep_code ?? "",
    (code) => (code === UNKNOWN_CODE ? code : repNameOnly(code))
  );

  const byCustomer = buildGroup(
    rows,
    (r) => r.customer_code ?? "",
    (code, sample) => (code === UNKNOWN_CODE ? code : sample.customer_name ?? code)
  );

  return { total, byBranch, byRep, byCustomer };
}

// period_end("YYYY-MM-DD"、20日締め期間の末日)が属する会計年度を求める。
// period_endの年月そのものがその期間のperiodKey("YYYYMM")になる
// (例: 期間202610の期間末日は2026-10-20)。
function fiscalYearStartFor(periodEnd: string | null): number | null {
  if (!periodEnd) return null;
  const [y, m] = periodEnd.split("-");
  if (!y || !m) return null;
  return fiscalYearStartOf(`${y}${m}`);
}

// 期(会計年度)ごとに、データが存在する期だけ合計・拠点別・担当別・得意先別の集計を作る。新しい期が先。
export function buildFreightSummaryByPeriod(rows: FreightProfitSummaryRow[]): FreightSummaryByPeriod[] {
  const byYear = new Map<number, FreightProfitSummaryRow[]>();
  for (const r of rows) {
    const y = fiscalYearStartFor(r.period_end);
    if (y === null) continue;
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(r);
  }

  const years = Array.from(byYear.keys()).sort((a, b) => b - a);

  return years.map((y) => ({
    fiscalYearStart: y,
    label: fiscalYearLabel(y),
    summary: buildFreightSummary(byYear.get(y) ?? []),
  }));
}
