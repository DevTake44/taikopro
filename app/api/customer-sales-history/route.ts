import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { toFullWidthForSearch } from "@/lib/kana";

export const dynamic = "force-dynamic";

type HistoryRow = {
  delivery_date: string | null;
  order_no: string | null;
  item_code: string | null;
  item_name: string | null;
  qty: number | null;
  sell_price: number | null;
  branch_code: string | null;
  rep_code: string | null;
  project_name: string | null;
};

const COLUMNS = "delivery_date, order_no, item_code, item_name, qty, sell_price, branch_code, rep_code, project_name";

// コールセンター対応中など、得意先の直近の取引実績をすぐに呼び出すための専用API。
// 経営レポート(/sales)のような事前集計・キャッシュは使わず、customer_code(+delivery_date)の
// インデックスを使った直接検索で都度取得する(応答速度を優先するため)。
// product(商品コード・商品名)を指定すると、「直近50件」ではなく、その得意先が
// その商品を取引した直近の実績を検索する(直近50件には出てこない過去の購入でも
// 見つけられるようにするため)。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerCode = (searchParams.get("customer_code") ?? "").trim();
  const productQuery = (searchParams.get("product") ?? "").trim();
  if (!customerCode) return NextResponse.json({ error: "customer_codeを指定してください。" }, { status: 400 });

  const supabase = getSupabaseServerClient();

  if (!productQuery) {
    const { data, error } = await supabase
      .from("sales_lines")
      .select(COLUMNS)
      .eq("customer_code", customerCode)
      .order("delivery_date", { ascending: false })
      .limit(50);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data ?? [] });
  }

  // 商品名は全角(数字・カナとも)で入っているため、名称検索は入力を全角化してから照合する
  // (半角・全角どちらで入力しても検索できるようにするため)。商品コードは半角英数字の
  // ことが多いため、そのまま部分一致で照合する。
  const nameTerms = productQuery.split(/[\s　]+/).filter(Boolean).map((t) => toFullWidthForSearch(t));

  let byCodeQuery = supabase
    .from("sales_lines")
    .select(COLUMNS)
    .eq("customer_code", customerCode)
    .ilike("item_code", `%${productQuery}%`)
    .order("delivery_date", { ascending: false })
    .limit(50);
  let byNameQuery = supabase.from("sales_lines").select(COLUMNS).eq("customer_code", customerCode);
  for (const term of nameTerms) {
    byNameQuery = byNameQuery.ilike("item_name", `%${term}%`);
  }
  byNameQuery = byNameQuery.order("delivery_date", { ascending: false }).limit(50);

  const [byCode, byName] = await Promise.all([byCodeQuery, byNameQuery]);
  if (byCode.error) return NextResponse.json({ error: byCode.error.message }, { status: 500 });
  if (byName.error) return NextResponse.json({ error: byName.error.message }, { status: 500 });

  const merged = [...(byCode.data ?? []), ...(byName.data ?? [])] as HistoryRow[];
  merged.sort((a, b) => (b.delivery_date ?? "").localeCompare(a.delivery_date ?? ""));
  const seen = new Set<string>();
  const rows: HistoryRow[] = [];
  for (const r of merged) {
    const key = `${r.order_no}|${r.item_code}|${r.delivery_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(r);
    if (rows.length >= 50) break;
  }

  return NextResponse.json({ rows });
}
