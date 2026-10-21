// 20日締めの月単位(202605, 202606, ...)で期間を扱うための共通ヘルパー。
// 元データ(202606 社内間.xlsx)や社内間金額ダッシュボードと同じルール:
// 例: 202606 は 5/21〜6/20。日付が21日以降ならその翌月の締め月に属する。
export function periodKeyFor(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  let py = y;
  let pm = m;
  if (d > 20) {
    pm += 1;
    if (pm > 12) {
      pm = 1;
      py += 1;
    }
  }
  return `${py}${String(pm).padStart(2, "0")}`;
}

export function periodRangeFor(key: string): { from: string; to: string } {
  const y = parseInt(key.slice(0, 4), 10);
  const m = parseInt(key.slice(4, 6), 10);
  let fy = y;
  let fm = m - 1;
  if (fm < 1) {
    fm = 12;
    fy -= 1;
  }
  return {
    from: `${fy}-${String(fm).padStart(2, "0")}-21`,
    to: `${y}-${String(m).padStart(2, "0")}-20`,
  };
}

export function periodLabelFor(key: string): string {
  const y = key.slice(0, 4);
  const m = parseInt(key.slice(4, 6), 10);
  const { from, to } = periodRangeFor(key);
  const fromMd = from.slice(5).replace("-", "/");
  const toMd = to.slice(5).replace("-", "/");
  return `${y}年${m}月度(${fromMd}〜${toMd})`;
}

// 決算期(1年=10月度〜翌年9月度、日付にすると9/21〜翌年9/20)関連のヘルパー。
// 「今期」「前期」の切り替えなど、1年まとめての絞り込みに使う。
const FISCAL_START_MONTH = 10;

// あるperiodKey("202606"など)が属する決算期を、期首の西暦年(10月度の年)で返す。
// 例: "202606"(2026年6月度) → 期首は2025年10月 → 2025を返す。
// 例: "202511"(2025年11月度) → 期首は2025年10月 → 2025を返す。
export function fiscalYearStartOf(periodKey: string): number {
  const y = parseInt(periodKey.slice(0, 4), 10);
  const m = parseInt(periodKey.slice(4, 6), 10);
  return m >= FISCAL_START_MONTH ? y : y - 1;
}

// 決算期(期首の西暦年で指定)に属する12個のperiodKeyを、期首月から順番に返す。
export function fiscalYearPeriods(startCalYear: number): string[] {
  const periods: string[] = [];
  for (let i = 0; i < 12; i++) {
    let m = FISCAL_START_MONTH + i;
    let y = startCalYear;
    if (m > 12) {
      m -= 12;
      y += 1;
    }
    periods.push(`${y}${String(m).padStart(2, "0")}`);
  }
  return periods;
}

export function fiscalYearRangeFor(startCalYear: number): { from: string; to: string } {
  const periods = fiscalYearPeriods(startCalYear);
  return {
    from: periodRangeFor(periods[0]).from,
    to: periodRangeFor(periods[periods.length - 1]).to,
  };
}

export function fiscalYearLabel(startCalYear: number): string {
  return `${startCalYear}年10月期(${startCalYear}/10〜${startCalYear + 1}/9)`;
}

// 四半期(10-12月/1-3月/4-6月/7-9月、20日締め)関連のヘルパー。
// 決算期の4四半期は、FISCAL_START_MONTHが10のため暦の四半期(1-3,4-6,7-9,10-12月)と
// たまたま完全に一致する(DB側のマテリアライズドビューもdate_trunc('quarter', ...)を使用)。

// 決算期(期首の西暦年)に属する4つの四半期末日("YYYY-MM-DD")を、期首側から順に返す。
export function fiscalYearQuarterEnds(startCalYear: number): string[] {
  const periods = fiscalYearPeriods(startCalYear);
  return [0, 1, 2, 3].map((q) => periodRangeFor(periods[q * 3 + 2]).to);
}

const QUARTER_NUMBER_BY_END_MONTH: Record<number, number> = { 12: 1, 3: 2, 6: 3, 9: 4 };

// 四半期末日("YYYY-MM-DD")から、決算期内の四半期番号(1〜4)を返す。
export function quarterNumberFor(quarterEndDate: string): number {
  const m = parseInt(quarterEndDate.slice(5, 7), 10);
  return QUARTER_NUMBER_BY_END_MONTH[m] ?? 0;
}

export function quarterLabelFor(quarterEndDate: string): string {
  const y = quarterEndDate.slice(0, 4);
  const m = parseInt(quarterEndDate.slice(5, 7), 10);
  const startMonth = m === 12 ? 10 : m - 2;
  const qNum = quarterNumberFor(quarterEndDate);
  return `${y}年${startMonth}-${m}月期(第${qNum}四半期)`;
}

// 1年前の同じ四半期の末日を返す(昨対比用)。
export function sameQuarterLastYear(quarterEndDate: string): string {
  const prevYear = parseInt(quarterEndDate.slice(0, 4), 10) - 1;
  return `${prevYear}${quarterEndDate.slice(4)}`;
}
