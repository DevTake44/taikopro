// 「仕入未売上一覧」用のデータ取得。
// 仕入(purchases)のうち、納品先が倉庫・拠点(=実在の外部得意先ではなく自社の在庫・拠点)の
// 行だけを全件取得する。売上明細(sales_lines)は全件取得すると件数が多すぎて
// Vercelの関数タイムアウトを起こすため、対象仕入に登場する受注番号・品番だけに
// 絞り込んで取得する(fetchSalesMatches)。実際の突き合わせロジックは
// lib/unsoldPurchases.ts で行う。

import { unstable_cache } from "next/cache";
import { getSupabaseServerClient } from "./supabaseServer";
import { fetchAllPagesConcurrent } from "./fetchPaged";
import { SALES_DATA_CACHE_TAG } from "./salesDataCache";
import { WAREHOUSE_LOCATION_CODES } from "./unsoldPurchases";

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

// purchasesのうち、納品先が倉庫(拠点コード90・91)の行だけを取得する。
//
// 注意(2026-09時点): 当初は得意先名に「太幸」を含む(=自社拠点向け)行もOR条件で
// 対象に含めていたが、customer_nameに索引が無いため ILIKE '%太幸%' が全件スキャンになり、
// purchasesの件数次第ではDBのstatement timeoutを起こすことが分かった。そのため一旦
// location_code=90/91のみに絞っている。得意先名ベースの拠点向け仕入も対象に含めるには、
// customer_nameにトライグラム索引(pg_trgm)を追加するなど、DB側の対応が別途必要。
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
          .in("location_code", WAREHOUSE_LOCATION_CODES)
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

const IN_CHUNK_SIZE = 200; // PostgRESTのURL長・DB負荷を抑えるため、IN検索は小分けにする
const CHUNK_CONCURRENCY = 5;

async function runChunked<T>(values: string[], run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK_SIZE) chunks.push(values.slice(i, i + IN_CHUNK_SIZE));

  const results: T[] = [];
  for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
    const batch = chunks.slice(i, i + CHUNK_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(run));
    for (const r of batchResults) results.push(...r);
  }
  return results;
}

// sales_lines全件を取得すると件数が多すぎてVercelの関数タイムアウト(60秒)を起こすため、
// 対象の仕入(fetchWarehousePurchases)に実際に登場する受注番号・品番だけに絞り込んで取得する。
// ①受注番号突合用: 対象仕入に登場する受注番号を持つ売上明細(=売上済みかどうかの判定用)
// ②参考売価用: 対象仕入に登場する品番を持つ、0円超の売上明細(=その商品が過去に売れた実績)
export async function fetchSalesMatches(orderNos: string[], productCodes: string[]): Promise<SalesMatchRow[]> {
  const supabase = getSupabaseServerClient();
  try {
    const byOrderNo = await runChunked(orderNos, async (chunk) => {
      const { data, error } = await supabase
        .from("sales_lines")
        .select("order_no, order_line, item_code, sell_price")
        .in("order_no", chunk);
      if (error) throw new Error(error.message);
      return (data ?? []) as SalesMatchRow[];
    });

    const byProductCode = await runChunked(productCodes, async (chunk) => {
      const { data, error } = await supabase
        .from("sales_lines")
        .select("order_no, order_line, item_code, sell_price")
        .in("item_code", chunk)
        .gt("sell_price", 0);
      if (error) throw new Error(error.message);
      return (data ?? []) as SalesMatchRow[];
    });

    return [...byOrderNo, ...byProductCode];
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`売上データの取得に失敗しました: ${message}`);
  }
}
