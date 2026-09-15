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
  // 月別マトリクス専用: 前々期 vs 前期(=今期を基準にした「1つ前のペア」)の比較データ。
  // 期首(10月)直後は今期がまだ1ヶ月分しかなく「今期 vs 前期」が役に立たないため、
  // 1年ずらしたペアも見られるようにしたもの。データが3期分無い場合はnull。
  mat_loc_prev: MatrixRow[] | null;
  mat_staff_prev: MatrixRow[] | null;
  mat_cust_prev: MatrixRow[] | null;
  cust_total_count_prev: number;
  stock: StockData;
};
