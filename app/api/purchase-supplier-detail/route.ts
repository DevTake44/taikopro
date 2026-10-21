import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fiscalYearRangeFor } from "@/lib/period";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
// 拠点別・商品別・得意先別に集計する(1仕入先×1年度分なので都度集計で十分高速)。
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
  const { data, error } = await supabase
    .from("purchases")
    .select("location_code, product_code, product_name, customer_code, customer_name, amount")
    .eq("supplier_code", supplierCode)
    .gte("purchase_date", from)
    .lte("purchase_date", to);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as PurchaseRow[];

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
