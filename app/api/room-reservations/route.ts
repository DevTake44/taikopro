import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { ROOM_LOCATION_CODE, isValidTimeRange, timesOverlap, type RoomReservation } from "@/lib/roomReservation";

export const dynamic = "force-dynamic";

// 週表示のカレンダー用に、指定した日付範囲(reservation_date)の予約を全件取得する。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: "from・toは必須です。" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("room_reservations")
    .select("*")
    .eq("location_code", ROOM_LOCATION_CODE)
    .gte("reservation_date", from)
    .lte("reservation_date", to)
    .order("reservation_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: (data ?? []) as RoomReservation[] });
}

// 新規予約の登録。重複チェックはここ(サーバー側)で必ず行う。
export async function POST(req: NextRequest) {
  let body: {
    reservation_date?: string;
    start_time?: string;
    end_time?: string;
    applicant_name?: string;
    visitor_name?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です。" }, { status: 400 });
  }

  const { reservation_date, start_time, end_time, applicant_name } = body;
  const visitor_name = body.visitor_name?.trim() || null;

  if (!reservation_date || !start_time || !end_time || !applicant_name?.trim()) {
    return NextResponse.json({ error: "日付・開始時刻・終了時刻・申請者名は必須です。" }, { status: 400 });
  }
  if (!isValidTimeRange(start_time, end_time)) {
    return NextResponse.json({ error: "終了時刻は開始時刻より後にしてください。" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  // 同一拠点・同一日の既存予約を取得し、時間帯の重複をアプリ側でチェックする。
  const { data: existing, error: fetchError } = await supabase
    .from("room_reservations")
    .select("id, start_time, end_time")
    .eq("location_code", ROOM_LOCATION_CODE)
    .eq("reservation_date", reservation_date);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const conflict = (existing ?? []).find((r) => timesOverlap(start_time, end_time, r.start_time, r.end_time));
  if (conflict) {
    return NextResponse.json(
      { error: "この時間帯には既に別の予約があります。時間を確認してください。" },
      { status: 409 }
    );
  }

  const { data: inserted, error: insertError } = await supabase
    .from("room_reservations")
    .insert({
      location_code: ROOM_LOCATION_CODE,
      reservation_date,
      start_time,
      end_time,
      applicant_name: applicant_name.trim(),
      visitor_name,
    })
    .select("*")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { error: logError } = await supabase.from("room_reservation_logs").insert({
    reservation_id: inserted.id,
    action: "created",
    applicant_name: inserted.applicant_name,
    reservation_date: inserted.reservation_date,
    detail: {
      after: {
        reservation_date: inserted.reservation_date,
        start_time: inserted.start_time,
        end_time: inserted.end_time,
        applicant_name: inserted.applicant_name,
        visitor_name: inserted.visitor_name,
      },
    },
  });
  if (logError) {
    return NextResponse.json({ error: `予約は登録されましたが、ログの記録に失敗しました: ${logError.message}` }, { status: 500 });
  }

  return NextResponse.json({ row: inserted as RoomReservation });
}
