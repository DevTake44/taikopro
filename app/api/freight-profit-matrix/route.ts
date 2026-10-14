import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fiscalYearPeriods, periodRangeFor } from "@/lib/period";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Dim = "branch" | "rep" | "customer";
const VALID_DIMS = new Set(["branch", "rep", "customer"]);
const CUSTOMER_LIMIT = 100;

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
  months: FreightMonthCell[]; // 12ヶ月分(10月始まり)
  total_s: number;
  total_p: number;
};

// 会計年度(10月始まりの西暦年)の12期間ぶんのperiod_end("YYYY-MM-DD")を返す。
function periodEndsOfFiscalYear(startCalYear: number): string[] {
  return fiscalYearPeriods(startCalYear).map((key) => periodRangeFor(key).to);
}

function labelFor(dim: Dim, r: MatrixRpcRow): string {
  if (dim === "customer") return r.customer_name || r.customer_code || "(不明)";
  return r.code || "(不明)";
}

function buildRows(rows: MatrixRpcRow[], periodEnds: string[], dim: Dim): FreightYearDimRow[] {
  const indexByPeriod = new Map(periodEnds.map((p, i) => [p, i]));
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
  }
  return Array.from(map.values()).sort((a, b) => b.total_s - a.total_s);
}

async function fetchMatrix(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  periodEnds: string[],
  dim: Dim
): Promise<{ rows: FreightYearDimRow[]; totalCount: number }> {
  const { data, error } = await supabase.rpc("freight_profit_year_matrix", {
    p_period_ends: periodEnds,
    p_dim: dim,
  });
  if (error) throw new Error(error.message);
  const built = buildRows((data ?? []) as MatrixRpcRow[], periodEnds, dim);
  const totalCount = built.length;
  const limited = dim === "customer" ? built.slice(0, CUSTOMER_LIMIT) : built;
  return { rows: limited, totalCount };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dim = searchParams.get("dim") as Dim | null;
  const yearParam = searchParams.get("year");
  const compareYearParam = searchParams.get("compareYear");

  if (!dim || !VALID_DIMS.has(dim)) {
    return NextResponse.json({ error: "dim は branch/rep/customer のいずれかを指定してください。" }, { status: 400 });
  }
  const year = yearParam ? parseInt(yearParam, 10) : NaN;
  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: "year が不正です。" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  try {
    const periodEnds = periodEndsOfFiscalYear(year);
    const base = await fetchMatrix(supabase, periodEnds, dim);

    let compare: { rows: FreightYearDimRow[]; totalCount: number } | null = null;
    if (compareYearParam) {
      const compareYear = parseInt(compareYearParam, 10);
      if (Number.isFinite(compareYear)) {
        const comparePeriodEnds = periodEndsOfFiscalYear(compareYear);
        compare = await fetchMatrix(supabase, comparePeriodEnds, dim);
      }
    }

    return NextResponse.json({
      rows: base.rows,
      custTotalCount: dim === "customer" ? base.totalCount : null,
      compareRows: compare?.rows ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
