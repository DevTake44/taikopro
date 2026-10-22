import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// product_master上は存在するが実商品ではない「諸口」系コード。仕入先・得意先をまたいで
// 全く無関係な商品がすべて同じコードに乗ってしまうため、このコードでの仕入値・参照売価の
// 検索対象からは除外する(見た目上「仕入値が見つからない」になるが、そもそも商品単位で
// 比較できるデータではないため)。
const NON_PRODUCT_CODES = new Set(["77700", "66600", "88800", "99"]);

// 見積書・請求書の明細行で、品番に対する直近の仕入値(purchases)・仕入先と、
// 他の得意先への直近の売値(sales_lines、参考値)を返す。
// sell_priceは単価(金額ではない)のため、そのまま参照売価として使う。
// 仕入実績(purchases)が無い商品は、商品マスタの登録仕入単価(primary_supplier_price)に
// フォールバックする。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productCode = (searchParams.get("product_code") ?? "").trim();
  const excludeCustomerCode = searchParams.get("exclude_customer_code") || null;
  if (!productCode) return NextResponse.json({ error: "product_codeを指定してください。" }, { status: 400 });

  const empty = {
    cost_price: null,
    cost_supplier_code: null,
    cost_supplier_name: null,
    cost_date: null,
    reference_options: [] as { customer_code: string; customer_name: string; unit_price: number; delivery_date: string }[],
  };
  if (NON_PRODUCT_CODES.has(productCode)) return NextResponse.json(empty);

  const supabase = getSupabaseServerClient();

  const [costRes, refQuery] = await Promise.all([
    supabase
      .from("purchases")
      .select("unit_price, supplier_code, supplier_name, purchase_date")
      .eq("product_code", productCode)
      .order("purchase_date", { ascending: false })
      .limit(1),
    (() => {
      // 得意先ごとに選べるよう、販売実績のある得意先を直近順に複数件取得する
      // (同じ得意先の重複は後でJS側で最新1件に絞る)。
      let q = supabase
        .from("sales_lines")
        .select("customer_code, customer_name, sell_price, delivery_date")
        .eq("item_code", productCode)
        .order("delivery_date", { ascending: false })
        .limit(200);
      if (excludeCustomerCode) q = q.neq("customer_code", excludeCustomerCode);
      return q;
    })(),
  ]);

  if (costRes.error) return NextResponse.json({ error: costRes.error.message }, { status: 500 });
  if (refQuery.error) return NextResponse.json({ error: refQuery.error.message }, { status: 500 });

  let costPrice: number | null = costRes.data?.[0]?.unit_price ?? null;
  let costSupplierCode: string | null = costRes.data?.[0]?.supplier_code ?? null;
  let costSupplierName: string | null = costRes.data?.[0]?.supplier_name ?? null;
  let costDate: string | null = costRes.data?.[0]?.purchase_date ?? null;

  if (costPrice === null) {
    const { data: master } = await supabase
      .from("product_master")
      .select("primary_supplier_code, primary_supplier_price")
      .eq("product_code", productCode)
      .maybeSingle();
    if (master?.primary_supplier_price != null) {
      costPrice = master.primary_supplier_price;
      costDate = null;
      if (master.primary_supplier_code) {
        costSupplierCode = master.primary_supplier_code;
        const { data: supplier } = await supabase
          .from("supplier_master")
          .select("supplier_name")
          .eq("supplier_code", master.primary_supplier_code)
          .maybeSingle();
        costSupplierName = supplier?.supplier_name ?? null;
      }
    }
  }

  const seenCustomers = new Set<string>();
  const referenceOptions: { customer_code: string; customer_name: string; unit_price: number; delivery_date: string }[] = [];
  for (const r of refQuery.data ?? []) {
    const code = r.customer_code as string;
    if (seenCustomers.has(code)) continue;
    seenCustomers.add(code);
    referenceOptions.push({
      customer_code: code,
      customer_name: r.customer_name as string,
      unit_price: r.sell_price as number,
      delivery_date: r.delivery_date as string,
    });
    if (referenceOptions.length >= 20) break;
  }

  return NextResponse.json({
    cost_price: costPrice,
    cost_supplier_code: costSupplierCode,
    cost_supplier_name: costSupplierName,
    cost_date: costDate,
    reference_options: referenceOptions,
  });
}
