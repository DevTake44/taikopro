// 未売上仕入チェック機能の共通の型。
//
// v_unsold_purchases(Supabaseのビュー)は、仕入(purchases)のうち
// 「受注番号+受注行番号」が一致する売上明細(sales_lines)が1件も無い行=未売上候補を返す。
// 運賃(product_code=99)・在庫仕入(location_code 90/91)・受注番号なしの行は
// ビュー側で既に除外済み。売上金額が0円の一致行(サンプル品など)も、行として
// 存在しさえすれば「売上あり」として除外されているため、ここには出てこない。
export type UnsoldPurchaseRow = {
  purchase_number: string;
  purchase_line: string;
  order_no: string;
  purchase_date: string | null;
  staff_code: string | null;
  customer_code: string | null;
  customer_name: string | null;
  product_code: string | null;
  product_name: string | null;
  amount: number;
};
