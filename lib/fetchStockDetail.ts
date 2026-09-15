import { getSupabaseServerClient } from "./supabaseServer";
import type { StockDetailRow } from "./buildStockDetail";
import { fetchAllPagesConcurrent } from "./fetchPaged";

const PAGE_SIZE = 1000; // Supabaseの1回のリクエストで安全に取れる件数
const STOCK_LOCATION_CODES = ["90", "91"];

/**
 * purchases_detailのうち、拠点90・91(在庫仕入)の行だけを全件取得する。
 * ページを複数同時並行で取りに行くことで、逐次取得より大幅に速くしている(fetchPaged.ts参照)。
 */
export async function fetchStockDetailRows(): Promise<StockDetailRow[]> {
  const supabase = getSupabaseServerClient();
  try {
    return await fetchAllPagesConcurrent<StockDetailRow>(
      (from, to) =>
        supabase
          .from("purchases_detail")
          .select("fiscal_month, location_code, product_code, product_name, supplier_code, supplier_name, amount")
          .in("location_code", STOCK_LOCATION_CODES)
          .order("id", { ascending: true })
          .range(from, to),
      { pageSize: PAGE_SIZE, concurrency: 8 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Supabaseからの在庫仕入データ取得に失敗しました: ${message}`);
  }
}
