import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// 見積書・請求書の明細行「過去売上から追加」用。指定した得意先の直近の売上明細
// (sales_lines)を、品番ごとに最新1件だけに絞って一覧表示する(同じ商品を何度も
// 買っている得意先向けに、前回単価のまま素早く転記できるようにするため)。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerCode = searchParams.get("customer_code");
  const query = (searchParams.get("query") ?? "").trim();
  if (!customerCode) {
    return NextResponse.json({ error: "customer_codeを指定してください。" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  let q = supabase
    .from("sales_lines")
    .select("item_code, item_name, sell_price, qty, delivery_date")
    .eq("customer_code", customerCode)
    .order("delivery_date", { ascending: false })
    .limit(500);

  if (query) {
    q = q.ilike("item_name", `%${query}%`);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 品番ごとに最新(delivery_dateが一番新しい)行だけを残す。
  // sell_priceは単価ではなく行の金額(税別)のため、単価はqtyで割って逆算する。
  const latestByItem = new Map<
    string,
    { product_code: string; product_name: string; unit_price: number | null; qty: number | null; delivery_date: string }
  >();
  for (const r of data ?? []) {
    const code = (r.item_code as string) || (r.item_name as string);
    if (!latestByItem.has(code)) {
      const qty = (r.qty as number | null) || null;
      const sellPrice = r.sell_price as number | null;
      latestByItem.set(code, {
        product_code: r.item_code as string,
        product_name: r.item_name as string,
        unit_price: qty && sellPrice !== null ? Math.round((sellPrice / qty) * 100) / 100 : sellPrice,
        qty,
        delivery_date: r.delivery_date as string,
      });
    }
  }

  return NextResponse.json({ rows: Array.from(latestByItem.values()).slice(0, 50) });
}
