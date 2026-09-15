import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { PriceIncreaseAlert } from "@/lib/profitTypes";
import PriceAlertsDashboard from "@/components/PriceAlertsDashboard";

// Vercelのキャッシュに古い結果が残らないよう、毎回サーバーで実行する
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Supabase/PostgREST は .select("*") に .range() を付けない場合、デフォルトで
// 最大1000件までしか返さない。v_price_increase_alertsは万単位あるため、.range()で
// 1000件ずつ全件取得するまでページングする。.order()で安定した並び順を指定しないと、
// ページをまたいで行が重複・欠落することがあるため、sales_line_idで明示的に昇順ソートする。
const PAGE_SIZE = 1000;

async function fetchAllAlerts(
  supabase: ReturnType<typeof getSupabaseServerClient>
): Promise<{ rows: PriceIncreaseAlert[]; error: { message: string } | null }> {
  const rows: PriceIncreaseAlert[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("v_price_increase_alerts")
      .select("*")
      .order("sales_line_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return { rows, error };
    if (!data || data.length === 0) break;

    rows.push(...(data as PriceIncreaseAlert[]));

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { rows, error: null };
}

export default async function PriceAlertsPage() {
  const supabase = getSupabaseServerClient();
  const { rows, error } = await fetchAllAlerts(supabase);

  if (error) {
    return (
      <div className="rk">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h1>値上げ検知ダッシュボード</h1>
          <Link href="/dx" className="ghost-btn" style={{ textDecoration: "none" }}>
            ← 社内DXメニュー
          </Link>
        </div>
        <div className="card">
          <p>データの取得に失敗しました。環境変数(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)が正しく設定されているか確認してください。</p>
          <pre style={{ whiteSpace: "pre-wrap", color: "#c0392b" }}>{error.message}</pre>
        </div>
      </div>
    );
  }

  return <PriceAlertsDashboard rows={rows} />;
}
