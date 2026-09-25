import { unstable_cache } from "next/cache";
import { getSupabaseServerClient } from "./supabaseServer";
import type { StockDetailRow } from "./buildStockDetail";
import { fetchAllPagesConcurrent } from "./fetchPaged";
import { SALES_DATA_CACHE_TAG } from "./salesDataCache";

const PAGE_SIZE = 1000; // Supabaseの1回のリクエストで安全に取れる件数
const STOCK_LOCATION_CODES = ["90", "91"];

type RawRow = {
  purchase_date: string;
  location_code: string;
  product_code: string | null;
  product_name: string | null;
  supplier_code: string | null;
  supplier_name: string | null;
  amount: number;
};

// purchasesは仕入日(purchase_date)しか持たないため、20日締めの月度
// (「YYYY-MM-01」形式、21日以降は翌月扱い)をこちらで計算する。
// v_monthlyマテリアライズドビュー側の計算(purchase_agg CTE)と同じルール。
function fiscalMonthFromPurchaseDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  let year = y;
  let month = m;
  if (d > 20) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * purchasesのうち、拠点90・91(在庫仕入)の行だけを全件取得する。
 * ページを複数同時並行で取りに行くことで、逐次取得より大幅に速くしている(fetchPaged.ts参照)。
 */
async function fetchStockDetailRowsUncached(): Promise<StockDetailRow[]> {
  const supabase = getSupabaseServerClient();
  try {
    const rows = await fetchAllPagesConcurrent<RawRow>(
      (from, to) =>
        supabase
          .from("purchases")
          .select("purchase_date, location_code, product_code, product_name, supplier_code, supplier_name, amount")
          .in("location_code", STOCK_LOCATION_CODES)
          .order("id", { ascending: true })
          .range(from, to),
      { pageSize: PAGE_SIZE, concurrency: 8 }
    );
    return rows.map((r) => ({
      fiscal_month: fiscalMonthFromPurchaseDate(r.purchase_date),
      location_code: r.location_code,
      product_code: r.product_code,
      product_name: r.product_name,
      supplier_code: r.supplier_code,
      supplier_name: r.supplier_name,
      amount: r.amount,
    }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Supabaseからの在庫仕入データ取得に失敗しました: ${message}`);
  }
}
// 「更新」ボタンが押されるまで同じ結果を返す(lib/salesDataCache.ts参照)。
export const fetchStockDetailRows = unstable_cache(fetchStockDetailRowsUncached, ["fetchStockDetailRows"], {
  tags: [SALES_DATA_CACHE_TAG],
  revalidate: false,
});
