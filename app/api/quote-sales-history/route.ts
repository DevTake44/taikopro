import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// 見積書・請求書の明細行「過去売上から追加」用。指定した得意先の直近の売上明細
// (sales_lines)を、品番+品名の組み合わせごとに最新1件だけに絞って一覧表示する(同じ商品を
// 何度も買っている得意先向けに、前回単価のまま素早く転記できるようにするため)。
// 品番だけでは「諸口」等の共通コード(77700/66600/88800)で無関係な商品同士が
// 区別できないため、品名も合わせてグルーピングのキーにする。
// sell_price・assumed_costはどちらも単価であり行の金額ではない
// (lib/fetchStockMovement.ts等の既存コード通り、金額はqty×sell_priceで求める)。
// supplier_name/assumed_costは同じ行に記録済みのため、仕入先マスタ等への別検索なしに
// そのまま「仕入値・仕入先」の参考値として使える。
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
    .select("item_code, item_name, sell_price, assumed_cost, supplier_name, qty, delivery_date")
    .eq("customer_code", customerCode)
    .order("delivery_date", { ascending: false })
    .limit(500);

  if (query) {
    q = q.ilike("item_name", `%${query}%`);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const latestByItem = new Map<
    string,
    {
      product_code: string;
      product_name: string;
      unit_price: number | null;
      cost_price: number | null;
      cost_supplier_name: string | null;
      qty: number | null;
      delivery_date: string;
    }
  >();
  for (const r of data ?? []) {
    const key = `${r.item_code ?? ""}__${r.item_name ?? ""}`;
    if (!latestByItem.has(key)) {
      latestByItem.set(key, {
        product_code: r.item_code as string,
        product_name: r.item_name as string,
        unit_price: r.sell_price as number | null,
        cost_price: r.assumed_cost as number | null,
        cost_supplier_name: r.supplier_name as string | null,
        qty: (r.qty as number | null) || null,
        delivery_date: r.delivery_date as string,
      });
    }
  }

  return NextResponse.json({ rows: Array.from(latestByItem.values()).slice(0, 50) });
}
