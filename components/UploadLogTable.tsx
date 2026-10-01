import type { UploadLogRow } from "@/lib/fetchUploadLog";

const UPLOAD_TYPE_LABELS: Record<string, string> = {
  sales_monthly: "売上データ(月次集計)",
  purchases: "仕入データ",
  product_master: "商品マスタ",
  supplier_master: "仕入先マスタ",
  customer_master: "得意先マスタ",
  sales_lines: "売上明細データ",
  shipping_note_mapping: "送り状問合せデータ",
  stock_transfer_pending: "社内間(未納品の拠点間移動)",
  freight_actual_summary: "運賃実績集計",
};

const ACTION_LABELS: Record<string, string> = {
  commit: "取り込み",
  cleanup: "削除処理",
};

function fmtDateTime(d: string): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

// アップロード履歴: 2026-10-01の誤形式ファイル取り込み事故をきっかけに追加。
// このアプリはログイン画面が全社共通の1パスワードで、「誰が」操作したかは記録できないため、
// 「いつ・どの処理が・何件」実行されたかだけを表示する。
export default function UploadLogTable({ logs, error }: { logs: UploadLogRow[]; error: string | null }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <h2>アップロード履歴</h2>
      </div>
      <div style={{ padding: "0 20px 20px" }}>
        <p style={{ fontSize: 13, color: "var(--ink-faint)", marginBottom: 12 }}>
          直近{logs.length > 0 ? "" : "50件分"}のアップロード・削除処理の記録です。このアプリは全社共通の1つのパスワードでログインする仕組みのため「誰が」操作したかは記録されません。「いつ・何のデータが・何件」処理されたかの確認用です。
        </p>
        {error ? (
          <p style={{ color: "var(--neg)" }}>履歴の取得に失敗しました: {error}</p>
        ) : logs.length === 0 ? (
          <p style={{ color: "var(--ink-faint)" }}>まだ記録がありません。</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-faint)" }}>
                  <th>日時</th>
                  <th>データ種別</th>
                  <th>処理</th>
                  <th>件数</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "6px 8px 6px 0", whiteSpace: "nowrap" }}>{fmtDateTime(log.createdAt)}</td>
                    <td style={{ padding: "6px 8px" }}>{UPLOAD_TYPE_LABELS[log.uploadType] ?? log.uploadType}</td>
                    <td style={{ padding: "6px 8px" }}>{ACTION_LABELS[log.action] ?? log.action}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {log.action === "cleanup"
                        ? log.deletedCount !== null
                          ? `削除 ${log.deletedCount.toLocaleString("ja-JP")}件`
                          : "―"
                        : log.rowCount !== null
                          ? `${log.rowCount.toLocaleString("ja-JP")}件`
                          : "―"}
                      {!!log.skippedCount && (
                        <span style={{ color: "var(--ink-faint)" }}>
                          {" "}
                          (スキップ{log.skippedCount.toLocaleString("ja-JP")}件)
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {log.success ? (
                        <span style={{ color: "var(--pos)" }}>✓ 成功</span>
                      ) : (
                        <span style={{ color: "var(--neg)" }} title={log.errorMessage ?? undefined}>
                          ❌ 失敗{log.errorMessage ? `: ${log.errorMessage}` : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
