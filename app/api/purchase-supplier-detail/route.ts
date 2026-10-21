import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

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

// 特定の仕入先・四半期について、purchasesを直接絞り込んで
// 拠点別・商品別・得意先別に集計する(1仕入先×1四半期分なので都度集計で十分高速)。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const supplierCode = searchParams.get("supplier_code");
  const quarterEnd = searchParams.get("quarterEnd");
  if (!supplierCode || !quarterEnd || !/^\d{4}-\d{2}-\d{2}$/.test(quarterEnd)) {
    return NextResponse.json(
      { error: "supplier_code・quarterEnd(YYYY-MM-DD)を指定してください。" },
      { status: 400 }
    );
  }

  const end = new Date(`${quarterEnd}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 2);
  start.setUTCDate(start.getUTCDate() + 1);
  const fromStr = start.toISOString().slice(0, 10);

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("purchases")
    .select("location_code, product_code, product_name, customer_code, customer_name, amount")
    .eq("supplier_code", supplierCode)
    .gte("purchase_date", fromStr)
    .lte("purchase_date", quarterEnd);

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
