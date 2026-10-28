import Link from "next/link";
import CustomerHistorySearch from "@/components/CustomerHistorySearch";

export const dynamic = "force-dynamic";

export default function CustomerHistoryPage() {
  return (
    <div className="wrap" style={{ maxWidth: 1400 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>顧客実績</h1>
          <p>電話対応中でもすぐに呼び出せるよう、得意先ごとの直近の取引実績だけを素早く検索します。</p>
        </div>
        <Link href="/sales-app" className="ghost-btn-inline">
          ← 営業アプリ
        </Link>
      </header>

      <CustomerHistorySearch />
    </div>
  );
}
