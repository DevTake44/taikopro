// v_monthly ビュー(Supabase)から返ってくる1行の形
export type MonthlyRow = {
  month: string; // 例: "2025-10-01"
  fiscal_year: number;
  location_code: string;
  location_name: string | null;
  staff_code: string;
  staff_name: string | null;
  customer_code: string;
  customer_name: string | null;
  sales_amount: number;
  purchase_amount: number;
  profit: number;
  margin_pct: number;
  has_purchase: boolean;
};
export type MonthCell = { s: number; p: number; m: number | null };
export type PrevCell = { s: number; p: number };
export type MatrixRow = {
  code: string;
  name: string;
  cur: MonthCell[]; // 12ヶ月分(10月始まり)
  prev: PrevCell[]; // 12ヶ月分
  cur_ts: number; // 今期トータル売上
  cur_tp: number; // 今期トータル仕入
  cur_tm: number | null; // 今期トータル粗利率
 prev_ts: number; // 前期トータル売上(通年)
  prev_tp: number; // 前期トータル仕入(通年)
  prev_ts_same: number; // 前期売上(今期と同じ期間分だけ)
  prev_tp_same: number; // 前期仕入(今期と同じ期間分だけ)
  prev_tm: number | null; // 前期トータル粗利率
  target: number | null; // 個別目標粗利率(前期+3pt)
};
export type TrendPoint = { ym: string; sales: number; pur: number; profit: number };
export type Summary = {
  CUR: number;
  PREV: number;
  n_sales: number;
  n_full: number;
  latest_pi: number;
  cur_sales: number;
  cur_profit_full: number;
  cur_margin: number;
  prev_sales_total: number;
  prev_profit_total: number;
  prev_margin: number;
  prev_sales_same: number;
  sales_yoy: number;
  prev_margin_same: number;
  prev_profit_same: number;
  target_margin: number;
  fc_simple: number;
  fc_seasonal: number;
};
export type StockData = {
  cur: number[];
  prev: number[];
  cur_total: number;
  prev_total: number;
  prev_same: number;
  n_cur: number;
  yoy_pct: number | null;
};
// 月別マトリクス専用: 会計年度ごとの、拠点/担当者/得意先別の月次データ。
// 「今期 vs 前期」のように2期をあらかじめ固定でペアにするのではなく、画面側で
// 表示期間・対比期間を自由に選べるようにするため、年度ごとに独立した形で持つ。
export type YearMonthCell = { s: number; p: number };
export type YearDimRow = {
  code: string;
  name: string;
  months: YearMonthCell[]; // 12ヶ月分(その会計年度の10月始まり)
  total_s: number;
  total_p: number;
};
export type YearMatrixSet = {
  loc: YearDimRow[];
  staff: YearDimRow[];
  cust: YearDimRow[]; // 得意先は当該年度の売上上位100件のみ
  cust_total_count: number; // 得意先の全件数(絞り込み前)
};

// public.v_internal_transfer_lines マテリアライズドビューの1行の型(社内間金額・確定分)
export type InternalTransferLine = {
  sales_line_id: number;
  branch_code: string | null;
  delivery_date: string | null;
  order_date: string | null;
  arrange_type: string;
  loc_code: string | null;
  loc_name: string | null;
  item_code: string | null;
  item_name: string | null;
  qty: number;
  assumed_cost: number;
  amount: number;
};

// public.stock_transfer_pending テーブルの1行の型(社内間金額・未納品分)
export type TransferPendingLine = {
  id: number;
  order_no: string | null;
  order_line: string | null;
  order_date: string | null;
  branch_code: string | null;
  shipping_code: string | null;
  shipping_name: string | null;
  delivery_dest_name: string | null;
  customer_name: string | null;
  item_code: string | null;
  item_name: string | null;
  order_qty: number | null;
  delivery_qty: number | null;
  assumed_cost: number | null;
  created_at: string;
};

export type DashboardData = {
  summary: Summary;
  cur_months: string[];
  prev_months: string[];
  trend_cur: TrendPoint[];
  trend_prev: TrendPoint[];
  latest_ym: string;
  mat_loc: MatrixRow[];
  mat_staff: MatrixRow[];
  mat_cust: MatrixRow[];
  cust_total_count: number;
  // 会計年度(例: 2025)をキーにした、月別マトリクス用の生データ。
  fiscalYears: number[]; // データが存在する会計年度の一覧(昇順)
  matrixByYear: Record<number, YearMatrixSet>;
  stock: StockData;
};
