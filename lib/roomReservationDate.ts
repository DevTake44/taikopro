// 会議室予約カレンダー用の日付・時間帯ユーティリティ(週表示・9:00〜18:00・30分刻み)。

const WEEKDAY_KANJI = ["日", "月", "火", "水", "木", "金", "土"];

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// 指定した日を含む週の月曜日を返す。
export function mondayOf(d: Date): Date {
  const day = d.getDay(); // 0=日, 1=月, ..., 6=土
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// 月〜金の5日ぶんの日付を返す。
export function weekdaysOf(monday: Date): Date[] {
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
}

// 「9/15(火)」形式(曜日だけの表示は不可、という仕様のため必ず月日を併記する)。
export function formatDateWithWeekday(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_KANJI[d.getDay()]})`;
}

export const DAY_START_MIN = 9 * 60;
export const DAY_END_MIN = 18 * 60;
export const SLOT_MIN = 30;
export const SLOT_COUNT = (DAY_END_MIN - DAY_START_MIN) / SLOT_MIN; // 18

// スロット開始時刻の一覧("09:00","09:30",...,"17:30")
export function slotTimes(): string[] {
  const out: string[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const min = DAY_START_MIN + i * SLOT_MIN;
    out.push(`${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
  }
  return out;
}

export function timeToSlotIndex(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return Math.round((h * 60 + m - DAY_START_MIN) / SLOT_MIN);
}

// 過去2ヶ月・当月・先2ヶ月(計5ヶ月)の範囲を、今日の日付から自動計算する。
export function historyRangeFromToday(today: Date): { from: string; to: string } {
  const fromMonth = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  const toMonth = new Date(today.getFullYear(), today.getMonth() + 3, 0); // 2ヶ月後の月末
  return { from: toDateKey(fromMonth), to: toDateKey(toMonth) };
}
