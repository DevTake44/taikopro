import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { RoomReservationLog } from "@/lib/roomReservation";

export const dynamic = "force-dynamic";

// 履歴画面用。予約の対象日(reservation_date)基準の範囲と、申請者名の絞り込みに対応する。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const q = searchParams.get("q")?.trim();

  if (!from || !to) {
    return NextResponse.json({ error: "from・toは必須です。" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  let query = supabase
    .from("room_reservation_logs")
    .select("*")
    .gte("reservation_date", from)
    .lte("reservation_date", to)
    .order("action_at", { ascending: false });

  if (q) {
    query = query.ilike("applicant_name", `%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: (data ?? []) as RoomReservationLog[] });
}
