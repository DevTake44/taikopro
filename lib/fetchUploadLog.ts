import { getSupabaseServerClient } from "./supabaseServer";

export type UploadLogRow = {
  id: number;
  uploadType: string;
  action: string;
  rowCount: number | null;
  skippedCount: number | null;
  deletedCount: number | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
};

const RECENT_LIMIT = 50;

export async function fetchRecentUploadLogs(): Promise<UploadLogRow[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("upload_log")
    .select("id, upload_type, action, row_count, skipped_count, deleted_count, success, error_message, created_at")
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT);

  if (error || !data) return [];

  return data.map((r) => ({
    id: r.id,
    uploadType: r.upload_type,
    action: r.action,
    rowCount: r.row_count,
    skippedCount: r.skipped_count,
    deletedCount: r.deleted_count,
    success: r.success,
    errorMessage: r.error_message,
    createdAt: r.created_at,
  }));
}
