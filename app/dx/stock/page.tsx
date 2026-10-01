import Link from "next/link";
import { getSalesDashboardCore } from "@/lib/salesDashboardCore";
import StockCheckClient from "@/components/StockCheckClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 経営レポート(/sales)と全く同じキャッシュ済みデータ(getSalesDashboardCore)を使う。
// これにより、不動在庫チェック単独ページでも、データとして存在する会計年度を
// 全て選べるようになる(以前は「今日」基準の今期・前期だけに固定されていた)。
export default async function StockCheckPage() {
  try {
    const core = await getSalesDashboardCore();
    return (
      <StockCheckClient
        trueCUR={core.fullDataset.summary.CUR}
        fiscalYears={core.fullDataset.fiscalYears}
        stockDetailByYear={core.stockDetailByYear}
        stockMovementByYear={core.stockMovementByYear}
        stockMovementError={core.stockMovementError}
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
        <p style={{ marginTop: 20 }}>
          <Link href="/dx" className="ghost-btn-inline">
            ← 社内DXメニュー
          </Link>
        </p>
      </div>
    );
  }
}
