import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const maxDuration = 60;
export const runtime = "nodejs";

// 売上データの更新は「伝票単位の追加」ではなく、その月の全件を毎回まるごと
// 出力したCSVをアップロードする運用。commit-sales(upsert)だけでは、
// 得意先コードの統合・削除などでCSVから消えた行がDBに残り続けてしまう。
// このAPIは、アップロードされたCSVに実際に含まれていた(target_month_raw,
// staff_code, customer_code)の組み合わせだけを「正」とみなし、
// 対象月の中でそれ以外の行(=今回のCSVに存在しない行)をDBから削除する。
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const months = body?.months as string[] | undefined;
    const keys = body?.keys as string[] | undefined;

    if (!months || !Array.isArray(months) || months.length === 0) {
      return NextResponse.json({ error: "対象月度が指定されていません。" }, { status: 400 });
    }
    if (!keys || !Array.isArray(keys)) {
      return NextResponse.json({ error: "データのキー一覧が指定されていません。" }, { status: 400 });
    }

    const keySet = new Set(keys);
    const supabase = getSupabaseServerClient();

    // 対象月度に該当する既存データを、DBから全件取得する
    // (idと、キー判定に使う3列だけ)。
    const { data: existing, error: selectError } = await supabase
      .from("sales_monthly")
      .select("id, target_month_raw, staff_code, customer_code")
      .in("target_month_raw", months);

    if (selectError) {
      return NextResponse.json(
        { error: `既存データの確認中にエラーが発生しました: ${selectError.message}` },
        { status: 500 }
      );
    }

    const idsToDelete = (existing ?? [])
      .filter((r) => !keySet.has(`${r.target_month_raw}|${r.staff_code}|${r.customer_code}`))
      .map((r) => r.id);

    if (idsToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from("sales_monthly")
        .delete()
        .in("id", idsToDelete);

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
