import type { DashboardData } from "@/lib/types";
import type { StockDetailData } from "@/lib/buildStockDetail";
import type { StockMovementData } from "@/lib/buildStockMovement";

/**
 * 経営レポート(/sales)・売上ダッシュボード明細(/sales-detail)のブラウザ内キャッシュ。
 * 考え方はlib/profit-cache.tsと同じ(モジュール変数、next/linkでの画面遷移である限り
 * 保持される。ブラウザを完全に再読み込みした場合は失われ、通常通り読み直す)。
 *
 * 「表示基準月」で絞り込んだ結果(selectedUntilがnullでないもの)はここに保存しない
 * (絞り込みは都度その場で計算し直す前提のため)。
 */
export type SalesDashboardPayload = {
  data: DashboardData;
  stockDetailByYear: Record<number, StockDetailData>;
  stockMovementByYear: Record<number, StockMovementData | null>;
  stockMovementError: string | null;
  availableMonths: string[];
  selectedUntil: string | null;
};

type Entry = { payload: SalesDashboardPayload; loadedAt: number };

const cache: Partial<Record<"monthly" | "detail", Entry>> = {};

export function getSalesDashboardCache(variant: "monthly" | "detail"): Entry | null {
  return cache[variant] ?? null;
}

export function setSalesDashboardCache(variant: "monthly" | "detail", payload: SalesDashboardPayload): void {
  cache[variant] = { payload, loadedAt: Date.now() };
}

export function clearSalesDashboardCache(variant?: "monthly" | "detail"): void {
  if (variant) {
    delete cache[variant];
  } else {
    delete cache.monthly;
    delete cache.detail;
  }
}
