import { getSupabaseServerClient } from "./supabaseServer";

// 「データ更新状況」用のデータ取得。rieki-check-appのdata-statusページを移植したもの。
//
// 注意: このアプリは「いつ・何件アップロードされたか」を記録する専用のログテーブルを
// 持っていない(アップロードのたびに各データテーブルへ直接upsert/置き換えするだけの設計)。
// そのため「直近の取り込み内容」は、各行のcreated_at(その行が最初にデータベースに
// 入った日時)をもとに、最新のcreated_atから遡って一定時間(30分)以内の行を
// 「直近1回分の取り込み」とみなして推定したものであり、正式な取り込み履歴ログではない。
const BATCH_WINDOW_MINUTES = 30;

export type TableStatus = {
  key: string;
  label: string;
  dateColumnLabel: string;
  rowCount: number;
  minDate: string | null;
  maxDate: string | null;
  lastImportedAt: string | null;
  lastBatchCount: number | null;
  lastBatchMinDate: string | null;
  lastBatchMaxDate: string | null;
};

type TableConfig = {
  key: string;
  label: string;
  table: string;
  dateColumn: string;
  dateColumnLabel: string;
};

const TABLES: TableConfig[] = [
  { key: "salesLines", label: "売上明細データ(sales_lines)", table: "sales_lines", dateColumn: "delivery_date", dateColumnLabel: "納品日" },
  { key: "transfer", label: "社内間(未納品の拠点間移動)", table: "stock_transfer_pending", dateColumn: "order_date", dateColumnLabel: "受注日" },
  { key: "shippingNote", label: "送り状問合せデータ(運賃照合用)", table: "shipping_note_mapping", dateColumn: "issue_date", dateColumnLabel: "発行日" },
];

async function fetchOne(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  table: string,
  column: string,
  ascending: boolean
): Promise<string | null> {
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .not(column, "is", null)
    .order(column, { ascending })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0] as unknown as Record<string, unknown>;
  const v = row[column];
  return v === null || v === undefined ? null : String(v);
}

async function fetchStatus(supabase: ReturnType<typeof getSupabaseServerClient>, cfg: TableConfig): Promise<TableStatus> {
  const [{ count }, minDate, maxDate, lastImportedAt] = await Promise.all([
    supabase.from(cfg.table).select("*", { count: "exact", head: true }),
    fetchOne(supabase, cfg.table, cfg.dateColumn, true),
    fetchOne(supabase, cfg.table, cfg.dateColumn, false),
    fetchOne(supabase, cfg.table, "created_at", false),
  ]);

  let lastBatchCount: number | null = null;
  let lastBatchMinDate: string | null = null;
  let lastBatchMaxDate: string | null = null;

  if (lastImportedAt) {
    const threshold = new Date(new Date(lastImportedAt).getTime() - BATCH_WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count: batchCount } = await supabase
      .from(cfg.table)
      .select("*", { count: "exact", head: true })
      .gte("created_at", threshold);
    lastBatchCount = batchCount ?? null;

    const { data: batchRows } = await supabase
      .from(cfg.table)
      .select(cfg.dateColumn)
      .gte("created_at", threshold)
      .not(cfg.dateColumn, "is", null);
    if (batchRows && batchRows.length > 0) {
      const values = (batchRows as unknown as Record<string, unknown>[])
        .map((r) => r[cfg.dateColumn])
        .filter((v): v is string | number => v !== null && v !== undefined)
        .map(String)
        .sort();
      lastBatchMinDate = values[0] ?? null;
      lastBatchMaxDate = values[values.length - 1] ?? null;
    }
  }

  return {
    key: cfg.key,
    label: cfg.label,
    dateColumnLabel: cfg.dateColumnLabel,
    rowCount: count ?? 0,
    minDate,
    maxDate,
    lastImportedAt,
    lastBatchCount,
    lastBatchMinDate,
    lastBatchMaxDate,
  };
}

export async function fetchAllDataStatuses(): Promise<TableStatus[]> {
  const supabase = getSupabaseServerClient();
  return Promise.all(TABLES.map((cfg) => fetchStatus(supabase, cfg)));
}
