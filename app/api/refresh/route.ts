import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const maxDuration = 30;
export const runtime = "nodejs";

export async function POST() {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.rpc("refresh_v_monthly");
    if (error) {
      return NextResponse.json(
        { error: `画面用データの更新(refresh)に失敗しました: ${error.message}` },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: "予期しないエラーが発生しました: " + (e instanceof Error ? e.message : String(e)) },
      { status: 500 }
    );
  }
}
