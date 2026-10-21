import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fiscalYearRangeFor } from "@/lib/period";
import { fetchAllPagesConcurrent } from "@/lib/fetchPaged";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type PurchaseBreakdownRow = { code: string; name: string; amount: number; line_count: number };

type PurchaseRow = {
  location_code: string | null;
  product_code: string | null;
  product_name: string | null;
  customer_code: string | null;
  customer_name: string | null;
  amount: number | null;
};

function aggregate(
  rows: PurchaseRow[],
  codeOf: (r: PurchaseRow) => string,
  nameOf: (r: PurchaseRow) => string
): PurchaseBreakdownRow[] {
  const map = new Map<string, PurchaseBreakdownRow>();
  for (const r of rows) {
    const code = codeOf(r);
    let row = map.get(code);
    if (!row) {
      row = { code, name: nameOf(r), amount: 0, line_count: 0 };
      map.set(code, row);
    }
    row.amount += Number(r.amount ?? 0);
    row.line_count += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

// 特定の仕入先・会計年度について、purchasesを直接絞り込んで
// 拠点別・商品別・得意先別に集計する(1仕入先×1年度分に絞られるので都度集計で
// 十分高速)。ただし仕入先によっては1年で数万件(最大手は6万件超)になるため、
// Data APIのデフォルト上限(1,000件)で切り捨てられないようページングして
// 全件取得する(マトリクス側と同じ原因で見つかった不具合)。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const supplierCode = searchParams.get("supplier_code");
  const yearParam = searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : NaN;
  if (!supplierCode || !Number.isFinite(year)) {
    return NextResponse.json(
      { error: "supplier_code・year(会計年度の期首西暦年)を指定してください。" },
      { status: 400 }
    );
  }

  const { from, to } = fiscalYearRangeFor(year);

  const supabase = getSupabaseServerClient();
  let rows: PurchaseRow[];
  try {
    rows = await fetchAllPagesConcurrent<PurchaseRow>((rangeFrom, rangeTo) =>
      supabase
        .from("purchases")
        .select("location_code, product_code, product_name, customer_code, customer_name, amount")
        .eq("supplier_code", supplierCode)
        .gte("purchase_date", from)
        .lte("purchase_date", to)
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo)
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  return NextResponse.json({
    byLocation: aggregate(
      rows,
      (r) => r.location_code || "(不明)",
      (r) => r.location_code || "(不明)"
    ),
    byProduct: aggregate(
      rows,
      (r) => r.product_code || "(不明)",
      (r) => r.product_name || r.product_code || "(不明)"
    ),
    byCustomer: aggregate(
      rows,
      (r) => r.customer_code || "(不明)",
      (r) => r.customer_name || r.customer_code || "(不明)"
    ),
  });
}
