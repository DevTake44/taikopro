export const maxDuration = 60;

import Link from "next/link";
import { fetchAllMonthlyRows } from "@/lib/fetchMonthly";
import { fetchStockDetailRows } from "@/lib/fetchStockDetail";
import { fetchPurchaseLots, fetchStockShipments, fetchProductAliasGroups } from "@/lib/fetchStockMovement";
import { buildDashboard } from "@/lib/buildDashboard";
import { buildStockDetail } from "@/lib/buildStockDetail";
import { buildStockMovement } from "@/lib/buildStockMovement";
import type { StockMovementData } from "@/lib/buildStockMovement";
import { ymFromDate, fiscalYearEndDate } from "@/lib/fiscal";
import SalesDashboardClient from "@/components/SalesDashboardClient";

// 常に最新データを取得する(キャッシュしない)
export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams?: { until?: string };
}) {
  try {
    const [rows, stockRows] = await Promise.all([fetchAllMonthlyRows(), fetchStockDetailRows()]);

    // 「何月度まで見るか」の絞り込み機能。
    // 例えば8月分の仕入データがまだ入力途中で確定していない時、8月を除いて
    // 「7月度まで確定した状態で見たらどうだったか」を見られるようにするためのもの。
    const fullDataset = buildDashboard(rows);
    const availableMonths = fullDataset.trend_cur.filter((t) => t.sales > 0).map((t) => t.ym);

    const untilRaw = searchParams?.until;
    const selectedUntil = untilRaw && availableMonths.includes(untilRaw) ? untilRaw : null;
    const rowsForDashboard = selectedUntil
      ? rows.filter((r) => ymFromDate(r.month) <= selectedUntil)
      : rows;

    const data = selectedUntil ? buildDashboard(rowsForDashboard) : fullDataset;

    // 「在庫」タブの期選択用。経営レポートと同じく、各会計年度を今期扱いにした
    // 場合の一式を作っておく(CURはfiscalYearsに無くても必ず入れる)。
    const stockYears = Array.from(new Set([data.summary.CUR, ...data.fiscalYears]));
    const stockDetailByYear = Object.fromEntries(
      stockYears.map((y) => [y, buildStockDetail(stockRows, y, y - 1)])
    );

    // 不動在庫チェックは、まだ環境変数が未設定の場合もあるため、ここで失敗しても
    // 他のタブは表示できるように、別途catchする。
    // 「在庫」タブの期選択と連動させるため、選んだ年度を「今期」として、その年度の期末日
    // までの仕入・出荷だけでFIFO計算をやり直す(過去の完結した年度のスナップショット)。
    // 今期(CUR)だけは実際の「今日」・全データのまま(従来通り)。
    let stockMovementByYear: Record<number, StockMovementData | null> = {};
    let stockMovementError: string | null = null;
    try {
      const [purchaseLots, shipments, productAliasRecord] = await Promise.all([
        fetchPurchaseLots(),
        fetchStockShipments(),
        fetchProductAliasGroups(),
      ]);
      const productAliasMap = new Map(Object.entries(productAliasRecord));
      const today = new Date().toISOString().slice(0, 10);
      stockMovementByYear = Object.fromEntries(
        stockYears.map((y) => {
          if (y === data.summary.CUR) {
            return [y, buildStockMovement(purchaseLots, shipments, today, productAliasMap)];
          }
          const cutoff = fiscalYearEndDate(y);
          const purchasesUntilCutoff = purchaseLots.filter((r) => r.purchase_date && r.purchase_date <= cutoff);
          const shipmentsUntilCutoff = shipments.filter((r) => r.delivery_date && r.delivery_date <= cutoff);
          return [y, buildStockMovement(purchasesUntilCutoff, shipmentsUntilCutoff, cutoff, productAliasMap)];
        })
      );
    } catch (e) {
      stockMovementError = e instanceof Error ? e.message : "不明なエラーが発生しました。";
    }

    return (
      <SalesDashboardClient
        data={data}
        stockDetailByYear={stockDetailByYear}
        stockMovementByYear={stockMovementByYear}
        stockMovementError={stockMovementError}
        availableMonths={availableMonths}
        selectedUntil={selectedUntil}
      />
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラーが発生しました。";
    return (
      <div style={{ maxWidth: 640, margin: "80px auto", padding: 24, fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
          データの読み込みでエラーが発生しました
        </h1>
        <p style={{ fontSize: 14, color: "#555", lineHeight: 1.6 }}>{message}</p>
        <p style={{ fontSize: 13, color: "#888", marginTop: 16 }}>
          Vercelの環境変数(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)が正しく設定されているか、
          Supabase側でデータが正しく入っているかを確認してください。
        </p>
        <p style={{ marginTop: 20 }}>
          <Link href="/menu" className="ghost-btn-inline">
            ← メインメニュー
          </Link>
        </p>
      </div>
    );
  }
}
