// 顧客実績画面で「見積に追加」した商品を、見積書の新規作成画面に引き継ぐための
// 一時的な受け渡し用(DBには保存しない)。画面遷移をまたぐだけなので、sessionStorageに
// 1件だけ置く方式にしている。新規作成画面側は読み取り次第すぐに削除する。
export const QUOTE_DRAFT_SESSION_KEY = "taikopro_pending_quote_draft";

export type QuoteDraftLine = {
  product_code: string | null;
  product_name: string;
  spec: string | null;
  qty: number;
  unit_price: number;
  // 取引実績(sales_lines)に記録された、この受注固有の仕入値・仕入先。
  // 「77700」のような共通コードは品番だけでは仕入値を検索できないため、
  // 商品マスタ/品番経由の再検索ではなく、実績値をそのまま引き継ぐ。
  cost_price: number | null;
  supplier_code: string | null;
  supplier_name: string | null;
};

export type QuoteDraft = {
  customer_code: string;
  customer_name: string;
  postal_code: string | null;
  address: string | null;
  // 実績のある拠点(選んだ商品の取引実績から)。見積書発行拠点の初期値として使う。
  branch_code: string | null;
  lines: QuoteDraftLine[];
};
