// データ取り込み(アップロード)の記録。
//
// 2026-10-01、売上データのアップロードで誤った形式のファイルが取り込まれ、
// 本来の得意先別データが一時的に削除される事態が発生した。原因の特定に
// Supabase側のログを直接調べる必要があり、時間がかかった。このアプリには
// ログイン画面が全社共通の1パスワードしか無く、「誰が」操作したかを記録する
// 仕組みが無いため、せめて「いつ・どの処理が・何件」実行されたかだけでも
// すぐに見られるようにしておく。
//
// ログ記録自体の失敗で本来の処理(アップロード)を失敗させたくないため、
// 常にtry/catchで握りつぶすベストエフォート方式にしている。
import { getSupabaseServerClient } from "./supabaseServer";

export async function logUpload(entry: {
  uploadType: string;
  action?: "commit" | "cleanup";
  rowCount?: number | null;
  skippedCount?: number | null;
  deletedCount?: number | null;
  success: boolean;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    await supabase.from("upload_log").insert({
      upload_type: entry.uploadType,
      action: entry.action ?? "commit",
      row_count: entry.rowCount ?? null,
      skipped_count: entry.skippedCount ?? null,
      deleted_count: entry.deletedCount ?? null,
      success: entry.success,
      error_message: entry.errorMessage ?? null,
    });
  } catch {
    // ベストエフォート。ログ記録に失敗しても本処理の結果には影響させない。
  }
}
