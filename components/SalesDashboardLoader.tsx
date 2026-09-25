"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import SalesDashboardClient from "./SalesDashboardClient";
import PageLoading from "./PageLoading";
import {
  getSalesDashboardCache,
  setSalesDashboardCache,
  clearSalesDashboardCache,
  type SalesDashboardPayload,
} from "@/lib/sales-dashboard-cache";

// 経営レポート(/sales)・売上ダッシュボード明細(/sales-detail)の読み込みを行う。
// 売上利益・拠点別利益ページ(ProfitDashboardLoader.tsx/ProfitSummary.tsx)と同じ考え方:
// ブラウザ内のモジュール変数にキャッシュしておき、メニューに戻ってから再度この画面を
// 開いた時は再取得せず即座に表示する(next/linkでの画面遷移である限り)。
// サーバー側のunstable_cacheと違い、ここでの読み込みは「ページを開く」動作そのものを
// 待たせない(page.tsxは何も待たずに即座にこのコンポーネントを描画するため、
// Next.jsのloading.tsxが挟まらない)。
export default function SalesDashboardLoader({ variant }: { variant: "monthly" | "detail" }) {
  const apiPath = variant === "detail" ? "/api/sales-dashboard-detail" : "/api/sales-dashboard";

  const [payload, setPayload] = useState<SalesDashboardPayload | null>(null);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false); // 表示基準月の切替・更新ボタン中
  const startedRef = useRef(false);

  async function load(until: string | null, isSwitch: boolean): Promise<void> {
    if (isSwitch) setSwitching(true);
    try {
      const url = until ? `${apiPath}?until=${until}` : apiPath;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? res.statusText ?? "不明なエラー");
      const next = json as SalesDashboardPayload;
      if (!until) setSalesDashboardCache(variant, next);
      setPayload(next);
      setInitialError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (payload) {
        // 既に何か表示できている状態でのエラーは、古い表示を残したままアラート的に伝える。
        window.alert(`データの取得に失敗しました: ${message}`);
      } else {
        setInitialError(message);
      }
    } finally {
      if (isSwitch) setSwitching(false);
    }
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const cached = getSalesDashboardCache(variant);
    if (cached) {
      setPayload(cached.payload);
      return;
    }
    load(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUntilChange(until: string | null) {
    await load(until, true);
  }

  async function handleRefresh() {
    const res = await fetch("/api/revalidate-sales-data", { method: "POST" });
    if (!res.ok) throw new Error("更新に失敗しました");
    clearSalesDashboardCache(variant);
    await load(payload?.selectedUntil ?? null, true);
  }

  if (!payload) {
    if (initialError) {
      return (
        <div style={{ maxWidth: 640, margin: "80px auto", padding: 24, fontFamily: "sans-serif" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>データの読み込みでエラーが発生しました</h1>
          <p style={{ fontSize: 14, color: "#555", lineHeight: 1.6 }}>{initialError}</p>
          <p style={{ marginTop: 20, display: "flex", gap: 10 }}>
            <button className="ghost-btn-inline" onClick={() => load(null, false)}>
              もう一度読み込む
            </button>
            <Link href="/menu" className="ghost-btn-inline">
              ← メインメニュー
            </Link>
          </p>
        </div>
      );
    }
    return <PageLoading label={variant === "detail" ? "明細データを読み込んでいます…" : "データを読み込んでいます…"} />;
  }

  return (
    <SalesDashboardClient
      data={payload.data}
      stockDetailByYear={payload.stockDetailByYear}
      stockMovementByYear={payload.stockMovementByYear}
      stockMovementError={payload.stockMovementError}
      availableMonths={payload.availableMonths}
      selectedUntil={payload.selectedUntil}
      variant={variant}
      onUntilChange={handleUntilChange}
      onRefresh={handleRefresh}
      switching={switching}
    />
  );
}
