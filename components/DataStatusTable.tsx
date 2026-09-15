import type { TableStatus } from "@/lib/fetchDataStatus";

function fmtDate(d: string | null): string {
  if (!d) return "―";
  const s = d.slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

function fmtDateTime(d: string | null): string {
  if (!d) return "―";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function daysAgo(d: string | null): string {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const diffMs = Date.now() - dt.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "(今日)";
  if (diffDays === 1) return "(1日前)";
  return `(${diffDays}日前)`;
}

// 「データ更新状況」: rieki-check-appのdata-statusページを移植したもの。
export default function DataStatusTable({ statuses, error }: { statuses: TableStatus[]; error: string | null }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <h2>データ更新状況</h2>
      </div>
      <div style={{ padding: "0 20px 20px" }}>
        <p style={{ fontSize: 13, color: "var(--ink-faint)", marginBottom: 12 }}>
          売上明細・仕入明細・社内間・送り状問合せデータが、今どこまで入っているかを確認できます。取り込みは自動的にupsert(重複防止)されるため、同じ内容を再アップロードしても件数が増えることはありません。
        </p>
        {error ? (
          <p style={{ color: "var(--neg)" }}>データの取得に失敗しました: {error}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-faint)" }}>
                  <th>データ種別</th>
                  <th>件数</th>
                  <th>データの日付範囲</th>
                  <th>最終取り込み日時</th>
                  <th>直近の取り込み(目安)</th>
                </tr>
              </thead>
              <tbody>
                {statuses.map((s) => (
                  <tr key={s.key} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ fontWeight: 600, padding: "6px 8px 6px 0" }}>{s.label}</td>
                    <td style={{ padding: "6px 8px" }}>{s.rowCount.toLocaleString("ja-JP")}件</td>
                    <td style={{ padding: "6px 8px" }}>
                      {s.minDate || s.maxDate ? (
                        <>
                          {s.dateColumnLabel}: {fmtDate(s.minDate)} 〜 {fmtDate(s.maxDate)}
                        </>
                      ) : (
                        "―"
                      )}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {fmtDateTime(s.lastImportedAt)}
                      {s.lastImportedAt && <span style={{ color: "var(--ink-faint)", marginLeft: 6 }}>{daysAgo(s.lastImportedAt)}</span>}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {s.lastBatchCount ? (
                        <>
                          {s.lastBatchCount.toLocaleString("ja-JP")}件
                          {(s.lastBatchMinDate || s.lastBatchMaxDate) && (
                            <div style={{ color: "var(--ink-faint)", fontSize: 11 }}>
                              {s.dateColumnLabel}: {fmtDate(s.lastBatchMinDate)} 〜 {fmtDate(s.lastBatchMaxDate)}
                            </div>
                          )}
                        </>
                      ) : (
                        "―"
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
