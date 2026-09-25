// 「不動在庫チェック」用のデータ取得。
// 仕入(purchases・拠点90/91)と、在庫出荷実績(sales_lines・arrange_type='在庫')を
// それぞれ全件取得する。実際の突き合わせ(FIFOマッチング)はbuildStockMovement.tsで行う。
//
// 在庫出荷実績は数万件あり、1件ずつ順番にページを取りに行くと時間がかかりすぎてVercelの
// 関数タイムアウト(504)を起こすため、複数ページを同時並行で取得している(fetchPaged.ts参照)。

import { getSupabaseServerClient } from "./supabaseServer";
import { fetchAllPagesConcurrent } from "./fetchPaged";

const PAGE_SIZE = 1000;
const STOCK_LOCATION_CODES = ["90", "91"];

export type PurchaseLotRow = {
  product_code: string | null;
  product_name: string | null;
  purchase_date: string | null; // YYYY-MM-DD
  amount: number;
  unit_price: number | null;
};

export type ShipmentRow = {
  item_code: string | null;
  item_name: string | null;
  delivery_date: string | null; // YYYY-MM-DD
  qty: number | null;
  sell_price: number | null; // 単価。出荷金額(在庫回転月数の計算用)はqty×sell_priceで求める
};

// purchasesテーブルから、在庫仕入(拠点90・91)の明細を全件取得する。
export async function fetchPurchaseLots(): Promise<PurchaseLotRow[]> {
  const supabase = getSupabaseServerClient();
  try {
    return await fetchAllPagesConcurrent<PurchaseLotRow>(
      (from, to) =>
        supabase
          .from("purchases")
          .select("product_code, product_name, purchase_date, amount, unit_price")
          .in("location_code", STOCK_LOCATION_CODES)
          .order("id", { ascending: true })
          .range(from, to),
      { pageSize: PAGE_SIZE, concurrency: 8 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`仕入データの取得に失敗しました: ${message}`);
  }
}

// 在庫出荷実績(arrange_type='在庫')を全件取得する。
export async function fetchStockShipments(): Promise<ShipmentRow[]> {
  const supabase = getSupabaseServerClient();
  try {
    return await fetchAllPagesConcurrent<ShipmentRow>(
      (from, to) =>
        supabase
          .from("sales_lines")
          .select("item_code, item_name, delivery_date, qty, sell_price")
          .eq("arrange_type", "在庫")
          .order("id", { ascending: true })
          .range(from, to),
      { pageSize: PAGE_SIZE, concurrency: 10 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`出荷データ取得に失敗しました: ${message}`);
  }
}

// 商品マスタのITFコードから、「同じ商品なのに品番が複数登録されている」グループを作る。
// 品番→グループキー(例: "ITF:TB00360002000")のMapを返す。1つの品番にしか付いていない
// ITFコードは紐付け不要なので対象外(このMapに含まれない品番は、buildStockMovement側で
// 品番そのものをキーとして扱う)。
export async function fetchProductAliasGroups(): Promise<Map<string, string>> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("product_master")
    .select("product_code, itf_code")
    .not("itf_code", "is", null);
  if (error) throw new Error(`商品マスタ(ITFコード)の取得に失敗しました: ${error.message}`);

  const codesByItf = new Map<string, string[]>();
  for (const r of data ?? []) {
    const itf = (r.itf_code ?? "").trim();
    const code = (r.product_code ?? "").trim();
    if (!itf || !code) continue;
    const arr = codesByItf.get(itf) ?? [];
    arr.push(code);
    codesByItf.set(itf, arr);
  }

  const codeToGroupKey = new Map<string, string>();
  for (const [itf, codes] of codesByItf.entries()) {
    const uniqueCodes = Array.from(new Set(codes));
    if (uniqueCodes.length < 2) continue;
    const groupKey = `ITF:${itf}`;
    for (const code of uniqueCodes) codeToGroupKey.set(code, groupKey);
  }
  return codeToGroupKey;
}
