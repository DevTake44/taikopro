import { NextRequest, NextResponse } from "next/server";
import { getSalesDashboardCore, buildSalesDashboardFor } from "@/lib/salesDashboardCore";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// 経営レポート(/sales)がブラウザ側から呼ぶAPI。中身はunstable_cacheでキャッシュ
// されているため、通常時(?untilなし)は初回か「更新」ボタンが押された後だけ
// 実際にSupabaseへ問い合わせ・再集計する。?untilを指定した時だけ、その場で
// (キャッシュを使わず)絞り込んだ結果を計算し直す。
export async function GET(req: NextRequest) {
  try {
    const core = await getSalesDashboardCore();
    const untilRaw = req.nextUrl.searchParams.get("until");
    const selectedUntil = untilRaw && core.availableMonths.includes(untilRaw) ? untilRaw : null;
    const data = selectedUntil ? await buildSalesDashboardFor(selectedUntil) : core.fullDataset;

    return NextResponse.json({
      data,
      stockDetailByYear: core.stockDetailByYear,
      stockMovementByYear: core.stockMovementByYear,
      stockMovementError: core.stockMovementError,
      availableMonths: core.availableMonths,
      selectedUntil,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "不明なエラーが発生しました。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
