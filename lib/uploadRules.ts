// データ更新の「重複判定の列」を、ここ1箇所にだけ固定しておきます。
// 過去、この列をSQLを書くたびに推測して何度も間違えた経緯があるため、
// 今後はこのファイルだけを正とし、他の場所では推測しないこと。

export const SALES_CONFLICT_COLUMNS = "target_month_raw,staff_code,customer_code";

// 2026年9月、taiko-proのpg_constraintで実際に確認済み(統合版の新purchasesテーブル):
//   UNIQUE (purchase_number, purchase_line) -- 制約名 purchases_purchase_number_purchase_line_key
export const PURCHASES_CONFLICT_COLUMNS = "purchase_number,purchase_line";
export const PRODUCT_MASTER_CONFLICT_COLUMNS = "product_code";
export const SUPPLIER_MASTER_CONFLICT_COLUMNS = "supplier_code";
