export const maxDuration = 60;

import Link from "next/link";
import { fetchWarehousePurchases, fetchSalesMatchRows } from "@/lib/fetchUnsoldPurchases";
import { buildUnsoldPurchases } from "@/lib/unsoldPurchases";
import UnsoldPurchasesDashboard from "@/components/UnsoldPurchasesDashboard";

export const dynamic = "force-dynamic";

export default async function UnsoldPurchasesPage() {
  try {
    const [purchaseRows, salesRows] = await Promise.all([
      fetchWarehousePurchases(),
      fetchSalesMatchRows(),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const rows = buildUnsoldPurchases(purchaseRows, salesRows, today);

    return <UnsoldPurchasesDashboard rows={rows} asOf={today} />;
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
