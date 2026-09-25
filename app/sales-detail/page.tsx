export const maxDuration = 60;

import Link from "next/link";
import { fetchAllProfitSummaryRows } from "@/lib/fetchProfitSummaryAll";
import { profitSummaryToMonthlyRows } from "@/lib/profitSummaryToMonthlyRows";
import { fetchStockOnlyMonthlyRows } from "@/lib/fetchMonthly";
import { fetchStockDetailRows } from "@/lib/fetchStockDetail";
import { fetchPurchaseLots, fetchStockShipments, fetchProductAliasGroups } from "@/lib/fetchStockMovement";
import { buildDashboard } from "@/lib/buildDashboard";
import { buildStockDetail } from "@/lib/buildStockDetail";
import { buildStockMovement } from "@/lib/buildStockMovement";
import type { StockMovementData } from "@/lib/buildStockMovement";
import { ymFromDate } from "@/lib/fiscal";
import SalesDashboardClient from "@/components/SalesDashboardClient";

// 常に最新データを取得する(キャッシュしない)
export const dynamic = "force-dynamic";

// 売上ダッシュボード明細: 売上ダッシュボード(/sales)と全く同じ画面構成(経営レポート・
// 全体サマリー・月別マトリクス・目標追跡・在庫)を、明細データ(profit_summary、
// sales_lines由来)で組み立てる。売上ダッシュボード(sales_monthly)は売上金額の精度が
// 高い一方で在庫出荷分の原価が取れないのに対し、こちらは仕入・在庫出荷・運送会社の
// 実費まで含めた原価で計算できる(ただし一式売上の除外・マッチング漏れの影響を受ける)。
// 「在庫」タブの在庫仕入(拠点90・91)は得意先への売上ではなく社内倉庫向けの仕入で、
// 明細データには存在しないため、元の売上ダッシュボードと同じデータ(v_monthly)をそのまま使う。
export default async function SalesDetailPage({
  searchParams,
}: {
  searchParams?: { until?: string };
}) {
  try {
    const [profitSummaryRows, stockOnlyRows, stockRows] = await Promise.all([
      fetchAllProfitSummaryRows(),
      fetchStockOnlyMonthlyRows(),
      fetchStockDetailRows(),
    ]);

    const rows = [...profitSummaryToMonthlyRows(profitSummaryRows), ...stockOnlyRows];

    // 「何月度まで見るか」の絞り込み機能(売上ダッシュボードと同じ)。
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
    let stockMovement: StockMovementData | null = null;
    let stockMovementError: string | null = null;
    try {
      const [purchaseLots, shipments, productAliasMap] = await Promise.all([
        fetchPurchaseLots(),
        fetchStockShipments(),
        fetchProductAliasGroups(),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      stockMovement = buildStockMovement(purchaseLots, shipments, today, productAliasMap);
    } catch (e) {
      stockMovementError = e instanceof Error ? e.message : "不明なエラーが発生しました。";
    }

    return (
      <SalesDashboardClient
        data={data}
        stockDetailByYear={stockDetailByYear}
        stockMovement={stockMovement}
        stockMovementError={stockMovementError}
        availableMonths={availableMonths}
        selectedUntil={selectedUntil}
        variant="detail"
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
