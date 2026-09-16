// 未売上受注チェック機能の共通の型・表示ロジック。
export type UnsoldOrderRow = {
  order_no: string;
  target_month: string;
  order_date: string;
  customer_code: string;
  customer_name: string;
  due_date: string;
  order_amount: number;
  sold_amount: number;
  unsold_amount: number;
  rep_code: string;
  rep_name: string;
  closing_day: number | null;
};

// 締日の表示形式。99=末締め、それ以外はその日、customer_masterに無い場合はnull=締め日不明。
export function formatClosingDay(closingDay: number | null): string {
  if (closingDay === null) return "締め日不明";
  if (closingDay === 99) return "末締め";
  return `${closingDay}日締め`;
}

// グルーピング・並び替え用のソートキー。末締め(99)は通常の日にちの後、締め日不明(null)は最後。
export function closingDaySortKey(closingDay: number | null): number {
  if (closingDay === null) return 1000;
  return closingDay;
}
