import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { InternalTransferLine, TransferPendingLine } from "@/lib/types";
import InternalTransferDashboard from "@/components/InternalTransferDashboard";

// Vercelのキャッシュに古い結果が残らないよう、毎回サーバーで実行する
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Supabase/PostgREST は .range() を付けないと最大1000件までしか返さない。
// v_internal_transfer_lines は件数が多くなり得るのでページングして全件取得する。
// .order()で安定した並び順を指定しないと、ページをまたいで行が重複・欠落することが
// あるため、一意な列で明示的に昇順ソートしてからページングする。
const PAGE_SIZE = 1000;

async function fetchAll<T>(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  table: string,
  orderColumn: string
): Promise<{ rows: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error };
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { rows, error: null };
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
        <h1>社内間金額</h1>
        <div className="card">
          <p>データの取得に失敗しました。環境変数(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)が正しく設定されているか確認してください。</p>
          <pre style={{ whiteSpace: "pre-wrap", color: "#c0392b" }}>{error.message}</pre>
        </div>
      </div>
    );
  }

  return <InternalTransferDashboard confirmedRows={confirmed.rows} pendingRows={pending.rows} />;
}
