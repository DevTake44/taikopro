import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { logUpload } from "@/lib/logUpload";
import type { OrderHistoryRow } from "@/lib/orderHistoryTransform";

export const maxDuration = 60;
export const runtime = "nodejs";

// 受注出力CSVの明細を order_history_lines に upsert する(受注番号+行番号で上書き)。
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows = body?.rows as OrderHistoryRow[] | undefined;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "反映するデータがありません。" }, { status: 400 });
    }
    const nowIso = new Date().toISOString();
    const payload = rows.map((r) => ({ ...r, updated_at: nowIso }));
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("order_history_lines").upsert(payload, { onConflict: "order_no,order_line" });
    if (error) {
      await logUpload({ uploadType: "order_history_lines", rowCount: rows.length, success: false, errorMessage: error.message });
      return NextResponse.json({ error: `本番データへの反映中にエラーが発生しました: ${error.message}` }, { status: 500 });
    }
    await logUpload({ uploadType: "order_history_lines", rowCount: rows.length, success: true });
    return NextResponse.json({ success: true, count: rows.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logUpload({ uploadType: "order_history_lines", success: false, errorMessage: message });
    return NextResponse.json({ error: "予期しないエラーが発生しました: " + message }, { status: 500 });
  }
}
