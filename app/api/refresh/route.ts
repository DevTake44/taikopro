import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

// マテリアライズドビューの再集計(REFRESH)は、データ量によっては数秒〜数分かかることが
// あるため、Vercelの関数タイムアウトをDB側のタイムアウト(10分、各refresh_*関数側で設定)に
// 近い余裕を持たせて延長しておく。
export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST() {
  try {
    const supabase = getSupabaseServerClient();

    const { error: monthlyError } = await supabase.rpc("refresh_v_monthly");
    if (monthlyError) {
      return NextResponse.json(
        { error: `経営報告(v_monthly)の更新に失敗しました: ${monthlyError.message}` },
        { status: 500 }
      );
    }

    const { error: priceIncreaseError } = await supabase.rpc("refresh_price_increase_views");
    if (priceIncreaseError) {
      return NextResponse.json(
        { error: `値上げ検知の更新に失敗しました: ${priceIncreaseError.message}` },
        { status: 500 }
      );
    }

    const { error: profitError } = await supabase.rpc("refresh_profit_views");
    if (profitError) {
      return NextResponse.json(
        { error: `売上利益の更新に失敗しました: ${profitError.message}` },
        { status: 500 }
      );
    }

    const { error: profitSummaryError } = await supabase.rpc("refresh_profit_summary");
    if (profitSummaryError) {
      return NextResponse.json(
        { error: `拠点・営業・得意先利益の更新に失敗しました: ${profitSummaryError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, refreshed: true });
  } catch (e) {
    return NextResponse.json(
      { error: "予期しないエラーが発生しました: " + (e instanceof Error ? e.message : String(e)) },
      { status: 500 }
    );
  }
}
