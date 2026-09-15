// 「不動在庫チェック」用のデータ取得。
// 仕入(purchases_detail・拠点90/91)と、在庫出荷実績(sales_lines・arrange_type='在庫')を
// それぞれ全件取得する。実際の突き合わせ(FIFOマッチング)はbuildStockMovement.tsで行う。
//
// 統合版ではsales_lines・purchases_detailとも同じtaiko-proプロジェクト内にあるため、
// 統合前(sales-dashboard・rieki-checkが別Supabaseプロジェクトだった頃)のようなプロジェクト
// をまたいだ接続は不要になった。
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

// sales-dashboard自身のDBから、在庫仕入(拠点90・91)の明細を全件取得する。
export async function fetchPurchaseLots(): Promise<PurchaseLotRow[]> {
  const supabase = getSupabaseServerClient();
  try {
    return await fetchAllPagesConcurrent<PurchaseLotRow>(
      (from, to) =>
        supabase
          .from("purchases_detail")
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
