export const maxDuration = 60;

import Link from "next/link";
import { fetchStockDetailRows } from "@/lib/fetchStockDetail";
import { fetchPurchaseLots, fetchStockShipments, fetchProductAliasGroups } from "@/lib/fetchStockMovement";
import { buildDashboard } from "@/lib/buildDashboard";
import { buildStockDetail } from "@/lib/buildStockDetail";
import { buildStockMovement } from "@/lib/buildStockMovement";
import type { StockMovementData } from "@/lib/buildStockMovement";
import { fetchAllMonthlyRows } from "@/lib/fetchMonthly";
import StockCheckClient from "@/components/StockCheckClient";

export const dynamic = "force-dynamic";

export default async function StockCheckPage() {
  try {
    const [rows, stockRows] = await Promise.all([fetchAllMonthlyRows(), fetchStockDetailRows()]);
    const data = buildDashboard(rows);
    const stockDetail = buildStockDetail(stockRows, data.summary.CUR, data.summary.PREV);

    let stockMovement: StockMovementData | null = null;
    let stockMovementError: string | null = null;
    try {
      const [purchaseLots, shipments, productAliasRecord] = await Promise.all([
        fetchPurchaseLots(),
        fetchStockShipments(),
        fetchProductAliasGroups(),
      ]);
      const productAliasMap = new Map(Object.entries(productAliasRecord));
      const today = new Date().toISOString().slice(0, 10);
      stockMovement = buildStockMovement(purchaseLots, shipments, today, productAliasMap);
    } catch (e) {
      stockMovementError = e instanceof Error ? e.message : "不明なエラーが発生しました。";
    }

    return (
      <StockCheckClient stockDetail={stockDetail} stockMovement={stockMovement} stockMovementError={stockMovementError} />
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラーが発生しました。";
    return (
      <div style={{ maxWidth: 640, margin: "80px auto", padding: 24, fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
          データの読み込みでエラーが発生しました
        </h1>
        <p style={{ fontSize: 14, color: "#555", lineHeight: 1.6 }}>{message}</p>
        <p style={{ marginTop: 20 }}>
          <Link href="/dx" className="ghost-btn-inline">
            ← 社内DXメニュー
          </Link>
        </p>
      </div>
    );
  }
}
