import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fetchAllPagesConcurrent } from "@/lib/fetchPaged";
import type { InternalTransferLine, TransferPendingLine } from "@/lib/types";
import InternalTransferDashboard from "@/components/InternalTransferDashboard";

// Vercelのキャッシュに古い結果が残らないよう、毎回サーバーで実行する
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Supabase/PostgREST は .range() を付けないと最大1000件までしか返さない。
// v_internal_transfer_lines は件数が多くなり得るのでページングして全件取得する。
// .order()で安定した並び順を指定しないと、ページをまたいで行が重複・欠落することが
// あるため、一意な列で明示的に昇順ソートしてからページングする。
// 以前は1ページずつ逐次取得しており、v_internal_transfer_lines が13万件超に増えた
// 結果、往復回数が積み重なってVercelの関数タイムアウト(60秒)を起こし、画面が
// 「Application error: a client-side exception has occurred」になっていた。
// fetchMonthly.ts等と同じ並行ページング(fetchAllPagesConcurrent)に統一して解消する。
const PAGE_SIZE = 1000;

async function fetchAll<T>(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  table: string,
  orderColumn: string
): Promise<{ rows: T[]; error: { message: string } | null }> {
  try {
    const rows = await fetchAllPagesConcurrent<T>(
      (from, to) =>
        supabase
          .from(table)
          .select("*")
          .order(orderColumn, { ascending: true })
          .range(from, to),
      { pageSize: PAGE_SIZE, concurrency: 10 }
    );
    return { rows, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { rows: [], error: { message } };
  }
}

export default async function InternalTransferPage() {
  const supabase = getSupabaseServerClient();

  const [confirmed, pending] = await Promise.all([
    fetchAll<InternalTransferLine>(supabase, "v_internal_transfer_lines", "sales_line_id"),
    fetchAll<TransferPendingLine>(supabase, "stock_transfer_pending", "id"),
  ]);

  const error = confirmed.error ?? pending.error;
  if (error) {
    return (
      <div className="rk">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h1>社内間金額</h1>
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

  return <InternalTransferDashboard confirmedRows={confirmed.rows} pendingRows={pending.rows} />;
}
