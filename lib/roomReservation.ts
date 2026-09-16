// 会議室予約機能の共通の型・定数・バリデーションロジック。
// 対象拠点は東京のみ(location_code="tokyo"固定)。将来拠点が増えることを見越して
// DBにはlocation_codeを持たせているが、現時点ではUIに拠点選択は無い。

export const ROOM_LOCATION_CODE = "tokyo";

export type RoomReservation = {
  id: string;
  location_code: string;
  reservation_date: string; // "YYYY-MM-DD"
  start_time: string; // "HH:MM:SS"
  end_time: string; // "HH:MM:SS"
  applicant_name: string;
  visitor_name: string | null;
  created_at: string;
  updated_at: string;
};

export type RoomReservationLogAction = "created" | "updated" | "deleted";

export type RoomReservationLog = {
  id: string;
  reservation_id: string | null;
  action: RoomReservationLogAction;
  applicant_name: string;
  reservation_date: string;
  detail: unknown;
  action_at: string;
};

// "HH:MM" または "HH:MM:SS" を分数(0〜1439)に変換する。
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// 2つの時間帯が重複しているかを判定する(片方の終了と他方の開始が同時刻なだけなら重複しない)。
export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const as = timeToMinutes(aStart);
  const ae = timeToMinutes(aEnd);
  const bs = timeToMinutes(bStart);
  const be = timeToMinutes(bEnd);
  return as < be && bs < ae;
}

export function isValidTimeRange(startTime: string, endTime: string): boolean {
  return timeToMinutes(endTime) > timeToMinutes(startTime);
}
