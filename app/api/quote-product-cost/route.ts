import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// 見積書・請求書の明細行で、品番に対する直近の仕入値(purchases)・仕入先と、
// 他の得意先への直近の売値(sales_lines、参考値)を返す。
// 見積は作成中の画面であり、仕入値・仕入先が見えている状態で単価を決められる
// 必要があるため、明細に品番がセットされるたびに呼び出す想定。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productCode = (searchParams.get("product_code") ?? "").trim();
  const excludeCustomerCode = searchParams.get("exclude_customer_code") || null;
  if (!productCode) return NextResponse.json({ error: "product_codeを指定してください。" }, { status: 400 });

  const supabase = getSupabaseServerClient();

  const [costRes, refQuery] = await Promise.all([
    supabase
      .from("purchases")
      .select("unit_price, supplier_name, purchase_date")
      .eq("product_code", productCode)
      .order("purchase_date", { ascending: false })
      .limit(1),
    (() => {
      let q = supabase
        .from("sales_lines")
        .select("customer_name, sell_price, qty, delivery_date")
        .eq("item_code", productCode)
        .order("delivery_date", { ascending: false })
        .limit(10);
      if (excludeCustomerCode) q = q.neq("customer_code", excludeCustomerCode);
      return q;
    })(),
  ]);

  if (costRes.error) return NextResponse.json({ error: costRes.error.message }, { status: 500 });
  if (refQuery.error) return NextResponse.json({ error: refQuery.error.message }, { status: 500 });

  const cost = costRes.data?.[0] ?? null;
  const ref = (refQuery.data ?? [])[0] ?? null;
  // sell_priceは行の金額(税別)のため、単価はqtyで割って逆算する。
  const refUnitPrice =
    ref && ref.qty && ref.sell_price !== null ? Math.round((ref.sell_price / ref.qty) * 100) / 100 : ref?.sell_price ?? null;

  return NextResponse.json({
    cost_price: cost?.unit_price ?? null,
    cost_supplier_name: cost?.supplier_name ?? null,
    cost_date: cost?.purchase_date ?? null,
    reference_price: refUnitPrice,
    reference_customer_name: ref?.customer_name ?? null,
    reference_date: ref?.delivery_date ?? null,
  });
}
