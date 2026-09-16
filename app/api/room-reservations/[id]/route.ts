import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { ROOM_LOCATION_CODE, isValidTimeRange, timesOverlap, type RoomReservation } from "@/lib/roomReservation";

export const dynamic = "force-dynamic";

// 変更・削除どちらも「本人確認」として、申請者名の再入力が予約に記録されている
// applicant_nameと完全一致することを必須とする(ログイン機能が無いための代替措置)。
async function verifyApplicant(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  id: string,
  applicantNameInput: string
): Promise<{ row: RoomReservation | null; error: NextResponse | null }> {
  const { data: row, error } = await supabase.from("room_reservations").select("*").eq("id", id).single();
  if (error || !row) {
    return { row: null, error: NextResponse.json({ error: "対象の予約が見つかりません。" }, { status: 404 }) };
  }
  if (row.applicant_name !== applicantNameInput.trim()) {
    return {
      row: null,
      error: NextResponse.json(
        { error: "申請者名が一致しません。この予約を登録した本人の名前を入力してください。" },
        { status: 403 }
      ),
    };
  }
  return { row: row as RoomReservation, error: null };
}

// 予約の変更。本人確認 → 重複チェック(自分自身は除く) → 更新 → ログ記録。
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: {
    applicant_name?: string;
    reservation_date?: string;
    start_time?: string;
    end_time?: string;
    visitor_name?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です。" }, { status: 400 });
  }

  const { applicant_name, reservation_date, start_time, end_time } = body;
  const visitor_name = body.visitor_name?.trim() || null;

  if (!applicant_name?.trim()) {
    return NextResponse.json({ error: "申請者名は必須です。" }, { status: 400 });
  }
  if (!reservation_date || !start_time || !end_time) {
    return NextResponse.json({ error: "日付・開始時刻・終了時刻は必須です。" }, { status: 400 });
  }
  if (!isValidTimeRange(start_time, end_time)) {
    return NextResponse.json({ error: "終了時刻は開始時刻より後にしてください。" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { row: before, error: verifyError } = await verifyApplicant(supabase, params.id, applicant_name);
  if (verifyError) return verifyError;

  const { data: existing, error: fetchError } = await supabase
    .from("room_reservations")
    .select("id, start_time, end_time")
    .eq("location_code", ROOM_LOCATION_CODE)
    .eq("reservation_date", reservation_date)
    .neq("id", params.id);

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

  const { data: updated, error: updateError } = await supabase
    .from("room_reservations")
    .update({
      reservation_date,
      start_time,
      end_time,
      visitor_name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .select("*")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { error: logError } = await supabase.from("room_reservation_logs").insert({
    reservation_id: updated.id,
    action: "updated",
    applicant_name: updated.applicant_name,
    reservation_date: updated.reservation_date,
    detail: {
      before: {
        reservation_date: before!.reservation_date,
        start_time: before!.start_time,
        end_time: before!.end_time,
        visitor_name: before!.visitor_name,
      },
      after: {
        reservation_date: updated.reservation_date,
        start_time: updated.start_time,
        end_time: updated.end_time,
        visitor_name: updated.visitor_name,
      },
    },
  });
  if (logError) {
    return NextResponse.json({ error: `予約は更新されましたが、ログの記録に失敗しました: ${logError.message}` }, { status: 500 });
  }

  return NextResponse.json({ row: updated as RoomReservation });
}

// 予約の削除。本人確認 → 削除 → ログ記録(削除内容を保存)。
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { applicant_name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です。" }, { status: 400 });
  }

  if (!body.applicant_name?.trim()) {
    return NextResponse.json({ error: "申請者名は必須です。" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { row: target, error: verifyError } = await verifyApplicant(supabase, params.id, body.applicant_name);
  if (verifyError) return verifyError;

  const { error: deleteError } = await supabase.from("room_reservations").delete().eq("id", params.id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const { error: logError } = await supabase.from("room_reservation_logs").insert({
    reservation_id: target!.id,
    action: "deleted",
    applicant_name: target!.applicant_name,
    reservation_date: target!.reservation_date,
    detail: {
      deleted: {
        reservation_date: target!.reservation_date,
        start_time: target!.start_time,
        end_time: target!.end_time,
        applicant_name: target!.applicant_name,
        visitor_name: target!.visitor_name,
      },
    },
  });
  if (logError) {
    return NextResponse.json({ error: `予約は削除されましたが、ログの記録に失敗しました: ${logError.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
