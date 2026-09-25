import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { SALES_DATA_CACHE_TAG } from "@/lib/salesDataCache";

// 売上管理(経営レポート・売上ダッシュボード明細)画面の「更新」ボタンから呼ばれる。
// lib/fetchMonthly.ts等でunstable_cacheにタグ付けしたSupabaseからのデータ取得結果を
// まとめて無効化する。次回アクセス時にSupabaseへ実際に取得しに行き、以降はまた
// このボタンが押されるまでその結果を使い回す。
export async function POST() {
  revalidateTag(SALES_DATA_CACHE_TAG);
  return NextResponse.json({ success: true });
}
