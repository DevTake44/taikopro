import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { toFullWidthForSearch } from "@/lib/kana";

export const dynamic = "force-dynamic";

type HistoryRow = {
  customer_code: string | null;
  customer_name: string | null;
  delivery_date: string | null;
  order_no: string | null;
  item_code: string | null;
  item_name: string | null;
  spec: string | null;
  qty: number | null;
  sell_price: number | null;
  branch_code: string | null;
  rep_code: string | null;
  project_name: string | null;
  assumed_cost: number | null;
  supplier_code: string | null;
  supplier_name: string | null;
};

// assumed_cost・supplier_code・supplier_nameは、見積書作成(顧客実績から商品をロック→
// 見積書を作成)に引き継ぐための仕入値・仕入先。「77700」のような複数商品が相乗りする
// 共通コードは品番だけでは仕入値を検索できない(quote-product-costが対象外にしている)が、
// このsales_linesの実績値ならその受注固有の値なので、共通コードでも正しく引き継げる。
const COLUMNS =
  "customer_code, customer_name, delivery_date, order_no, item_code, item_name, spec, qty, sell_price, branch_code, rep_code, project_name, assumed_cost, supplier_code, supplier_name";

// 仕様は本来、売上明細(sales_lines.spec)にその受注時点の実績値(サイズ・色など)が
// 入っている(2026-10-28の取り込み修正以降)。ただし、それより前に取り込んだ既存行には
// この列が無い(NULL)ため、その場合だけ商品マスタ(product_master.spec、現在の代表値)を
// フォールバックとして補う。
async function fillMissingSpec(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  rows: HistoryRow[]
): Promise<HistoryRow[]> {
  const needsFallback = rows.filter((r) => !r.spec && r.item_code);
  if (needsFallback.length === 0) return rows;

  const itemCodes = Array.from(new Set(needsFallback.map((r) => r.item_code as string)));
  const { data: specRows } = await supabase.from("product_master").select("product_code, spec").in("product_code", itemCodes);
  const specByCode = new Map((specRows ?? []).map((r) => [r.product_code as string, r.spec as string | null]));
  return rows.map((r) => (r.spec || !r.item_code ? r : { ...r, spec: specByCode.get(r.item_code) ?? null }));
}

// コールセンター対応中など、得意先の直近の取引実績をすぐに呼び出すための専用API。
// 経営レポート(/sales)のような事前集計・キャッシュは使わず、customer_code(+delivery_date)の
// インデックスを使った直接検索で都度取得する(応答速度を優先するため)。
// customer_codeはカンマ区切りで複数指定できる(同じ会社が拠点ごとに別の得意先コードに
// 分かれている場合、どの拠点で取引があったかまとめて検索できるようにするため)。
// product(商品コード・商品名)を指定すると、「直近50件」ではなく、その得意先が
// その商品を取引した直近の実績を検索する(直近50件には出てこない過去の購入でも
// 見つけられるようにするため)。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerCodes = (searchParams.get("customer_code") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const productQuery = (searchParams.get("product") ?? "").trim();
  if (customerCodes.length === 0) return NextResponse.json({ error: "customer_codeを指定してください。" }, { status: 400 });

  const supabase = getSupabaseServerClient();

  if (!productQuery) {
    const { data, error } = await supabase
      .from("sales_lines")
      .select(COLUMNS)
      .in("customer_code", customerCodes)
      .order("delivery_date", { ascending: false })
      .limit(50);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: await fillMissingSpec(supabase, (data ?? []) as HistoryRow[]) });
  }

  // 商品名は全角(数字・カナとも)で入っているため、名称検索は入力を全角化してから照合する
  // (半角・全角どちらで入力しても検索できるようにするため)。商品コードは半角英数字の
  // ことが多いため、そのまま部分一致で照合する。
  const nameTerms = productQuery.split(/[\s　]+/).filter(Boolean).map((t) => toFullWidthForSearch(t));

  let byCodeQuery = supabase
    .from("sales_lines")
    .select(COLUMNS)
    .in("customer_code", customerCodes)
    .ilike("item_code", `%${productQuery}%`)
    .order("delivery_date", { ascending: false })
    .limit(50);
  let byNameQuery = supabase.from("sales_lines").select(COLUMNS).in("customer_code", customerCodes);
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
    const key = `${r.order_no}|${r.item_code}|${r.delivery_date}|${r.customer_code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(r);
    if (rows.length >= 50) break;
  }

  return NextResponse.json({ rows: await fillMissingSpec(supabase, rows) });
}
