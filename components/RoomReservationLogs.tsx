"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { historyRangeFromToday } from "@/lib/roomReservationDate";
import type { RoomReservationLog, RoomReservationLogAction } from "@/lib/roomReservation";

const ACTION_LABEL: Record<RoomReservationLogAction, string> = {
  created: "新規登録",
  updated: "変更",
  deleted: "削除",
};

function formatDetail(log: RoomReservationLog): string {
  const d = log.detail as
    | { after?: Record<string, unknown>; before?: Record<string, unknown>; deleted?: Record<string, unknown> }
    | null;
  if (!d) return "―";
  if (log.action === "created" && d.after) {
    return `${d.after.start_time ?? ""}〜${d.after.end_time ?? ""}${d.after.visitor_name ? ` / 来訪:${d.after.visitor_name}` : ""}`;
  }
  if (log.action === "deleted" && d.deleted) {
    return `${d.deleted.start_time ?? ""}〜${d.deleted.end_time ?? ""} を削除`;
  }
  if (log.action === "updated" && d.before && d.after) {
    const changes: string[] = [];
    if (d.before.reservation_date !== d.after.reservation_date) {
      changes.push(`日付: ${d.before.reservation_date}→${d.after.reservation_date}`);
    }
    if (d.before.start_time !== d.after.start_time || d.before.end_time !== d.after.end_time) {
      changes.push(`時間: ${d.before.start_time}〜${d.before.end_time}→${d.after.start_time}〜${d.after.end_time}`);
    }
    if (d.before.visitor_name !== d.after.visitor_name) {
      changes.push(`来訪者: ${d.before.visitor_name ?? "―"}→${d.after.visitor_name ?? "―"}`);
    }
    return changes.length > 0 ? changes.join(" / ") : "変更なし";
  }
  return "―";
}

export default function RoomReservationLogs() {
  const range = useMemo(() => historyRangeFromToday(new Date()), []);
  const [logs, setLogs] = useState<RoomReservationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/room-reservation-logs?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "取得に失敗しました");
      setLogs(json.rows as RoomReservationLog[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range, q]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rk">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <h1>会議室予約 履歴</h1>
        <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
          <Link href="/dx/room-reservation" className="ghost-btn" style={{ textDecoration: "none" }}>
            ← カレンダーへ戻る
          </Link>
          <Link href="/dx" className="ghost-btn" style={{ textDecoration: "none" }}>
            ← 社内DXメニュー
          </Link>
        </div>
      </div>
      <p className="subtitle">
        対象予約日 {range.from} 〜 {range.to} (過去2ヶ月・当月・先2ヶ月を自動表示)
      </p>

      <div className="card">
        <div style={{ marginBottom: 12 }}>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="申請者名で絞り込み"
            style={{ width: 260, maxWidth: "100%", padding: "7px 9px", border: "1px solid var(--rk-border)", borderRadius: 6, fontSize: 13 }}
          />
        </div>

        {loading && (
          <p className="cell-sub">
            <span className="spinner" />
            読み込み中…
          </p>
        )}
        {error && <p style={{ color: "var(--rk-critical)" }}>{error}</p>}

        {!loading && !error && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>対象予約日</th>
                  <th>操作種別</th>
                  <th>申請者名</th>
                  <th>操作日時</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="cell-sub" style={{ textAlign: "center", padding: "18px 0" }}>
                      該当する履歴がありません。
                    </td>
                  </tr>
                )}
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.reservation_date}</td>
                    <td>{ACTION_LABEL[log.action]}</td>
                    <td>{log.applicant_name}</td>
                    <td className="cell-sub">{new Date(log.action_at).toLocaleString("ja-JP")}</td>
                    <td className="cell-sub">{formatDetail(log)}</td>
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
