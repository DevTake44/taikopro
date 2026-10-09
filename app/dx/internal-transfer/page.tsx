import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fetchAllPagesConcurrent } from "@/lib/fetchPaged";
import type { InternalTransferSummaryRow, TransferPendingLine } from "@/lib/types";
import InternalTransferDashboard from "@/components/InternalTransferDashboard";

// Vercelのキャッシュに古い結果が残らないよう、毎回サーバーで実行する
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Supabase/PostgREST は .range() を付けないと最大1000件までしか返さない。
// .order()で安定した並び順を指定しないと、ページをまたいで行が重複・欠落することが
// あるため、一意な列(の組み合わせ)で明示的に昇順ソートしてからページングする。
//
// 【重要】以前は確定分をv_internal_transfer_lines(明細、13万件超・約38MB)から
// 1ページずつ逐次取得しており、(1)往復回数の積み重ねによるVercelの関数タイムアウト
// (60秒)、(2)仮に取得できても約38MBのデータをそのままクライアントに渡すことによる
// 応答サイズ超過、の2つが原因で画面が「Application error: a client-side exception
// has occurred」になっていた。
// 画面側は結局「拠点×期間×場所」の合計金額しか使わないため、その粒度まで事前集計した
// v_internal_transfer_summary(約1,100件・155kB)から取得するよう変更して解消する
// (2026-10-09)。
const PAGE_SIZE = 1000;

async function fetchAll<T>(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  table: string,
  orderColumns: string[]
): Promise<{ rows: T[]; error: { message: string } | null }> {
  try {
    const rows = await fetchAllPagesConcurrent<T>(
      (from, to) => {
        let q = supabase.from(table).select("*");
        for (const col of orderColumns) q = q.order(col, { ascending: true });
        return q.range(from, to);
      },
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
    fetchAll<InternalTransferSummaryRow>(supabase, "v_internal_transfer_summary", [
      "period_key",
      "branch_code",
      "arrange_type",
      "loc_code",
    ]),
    fetchAll<TransferPendingLine>(supabase, "stock_transfer_pending", ["id"]),
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
