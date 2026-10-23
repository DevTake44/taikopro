import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// product_master上は存在するが実商品ではない「諸口」系コード。仕入先・得意先をまたいで
// 全く無関係な商品がすべて同じコードに乗ってしまうため、このコードでの仕入値・参照売価の
// 検索対象からは除外する(見た目上「仕入値が見つからない」になるが、そもそも商品単位で
// 比較できるデータではないため)。
const NON_PRODUCT_CODES = new Set(["77700", "66600", "88800", "99"]);

type CostOption = {
  source: "purchase" | "master";
  unit_price: number;
  supplier_code: string | null;
  supplier_name: string | null;
  date: string | null;
};

// 見積書・請求書の明細行で、品番に対する直近の仕入値(purchases)・仕入先と、
// 他の得意先への直近の売値(sales_lines、参考値)を返す。
// sell_priceは単価(金額ではない)のため、そのまま参照売価として使う。
// 仕入値の自動選択ロジックは従来通り: 仕入実績(purchases)があればその直近1件、
// 無ければ商品マスタの登録仕入単価(primary_supplier_price)にフォールバックする。
// ただし直近仕入実績は古い場合があり(商品によっては1年以上前のことも)、画面側で
// いつ時点の値か表示し、他の候補(仕入値が異なる他の仕入実績・マスタ値)から営業担当が
// 手動で選び直せるよう、cost_optionsとして候補一覧もあわせて返す。
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
    cost_source: null as "purchase" | "master" | null,
    cost_options: [] as CostOption[],
    reference_options: [] as { customer_code: string; customer_name: string; unit_price: number; delivery_date: string }[],
  };
  if (NON_PRODUCT_CODES.has(productCode)) return NextResponse.json(empty);

  const supabase = getSupabaseServerClient();

  const [purchasesRes, masterRes, refQuery] = await Promise.all([
    // 直近の仕入実績を複数件取得し、JS側で金額が異なるものだけ候補として残す
    // (「直近は原価違いがあればそれも出す」ため)。
    supabase
      .from("purchases")
      .select("unit_price, supplier_code, supplier_name, purchase_date")
      .eq("product_code", productCode)
      .order("purchase_date", { ascending: false })
      .limit(30),
    supabase
      .from("product_master")
      .select("primary_supplier_code, primary_supplier_price, source_updated_at")
      .eq("product_code", productCode)
      .maybeSingle(),
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

  if (purchasesRes.error) return NextResponse.json({ error: purchasesRes.error.message }, { status: 500 });
  if (refQuery.error) return NextResponse.json({ error: refQuery.error.message }, { status: 500 });

  // 仕入実績を金額ごとに重複排除(同額の古い実績は不要、直近の日付だけ残す)。
  const seenPrices = new Set<number>();
  const purchaseOptions: CostOption[] = [];
  for (const r of purchasesRes.data ?? []) {
    const price = r.unit_price as number;
    if (seenPrices.has(price)) continue;
    seenPrices.add(price);
    purchaseOptions.push({
      source: "purchase",
      unit_price: price,
      supplier_code: r.supplier_code as string | null,
      supplier_name: r.supplier_name as string | null,
      date: r.purchase_date as string,
    });
    if (purchaseOptions.length >= 8) break;
  }

  let masterOption: CostOption | null = null;
  const master = masterRes.data;
  if (master?.primary_supplier_price != null) {
    let masterSupplierName: string | null = null;
    if (master.primary_supplier_code) {
      const { data: supplier } = await supabase
        .from("supplier_master")
        .select("supplier_name")
        .eq("supplier_code", master.primary_supplier_code)
        .maybeSingle();
      masterSupplierName = supplier?.supplier_name ?? null;
    }
    masterOption = {
      source: "master",
      unit_price: master.primary_supplier_price,
      supplier_code: master.primary_supplier_code,
      supplier_name: masterSupplierName,
      date: master.source_updated_at ?? null,
    };
  }

  const costOptions: CostOption[] = [...purchaseOptions, ...(masterOption ? [masterOption] : [])];

  // 自動選択する仕入値は従来通り: 直近仕入実績があればそれを優先、無ければマスタ。
  const chosen: CostOption | null = purchaseOptions[0] ?? masterOption;

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
    cost_price: chosen?.unit_price ?? null,
    cost_supplier_code: chosen?.supplier_code ?? null,
    cost_supplier_name: chosen?.supplier_name ?? null,
    cost_date: chosen?.date ?? null,
    cost_source: chosen?.source ?? null,
    cost_options: costOptions,
    reference_options: referenceOptions,
  });
}
