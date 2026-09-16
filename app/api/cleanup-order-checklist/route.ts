import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const maxDuration = 60;
export const runtime = "nodejs";

// 受注データCSVは対象月度の全件を毎回まるごと出力したものという想定。
// commit-order-checklist(upsert)だけでは、CSVから消えた行(受注取消等)が
// DBに残り続けてしまうため、アップロードされたCSVに実際に含まれていた
// 受注番号だけを「正」とみなし、対象月度の中でそれ以外の行を削除する。
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const months = body?.months as string[] | undefined;
    const orderNos = body?.orderNos as string[] | undefined;

    if (!months || !Array.isArray(months) || months.length === 0) {
      return NextResponse.json({ error: "対象月度が指定されていません。" }, { status: 400 });
    }
    if (!orderNos || !Array.isArray(orderNos)) {
      return NextResponse.json({ error: "受注番号一覧が指定されていません。" }, { status: 400 });
    }

    const orderNoSet = new Set(orderNos);
    const supabase = getSupabaseServerClient();

    const { data: existing, error: selectError } = await supabase
      .from("order_checklist")
      .select("id, order_no")
      .in("target_month", months);

    if (selectError) {
      return NextResponse.json(
        { error: `既存データの確認中にエラーが発生しました: ${selectError.message}` },
        { status: 500 }
      );
    }

    const idsToDelete = (existing ?? []).filter((r) => !orderNoSet.has(r.order_no)).map((r) => r.id);

    if (idsToDelete.length > 0) {
      const { error: deleteError } = await supabase.from("order_checklist").delete().in("id", idsToDelete);
      if (deleteError) {
        return NextResponse.json(
          { error: `不要データの削除中にエラーが発生しました: ${deleteError.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true, deletedCount: idsToDelete.length });
  } catch (e) {
    return NextResponse.json(
      { error: "予期しないエラーが発生しました: " + (e instanceof Error ? e.message : String(e)) },
      { status: 500 }
    );
  }
}
