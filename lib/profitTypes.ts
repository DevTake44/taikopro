// rieki-check-appの「売上利益」機能から移植した型定義。
// public.v_profit_by_order / public.profit_summary (いずれもマテリアライズドビュー/テーブル。
// taiko-proに移行済み)の1行の形。

// public.v_price_increase_alerts マテリアライズドビューの1行の型(値上げ検知ダッシュボード)
export type PriceIncreaseAlert = {
  category: "直送" | "在庫";
  order_no: string | null;
  item_code: string | null;
  item_name: string | null;
  customer_name: string | null;
  supplier_name: string | null;
  branch_code: string | null;
  rep_code: string | null;
  order_date: string | null;
  purchase_date: string | null;
  assumed_cost: number;
  actual_price: number;
  sell_price: number | null;
  qty: number;
  gap: number;
  gap_pct: number | null;
  actual_margin_pct: number | null;
  planned_margin_pct: number | null;
  impact: number;
};

// public.v_profit_lines マテリアライズドビューの1行の型のうち、経営マトリクス(月別集計)で
// 使っていた列だけに絞ったもの。現在は経営マトリクスの読み込み元がprofit_summaryに
// 切り替わっており呼び出し元が無いが、lib/profit-cache.ts側の型として残っている。
export type ProfitLine = {
  sales_line_id: number;
  branch_code: string | null;
  rep_code: string | null;
  customer_code: string | null;
  customer_name: string | null;
  delivery_date: string | null;
  revenue: number;
  cost: number;
};

// public.v_profit_by_order マテリアライズドビューの1行の型(利益ダッシュボード・受注番号単位)
export type ProfitOrder = {
  order_no: string;
  customer_code: string | null;
  customer_name: string | null;
  project_name: string | null;
  rep_code: string | null;
  branch_code: string | null;
  order_date: string | null;
  delivery_date: string | null;
  line_count: number;
  revenue: number;
  cost: number;
  profit: number;
  // メーカー直送・手配で仕入未登録、かつ売上データ側の原価(assumed_cost)もダミー値(0円/1円等)で
  // 信頼できない行の件数・売上額。このような行は原価不明のため、利益を過大計上しないよう
  // 暫定的に「原価=売上(利益0円)」として計算している。
  unconfirmed_cost_line_count: number;
  unconfirmed_cost_revenue: number;
};

// public.profit_summary テーブルの1行の型(拠点・営業担当・得意先別 利益集計。20日締め期間単位)
// gross_profit = revenue - cost (売上総利益、いわゆる粗利)
// final_profit = gross_profit - freight_actual (運賃の実費まで差し引いた最終利益)
export type ProfitSummaryRow = {
  id: number;
  period_end: string; // 20日締め期間の末日(例: "2026-06-20")
  branch_code: string; // 不明(運賃だけの孤立行)の場合は ""。それ以外は必ず実コード
  rep_code: string | null;
  customer_code: string | null;
  customer_name: string | null;
  revenue: number;
  cost: number;
  gross_profit: number;
  gross_margin_pct: number | null;
  freight_actual: number;
  final_profit: number;
  final_margin_pct: number | null;
  line_count: number;
  created_at: string;
  updated_at: string;
};
