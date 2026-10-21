import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fiscalYearPeriods, periodRangeFor } from "@/lib/period";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Dim = "branch" | "rep" | "customer";
const VALID_DIMS = new Set(["branch", "rep", "customer"]);
const CUSTOMER_LIMIT = 100;

type CapMetric = "revenue" | "cost" | "profit" | "margin";
const VALID_CAP_METRICS = new Set(["revenue", "cost", "profit", "margin"]);

type MatrixRpcRow = {
  code: string;
  branch_code: string | null;
  rep_code: string | null;
  customer_code: string | null;
  customer_name: string | null;
  period_end: string;
  order_count: number;
  freight_revenue: number;
  supplier_freight_cost: number;
  carrier_freight_cost: number;
  total_freight_cost: number;
  freight_profit: number;
};

export type FreightMonthCell = { s: number; p: number; carrier: number; supplier: number };
export type FreightYearDimRow = {
  code: string;
  name: string;
  months: FreightMonthCell[]; // 12ヶ月分(10月始まり)。月で絞り込んだ時はその月以外0。
  total_s: number;
  total_p: number;
  total_supplier: number;
  total_carrier: number;
  order_count: number;
};

type Filters = { branch: string | null; rep: string | null; customer: string | null };

// 会計年度(10月始まりの西暦年)の12期間ぶんのperiod_end("YYYY-MM-DD")を返す。
function periodEndsOfFiscalYear(startCalYear: number): string[] {
  return fiscalYearPeriods(startCalYear).map((key) => periodRangeFor(key).to);
}

function labelFor(dim: Dim, r: MatrixRpcRow): string {
  if (dim === "customer") return r.customer_name || r.customer_code || "(不明)";
  return r.code || "(不明)";
}

// 得意先(上位100件に絞る対象)の並び替え基準。画面側の「並び順」選択と連動させる
// ことで、例えば「粗利額の低い順」を選んだ時に、運賃売上0円で仕入だけ計上されている
// (=トップ100(運賃売上順)には出てこない)得意先も拾えるようにする。
function rankValue(metric: CapMetric, total_s: number, total_p: number): number {
  if (metric === "revenue") return total_s;
  if (metric === "cost") return total_p;
  if (metric === "profit") return total_s - total_p;
  // marginは売上0だと計算できないため、売上が無い行を「最も低い」扱いにする
  // (運賃売上0・仕入だけの行を見つけたいケースでそのまま有効に働くため)。
  return total_s ? (total_s - total_p) / total_s : -Infinity;
}

// columnPeriodEndsは常に会計年度の12期間(列位置合わせ用)。queryPeriodEndsは実際に
// RPCへ渡す期間(month絞り込み時は1件だけ)。
function buildRows(
  rows: MatrixRpcRow[],
  columnPeriodEnds: string[],
  dim: Dim,
  capMetric: CapMetric,
  capDir: "asc" | "desc"
): FreightYearDimRow[] {
  const indexByPeriod = new Map(columnPeriodEnds.map((p, i) => [p, i]));
  const map = new Map<string, FreightYearDimRow>();
  for (const r of rows) {
    const code = r.code || "";
    let row = map.get(code);
    if (!row) {
      row = {
        code,
        name: labelFor(dim, r),
        months: Array.from({ length: 12 }, () => ({ s: 0, p: 0, carrier: 0, supplier: 0 })),
        total_s: 0,
        total_p: 0,
        total_supplier: 0,
        total_carrier: 0,
        order_count: 0,
      };
      map.set(code, row);
    }
    const i = indexByPeriod.get(r.period_end);
    if (i === undefined) continue;
    row.months[i].s += r.freight_revenue;
    row.months[i].p += r.total_freight_cost;
    row.months[i].supplier += r.supplier_freight_cost;
    row.months[i].carrier += r.carrier_freight_cost;
    row.total_s += r.freight_revenue;
    row.total_p += r.total_freight_cost;
    row.total_supplier += r.supplier_freight_cost;
    row.total_carrier += r.carrier_freight_cost;
    row.order_count += r.order_count;
  }
  return Array.from(map.values()).sort((a, b) => {
    const va = rankValue(capMetric, a.total_s, a.total_p);
    const vb = rankValue(capMetric, b.total_s, b.total_p);
    return capDir === "asc" ? va - vb : vb - va;
  });
}

async function fetchMatrix(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  queryPeriodEnds: string[],
  columnPeriodEnds: string[],
  dim: Dim,
  filters: Filters,
  capMetric: CapMetric,
  capDir: "asc" | "desc"
): Promise<{ rows: FreightYearDimRow[]; totalCount: number }> {
  // 2026-10-14追加: p_branch_code/p_rep_code/p_customer_filterを追加した際、旧シグネチャ
  // (p_period_ends, p_dimの2引数)がDBツールのDROPハングで消せず残っているため、必ず
  // 5引数すべてを名前付きで渡し、新シグネチャだけが一意にマッチするようにしている
  // (2引数だけだとPostgRESTが新旧どちらの関数か一意に決められずエラーになる)。
  const { data, error } = await supabase.rpc("freight_profit_year_matrix", {
    p_period_ends: queryPeriodEnds,
    p_dim: dim,
    p_branch_code: filters.branch,
    p_rep_code: filters.rep,
    p_customer_filter: filters.customer,
  });
  if (error) throw new Error(error.message);
  const built = buildRows((data ?? []) as MatrixRpcRow[], columnPeriodEnds, dim, capMetric, capDir);
  const totalCount = built.length;
  const limited = dim === "customer" ? built.slice(0, CUSTOMER_LIMIT) : built;
  return { rows: limited, totalCount };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dim = searchParams.get("dim") as Dim | null;
  const yearParam = searchParams.get("year");
  const compareYearParam = searchParams.get("compareYear");
  const monthParam = searchParams.get("month"); // "YYYY-MM-DD"(period_end)。指定時はその月だけに絞る。
  const filters: Filters = {
    branch: searchParams.get("branch") || null,
    rep: searchParams.get("rep") || null,
    customer: searchParams.get("customer")?.trim() || null,
  };
  // 得意先トップ100を選ぶ基準(画面の「並び順」と連動)。未指定ならこれまで通り運賃売上の多い順。
  const capMetricParam = (searchParams.get("capMetric") as CapMetric | null) ?? "revenue";
  const capMetric: CapMetric = VALID_CAP_METRICS.has(capMetricParam) ? capMetricParam : "revenue";
  const capDir: "asc" | "desc" = searchParams.get("capDir") === "asc" ? "asc" : "desc";

  if (!dim || !VALID_DIMS.has(dim)) {
    return NextResponse.json({ error: "dim は branch/rep/customer のいずれかを指定してください。" }, { status: 400 });
  }
  const year = yearParam ? parseInt(yearParam, 10) : NaN;
  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: "year が不正です。" }, { status: 400 });
  }
  if (monthParam && !/^\d{4}-\d{2}-\d{2}$/.test(monthParam)) {
    return NextResponse.json({ error: "month の形式が不正です。" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  try {
    const fullYearPeriodEnds = periodEndsOfFiscalYear(year);
    const queryPeriodEnds = monthParam ? [monthParam] : fullYearPeriodEnds;
    const base = await fetchMatrix(supabase, queryPeriodEnds, fullYearPeriodEnds, dim, filters, capMetric, capDir);

    let compareRows: FreightYearDimRow[] | null = null;
    if (compareYearParam) {
      const compareYear = parseInt(compareYearParam, 10);
      if (Number.isFinite(compareYear)) {
        const compareFullYearPeriodEnds = periodEndsOfFiscalYear(compareYear);
        // 対比期間も、基準期間で月を絞り込んでいれば同じ月度(periodKeyの月部分)だけに絞る。
        const compareQueryPeriodEnds = monthParam
          ? compareFullYearPeriodEnds.filter((p) => p.slice(5, 7) === monthParam.slice(5, 7))
          : compareFullYearPeriodEnds;
        const compare = await fetchMatrix(
          supabase,
          compareQueryPeriodEnds,
          compareFullYearPeriodEnds,
          dim,
          filters,
          capMetric,
          capDir
        );
        compareRows = compare.rows;
      }
    }

    return NextResponse.json({
      rows: base.rows,
      custTotalCount: dim === "customer" ? base.totalCount : null,
      compareRows,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
