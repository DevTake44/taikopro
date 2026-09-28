// 「仕入未売上一覧」用のデータ取得。
// 仕入(purchases)のうち、納品先が倉庫・拠点(=実在の外部得意先ではなく自社の在庫・拠点)の
// 行だけを全件取得する。実際の突き合わせ(受注番号での売上明細とのマッチング)は
// lib/unsoldPurchases.ts で行う。

import { unstable_cache } from "next/cache";
import { getSupabaseServerClient } from "./supabaseServer";
import { fetchAllPagesConcurrent } from "./fetchPaged";
import { SALES_DATA_CACHE_TAG } from "./salesDataCache";
import { WAREHOUSE_LOCATION_CODES, BRANCH_DELIVERY_KEYWORD } from "./unsoldPurchases";

const PAGE_SIZE = 1000;

export type UnsoldPurchaseSourceRow = {
  purchase_number: string;
  purchase_line: string;
  purchase_date: string | null;
  order_no: string | null;
  order_line: string | null;
  location_code: string;
  customer_name: string | null;
  product_code: string | null;
  product_name: string | null;
  supplier_name: string | null;
  unit_price: number | null;
  qty: number | null;
  amount: number;
};

// purchasesのうち、納品先が倉庫(拠点コード90・91)、または得意先名に「太幸」を含む
// (=自社拠点向け)の行だけを取得する。
async function fetchWarehousePurchasesUncached(): Promise<UnsoldPurchaseSourceRow[]> {
  const supabase = getSupabaseServerClient();
  try {
    return await fetchAllPagesConcurrent<UnsoldPurchaseSourceRow>(
      (from, to) =>
        supabase
          .from("purchases")
          .select(
            "purchase_number, purchase_line, purchase_date, order_no, order_line, location_code, customer_name, product_code, product_name, supplier_name, unit_price, qty, amount"
          )
          .or(
            `location_code.in.(${WAREHOUSE_LOCATION_CODES.join(",")}),customer_name.ilike.%${BRANCH_DELIVERY_KEYWORD}%`
          )
          .order("id", { ascending: true })
          .range(from, to),
      { pageSize: PAGE_SIZE, concurrency: 8 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`仕入データ(倉庫・拠点向け)の取得に失敗しました: ${message}`);
  }
}
// 「更新」ボタンが押されるまで同じ結果を返す(lib/salesDataCache.ts参照)。
export const fetchWarehousePurchases = unstable_cache(
  fetchWarehousePurchasesUncached,
  ["fetchWarehousePurchases"],
  { tags: [SALES_DATA_CACHE_TAG], revalidate: false }
);

export type SalesMatchRow = {
  order_no: string | null;
  order_line: string | null;
  item_code: string | null;
  sell_price: number | null;
};

// 受注番号での突き合わせ、および商品ごとの参考売価(過去に売れた実績)を求めるため、
// sales_lines全件から必要な列だけを取得する。
async function fetchSalesMatchRowsUncached(): Promise<SalesMatchRow[]> {
  const supabase = getSupabaseServerClient();
  try {
    return await fetchAllPagesConcurrent<SalesMatchRow>(
      (from, to) =>
        supabase
          .from("sales_lines")
          .select("order_no, order_line, item_code, sell_price")
          .order("id", { ascending: true })
          .range(from, to),
      { pageSize: PAGE_SIZE, concurrency: 10 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`売上データの取得に失敗しました: ${message}`);
  }
}
export const fetchSalesMatchRows = unstable_cache(fetchSalesMatchRowsUncached, ["fetchSalesMatchRows"], {
  tags: [SALES_DATA_CACHE_TAG],
  revalidate: false,
});
