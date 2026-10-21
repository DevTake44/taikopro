import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { normalizeForSearch } from "@/lib/textNormalize";

export const dynamic = "force-dynamic";

// 見積書・請求書の明細行「商品から追加」用。product_masterを品番・品名で検索する。
// 販売単価はマスタに持っていないため、primary_supplier_price(仕入単価)を参考値として返す
// (実際の初期値は呼び出し元で、過去の同じ得意先への販売実績(sales_lines)を優先する)。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("query") ?? "").trim();
  if (!query) return NextResponse.json({ rows: [] });

  const supabase = getSupabaseServerClient();

  const [byCode, byName] = await Promise.all([
    supabase
      .from("product_master")
      .select("product_code, product_name, spec, primary_supplier_price")
      .eq("is_deleted", false)
      .eq("product_code", query)
      .limit(5),
    supabase
      .from("product_master")
      .select("product_code, product_name, spec, primary_supplier_price")
      .eq("is_deleted", false)
      .ilike("product_name_normalized", `%${normalizeForSearch(query)}%`)
      .order("product_code", { ascending: true })
      .limit(30),
  ]);
  if (byCode.error) return NextResponse.json({ error: byCode.error.message }, { status: 500 });
  if (byName.error) return NextResponse.json({ error: byName.error.message }, { status: 500 });

  const seen = new Set<string>();
  const rows: { product_code: string; product_name: string; spec: string | null; primary_supplier_price: number | null }[] = [];
  for (const r of [...(byCode.data ?? []), ...(byName.data ?? [])]) {
    if (seen.has(r.product_code)) continue;
    seen.add(r.product_code);
    rows.push(r);
  }

  return NextResponse.json({ rows });
}
