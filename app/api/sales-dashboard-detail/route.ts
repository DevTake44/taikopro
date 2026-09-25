import { NextRequest, NextResponse } from "next/server";
import { getSalesDetailDashboardCore, buildSalesDetailDashboardFor } from "@/lib/salesDashboardCore";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// 売上ダッシュボード明細(/sales-detail)がブラウザ側から呼ぶAPI。app/api/sales-dashboard
// と同じ考え方(通常時はキャッシュ済み、?until指定時だけその場で再計算)。
export async function GET(req: NextRequest) {
  try {
    const core = await getSalesDetailDashboardCore();
    const untilRaw = req.nextUrl.searchParams.get("until");
    const selectedUntil = untilRaw && core.availableMonths.includes(untilRaw) ? untilRaw : null;
    const data = selectedUntil ? await buildSalesDetailDashboardFor(selectedUntil) : core.fullDataset;

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
