// 会計月度に関する共通の計算処理
// 会社の期は10月始まり・9月終わり。締め日は毎月20日。

/** "2025-10-01" のような日付文字列から "202510" 形式を作る */
export function ymFromDate(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}${String(m).padStart(2, "0")}`;
}

/** "202510" 形式から会計年度（10月なら同じ年、1〜9月なら前年）を求める */
export function fiscalYearOf(ym: string): number {
  const y = parseInt(ym.slice(0, 4), 10);
  const m = parseInt(ym.slice(4, 6), 10);
  return m >= 10 ? y : y - 1;
}

/** "202510" 形式から、期の中で何ヶ月目か（10月=0, 11月=1, ..., 9月=11）を求める */
export function periodIndexOf(ym: string): number {
  const m = parseInt(ym.slice(4, 6), 10);
  return (m - 10 + 12) % 12;
}

/** 指定した会計年度(fiscalYear)の12ヶ月分の "YYYYMM" 一覧を、10月始まりで返す */
export function monthsOfFiscalYear(fiscalYear: number): string[] {
  const months: string[] = [];
  for (const m of [10, 11, 12]) months.push(`${fiscalYear}${String(m).padStart(2, "0")}`);
  for (const m of [1, 2, 3, 4, 5, 6, 7, 8, 9]) months.push(`${fiscalYear + 1}${String(m).padStart(2, "0")}`);
  return months;
}

/** 今日の日付から、現在の会計年度の期末日("YYYY-09-20")を求める。10月になると自動的に翌年の期末に切り替わる。 */
export function currentFiscalPeriodEndDate(today: Date = new Date()): string {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const ym = `${y}${String(m).padStart(2, "0")}`;
  const fiscalYear = fiscalYearOf(ym);
  return `${fiscalYear + 1}-09-20`;
}
