// 経営レポート(/sales)・売上ダッシュボード明細(/sales-detail)共通:
// Supabaseからの取得〜経営レポート/月別マトリクス/在庫タブ一式の再集計までを
// まとめてキャッシュする(「表示基準月」を絞り込んでいない通常時のもの)。
// これをAPIルート(app/api/sales-dashboard, sales-dashboard-detail)経由で
// ブラウザ側から呼び出すことで、ページ本体(app/sales, app/sales-detail)は
// 一切サーバー側で待たずに即座に返せる(=画面遷移のたびにローディング表示が
// 出ない)ようにしている。
import { unstable_cache } from "next/cache";
import { fetchAllMonthlyRows, fetchStockOnlyMonthlyRows } from "./fetchMonthly";
import { fetchAllProfitSummaryRows } from "./fetchProfitSummaryAll";
import { profitSummaryToMonthlyRows } from "./profitSummaryToMonthlyRows";
import { fetchStockDetailRows } from "./fetchStockDetail";
import { fetchPurchaseLots, fetchStockShipments, fetchProductAliasGroups } from "./fetchStockMovement";
import { buildDashboard } from "./buildDashboard";
import { buildStockDetail } from "./buildStockDetail";
import { buildStockMovement } from "./buildStockMovement";
import type { StockMovementData } from "./buildStockMovement";
import type { StockDetailData } from "./buildStockDetail";
import type { DashboardData, MonthlyRow } from "./types";
import { fiscalYearEndDate, ymFromDate } from "./fiscal";
import { SALES_DATA_CACHE_TAG } from "./salesDataCache";

export type SalesDashboardCore = {
  fullDataset: DashboardData;
  availableMonths: string[];
  stockDetailByYear: Record<number, StockDetailData>;
  stockMovementByYear: Record<number, StockMovementData | null>;
  stockMovementError: string | null;
};

async function buildCoreFrom(rows: MonthlyRow[], stockRowsPromise: ReturnType<typeof fetchStockDetailRows>): Promise<SalesDashboardCore> {
  const stockRows = await stockRowsPromise;
  const fullDataset = buildDashboard(rows);
  const availableMonths = fullDataset.trend_cur.filter((t) => t.sales > 0).map((t) => t.ym);

  // 「在庫」タブの期選択用。経営レポートと同じく、各会計年度を今期扱いにした
  // 場合の一式を作っておく(CURはfiscalYearsに無くても必ず入れる)。
  const stockYears = Array.from(new Set([fullDataset.summary.CUR, ...fullDataset.fiscalYears]));
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
        if (y === fullDataset.summary.CUR) {
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

  return { fullDataset, availableMonths, stockDetailByYear, stockMovementByYear, stockMovementError };
}

// ---- 経営レポート(/sales、sales_monthly由来) ----

async function computeSalesDashboardCore(): Promise<SalesDashboardCore> {
  const rows = await fetchAllMonthlyRows();
  return buildCoreFrom(rows, fetchStockDetailRows());
}
export const getSalesDashboardCore = unstable_cache(computeSalesDashboardCore, ["sales-dashboard-core"], {
  tags: [SALES_DATA_CACHE_TAG],
  revalidate: false,
});

// 「表示基準月」で絞り込んだ時に使う。fetchAllMonthlyRows自体は既にキャッシュ済みなので、
// ここでSupabaseへ再度問い合わせることはない(buildDashboardの再計算のみ)。
export async function buildSalesDashboardFor(until: string): Promise<DashboardData> {
  const rows = await fetchAllMonthlyRows();
  return buildDashboard(rows.filter((r) => ymFromDate(r.month) <= until));
}

// ---- 売上ダッシュボード明細(/sales-detail、profit_summary/sales_lines由来) ----

async function buildDetailRows(): Promise<MonthlyRow[]> {
  const [profitSummaryRows, stockOnlyRows] = await Promise.all([
    fetchAllProfitSummaryRows(),
    fetchStockOnlyMonthlyRows(),
  ]);
  return [...profitSummaryToMonthlyRows(profitSummaryRows), ...stockOnlyRows];
}

async function computeSalesDetailDashboardCore(): Promise<SalesDashboardCore> {
  const rows = await buildDetailRows();
  return buildCoreFrom(rows, fetchStockDetailRows());
}
export const getSalesDetailDashboardCore = unstable_cache(
  computeSalesDetailDashboardCore,
  ["sales-detail-dashboard-core"],
  { tags: [SALES_DATA_CACHE_TAG], revalidate: false }
);

export async function buildSalesDetailDashboardFor(until: string): Promise<DashboardData> {
  const rows = await buildDetailRows();
  return buildDashboard(rows.filter((r) => ymFromDate(r.month) <= until));
}
