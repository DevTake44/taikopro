import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { sameQuarterLastYear } from "@/lib/period";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export type PurchaseSupplierQuarterRow = {
  supplier_code: string;
  supplier_name: string;
  current_amount: number;
  prev_amount: number;
  diff: number;
  diff_rate: number | null;
  line_count: number;
};

// 仕入先別・四半期の仕入額(v_purchase_supplier_quarter、仕入先×四半期あたり
// 最大800件程度)を、指定の四半期と前年同期ぶん取得し、仕入先単位にまとめて返す。
// 検索・並び替えは件数が少ないためブラウザ側で行う。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const quarterEnd = searchParams.get("quarterEnd");
  if (!quarterEnd || !/^\d{4}-\d{2}-\d{2}$/.test(quarterEnd)) {
    return NextResponse.json({ error: "quarterEnd(YYYY-MM-DD)を指定してください。" }, { status: 400 });
  }
  const prevQuarterEnd = sameQuarterLastYear(quarterEnd);

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("v_purchase_supplier_quarter")
    .select("supplier_code, supplier_name, quarter_end, total_amount, line_count")
    .in("quarter_end", [quarterEnd, prevQuarterEnd]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const map = new Map<string, PurchaseSupplierQuarterRow>();
  for (const r of data ?? []) {
    const code = r.supplier_code as string;
    let row = map.get(code);
    if (!row) {
      row = {
        supplier_code: code,
        supplier_name: (r.supplier_name as string) || code,
        current_amount: 0,
        prev_amount: 0,
        diff: 0,
        diff_rate: null,
        line_count: 0,
      };
      map.set(code, row);
    }
    if (r.quarter_end === quarterEnd) {
      row.current_amount = Number(r.total_amount);
      row.line_count = Number(r.line_count);
      if ((r.supplier_name as string) || null) row.supplier_name = r.supplier_name as string;
    } else {
      row.prev_amount = Number(r.total_amount);
    }
  }

  const rows = Array.from(map.values()).map((r) => ({
    ...r,
    diff: r.current_amount - r.prev_amount,
    diff_rate: r.prev_amount ? (r.current_amount - r.prev_amount) / r.prev_amount : null,
  }));

  return NextResponse.json({ rows, quarterEnd, prevQuarterEnd });
}
