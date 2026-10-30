import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { logUpload } from "@/lib/logUpload";

export const maxDuration = 60;
export const runtime = "nodejs";

const PAGE_SIZE = 1000;

type ExistingRow = { id: number; target_month_raw: string; staff_code: string | null; customer_code: string | null };

// Supabase(PostgREST)は、limitを指定しないSELECTを既定で1,000件までしか
// 返さない。対象月度のデータが1,000件を超えると、以降の既存データが
// クリーンアップの比較対象から漏れ(削除すべき行が永久に消えずに残り)続けて
// しまうため、rangeで全ページを読み切るまでループする。
async function fetchAllExisting(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  months: string[]
): Promise<ExistingRow[]> {
  const rows: ExistingRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("sales_monthly")
      .select("id, target_month_raw, staff_code, customer_code")
      .in("target_month_raw", months)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as ExistingRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

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
    let existing: ExistingRow[];
    try {
      existing = await fetchAllExisting(supabase, months);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await logUpload({
        uploadType: "sales_monthly",
        action: "cleanup",
        success: false,
        errorMessage: message,
      });
      return NextResponse.json(
        { error: `既存データの確認中にエラーが発生しました: ${message}` },
        { status: 500 }
      );
    }

    const idsToDelete = existing
      .filter((r) => !keySet.has(`${r.target_month_raw}|${r.staff_code}|${r.customer_code}`))
      .map((r) => r.id);

    // 削除対象が多いと1回のIN句が大きくなりすぎるため、チャンクに分けて削除する。
    for (let i = 0; i < idsToDelete.length; i += PAGE_SIZE) {
      const chunk = idsToDelete.slice(i, i + PAGE_SIZE);
      const { error: deleteError } = await supabase.from("sales_monthly").delete().in("id", chunk);

      if (deleteError) {
        await logUpload({
          uploadType: "sales_monthly",
          action: "cleanup",
          deletedCount: i,
          success: false,
          errorMessage: deleteError.message,
        });
        return NextResponse.json(
          { error: `不要データの削除中にエラーが発生しました: ${deleteError.message}` },
          { status: 500 }
        );
      }
    }

    await logUpload({
      uploadType: "sales_monthly",
      action: "cleanup",
      deletedCount: idsToDelete.length,
      success: true,
    });
    return NextResponse.json({ success: true, deletedCount: idsToDelete.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logUpload({ uploadType: "sales_monthly", action: "cleanup", success: false, errorMessage: message });
    return NextResponse.json(
      { error: "予期しないエラーが発生しました: " + message },
      { status: 500 }
    );
  }
}
