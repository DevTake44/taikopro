"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  mondayOf,
  addDays,
  weekdaysOf,
  toDateKey,
  formatDateWithWeekday,
  slotTimes,
  timeToSlotIndex,
  SLOT_COUNT,
} from "@/lib/roomReservationDate";
import { isValidTimeRange, type RoomReservation } from "@/lib/roomReservation";

type ModalState =
  | { kind: "closed" }
  | { kind: "enterNameCreate"; date: string; startTime: string }
  | { kind: "createForm"; date: string; startTime: string; endTime: string; applicantName: string; visitorName: string }
  | { kind: "detail"; reservation: RoomReservation }
  | { kind: "enterNameEdit"; reservation: RoomReservation; nameInput: string; nameError: string | null }
  | { kind: "editForm"; reservation: RoomReservation; applicantName: string; date: string; startTime: string; endTime: string; visitorName: string }
  | { kind: "enterNameDelete"; reservation: RoomReservation; nameInput: string; nameError: string | null }
  | { kind: "deleteConfirm"; reservation: RoomReservation; applicantName: string };

const SLOT_TIMES = slotTimes();
const ROW_HEIGHT = 30;

function endTimeOptions(startTime: string): string[] {
  const all = [...SLOT_TIMES, "18:00"];
  const startIdx = all.indexOf(startTime);
  return all.slice(startIdx + 1);
}

type DaySlot = null | "covered" | { reservation: RoomReservation; span: number };

function buildDayGrid(dateKey: string, reservations: RoomReservation[]): DaySlot[] {
  const slots: DaySlot[] = new Array(SLOT_COUNT).fill(null);
  const dayRes = reservations
    .filter((r) => r.reservation_date === dateKey)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  for (const r of dayRes) {
    const startIdx = timeToSlotIndex(r.start_time.slice(0, 5));
    const endIdx = timeToSlotIndex(r.end_time.slice(0, 5));
    const span = Math.max(1, endIdx - startIdx);
    if (startIdx < 0 || startIdx >= SLOT_COUNT) continue;
    slots[startIdx] = { reservation: r, span };
    for (let i = startIdx + 1; i < Math.min(startIdx + span, SLOT_COUNT); i++) slots[i] = "covered";
  }
  return slots;
}

export default function RoomReservationCalendar() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [reservations, setReservations] = useState<RoomReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const days = useMemo(() => weekdaysOf(weekStart), [weekStart]);
  const fromKey = toDateKey(days[0]);
  const toKey = toDateKey(days[4]);

  const loadReservations = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/room-reservations?from=${fromKey}&to=${toKey}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "取得に失敗しました");
      setReservations(json.rows as RoomReservation[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [fromKey, toKey]);

  useEffect(() => {
    loadReservations();
  }, [loadReservations]);

  function openCreateFromCell(dateKey: string, startTime: string) {
    setActionError(null);
    setModal({ kind: "enterNameCreate", date: dateKey, startTime });
  }

  function closeModal() {
    setActionError(null);
    setModal({ kind: "closed" });
  }

  async function submitCreate(state: Extract<ModalState, { kind: "createForm" }>) {
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch("/api/room-reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservation_date: state.date,
          start_time: state.startTime,
          end_time: state.endTime,
          applicant_name: state.applicantName,
          visitor_name: state.visitorName || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "登録に失敗しました");
      closeModal();
      await loadReservations();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitEdit(state: Extract<ModalState, { kind: "editForm" }>) {
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/room-reservations/${state.reservation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicant_name: state.applicantName,
          reservation_date: state.date,
          start_time: state.startTime,
          end_time: state.endTime,
          visitor_name: state.visitorName || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "変更に失敗しました");
      closeModal();
      await loadReservations();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDelete(state: Extract<ModalState, { kind: "deleteConfirm" }>) {
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/room-reservations/${state.reservation.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicant_name: state.applicantName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "削除に失敗しました");
      closeModal();
      await loadReservations();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rk">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <h1>会議室予約(東京)</h1>
        <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
          <Link href="/dx/room-reservation/history" className="ghost-btn" style={{ textDecoration: "none" }}>
            履歴
          </Link>
          <Link href="/dx" className="ghost-btn" style={{ textDecoration: "none" }}>
            ← 社内DXメニュー
          </Link>
        </div>
      </div>
      <p className="subtitle">週表示で予約状況を確認できます。空いているセルをクリックすると予約できます。</p>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="ghost-btn" onClick={() => setWeekStart((d) => addDays(d, -7))}>
              ← 前週
            </button>
            <button className="ghost-btn" onClick={() => setWeekStart(mondayOf(new Date()))}>
              今週
            </button>
            <button className="ghost-btn" onClick={() => setWeekStart((d) => addDays(d, 7))}>
              次週 →
            </button>
          </div>
          <button
            className="ghost-btn"
            onClick={() => openCreateFromCell(toDateKey(days[0]), SLOT_TIMES[0])}
            style={{ borderColor: "var(--rk-direct)", color: "var(--rk-direct)" }}
          >
            予約する
          </button>
        </div>

        {loading && (
          <p className="cell-sub">
            <span className="spinner" />
            読み込み中…
          </p>
        )}
        {loadError && <p style={{ color: "var(--rk-critical)" }}>{loadError}</p>}

        {!loading && !loadError && (
          <div className="table-scroll">
            <table style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "70px" }} />
                {days.map((d) => (
                  <col key={toDateKey(d)} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th></th>
                  {days.map((d) => (
                    <th key={toDateKey(d)} style={{ textAlign: "center" }}>
                      {formatDateWithWeekday(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const dayGrids = days.map((d) => buildDayGrid(toDateKey(d), reservations));
                  return SLOT_TIMES.map((time, rowIdx) => (
                    <tr key={time} style={{ height: ROW_HEIGHT }}>
                      <td className="cell-sub" style={{ verticalAlign: "top", whiteSpace: "nowrap" }}>
                        {time}
                      </td>
                      {days.map((d, dayIdx) => {
                        const slot = dayGrids[dayIdx][rowIdx];
                        if (slot === "covered") return null;
                        const dateKey = toDateKey(d);
                        if (slot === null) {
                          return (
                            <td
                              key={dateKey}
                              className="clickable-cell"
                              onClick={() => openCreateFromCell(dateKey, time)}
                              style={{ cursor: "pointer" }}
                            />
                          );
                        }
                        const { reservation, span } = slot;
                        return (
                          <td
                            key={dateKey}
                            rowSpan={span}
                            className="clickable-cell"
                            onClick={() => {
                              setActionError(null);
                              setModal({ kind: "detail", reservation });
                            }}
                            style={{
                              cursor: "pointer",
                              background: "rgba(42,120,214,0.10)",
                              verticalAlign: "top",
                              padding: "4px 6px",
                            }}
                          >
                            <div style={{ fontSize: 11, fontWeight: 600 }}>
                              {reservation.start_time.slice(0, 5)}〜{reservation.end_time.slice(0, 5)}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 700 }}>{reservation.applicant_name}</div>
                            {reservation.visitor_name && (
                              <div className="cell-sub">来訪: {reservation.visitor_name}</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal.kind !== "closed" && (
        <RoomReservationModal
          modal={modal}
          setModal={setModal}
          onClose={closeModal}
          submitting={submitting}
          actionError={actionError}
          setActionError={setActionError}
          onSubmitCreate={submitCreate}
          onSubmitEdit={submitEdit}
          onSubmitDelete={submitDelete}
        />
      )}
    </div>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 380, maxWidth: "90vw", maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, fontSize: 16 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function RoomReservationModal({
  modal,
  setModal,
  onClose,
  submitting,
  actionError,
  setActionError,
  onSubmitCreate,
  onSubmitEdit,
  onSubmitDelete,
}: {
  modal: ModalState;
  setModal: (m: ModalState) => void;
  onClose: () => void;
  submitting: boolean;
  actionError: string | null;
  setActionError: (e: string | null) => void;
  onSubmitCreate: (s: Extract<ModalState, { kind: "createForm" }>) => void;
  onSubmitEdit: (s: Extract<ModalState, { kind: "editForm" }>) => void;
  onSubmitDelete: (s: Extract<ModalState, { kind: "deleteConfirm" }>) => void;
}) {
  if (modal.kind === "enterNameCreate") {
    return (
      <ModalShell title="申請者名を入力してください" onClose={onClose}>
        <NameEntryForm
          onCancel={onClose}
          onNext={(name) =>
            setModal({
              kind: "createForm",
              date: modal.date,
              startTime: modal.startTime,
              endTime: endTimeOptions(modal.startTime)[0] ?? "18:00",
              applicantName: name,
              visitorName: "",
            })
          }
        />
      </ModalShell>
    );
  }

  if (modal.kind === "createForm") {
    return (
      <ModalShell title="新規予約" onClose={onClose}>
        <ReservationForm
          date={modal.date}
          startTime={modal.startTime}
          endTime={modal.endTime}
          visitorName={modal.visitorName}
          applicantName={modal.applicantName}
          onChange={(patch) => setModal({ ...modal, ...patch })}
          submitting={submitting}
          error={actionError}
          submitLabel="登録"
          onCancel={onClose}
          onSubmit={() => {
            if (!isValidTimeRange(modal.startTime, modal.endTime)) {
              setActionError("終了時刻は開始時刻より後にしてください。");
              return;
            }
            onSubmitCreate(modal);
          }}
        />
      </ModalShell>
    );
  }

  if (modal.kind === "detail") {
    const r = modal.reservation;
    return (
      <ModalShell title="予約内容" onClose={onClose}>
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <div>日付: {r.reservation_date}</div>
          <div>
            時間: {r.start_time.slice(0, 5)}〜{r.end_time.slice(0, 5)}
          </div>
          <div>申請者名: {r.applicant_name}</div>
          <div>訪問者名: {r.visitor_name || "―"}</div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button className="ghost-btn" onClick={() => setModal({ kind: "enterNameEdit", reservation: r, nameInput: "", nameError: null })}>
            変更
          </button>
          <button
            className="ghost-btn"
            style={{ color: "var(--rk-critical)", borderColor: "var(--rk-critical)" }}
            onClick={() => setModal({ kind: "enterNameDelete", reservation: r, nameInput: "", nameError: null })}
          >
            削除
          </button>
          <button className="ghost-btn" onClick={onClose} style={{ marginLeft: "auto" }}>
            閉じる
          </button>
        </div>
      </ModalShell>
    );
  }

  if (modal.kind === "enterNameEdit" || modal.kind === "enterNameDelete") {
    const isDelete = modal.kind === "enterNameDelete";
    return (
      <ModalShell title="本人確認: 申請者名を入力してください" onClose={onClose}>
        <p className="cell-sub" style={{ marginTop: 0 }}>
          この予約を登録したときの申請者名と完全に一致する名前を入力してください。
        </p>
        <input
          type="text"
          value={modal.nameInput}
          onChange={(e) => setModal({ ...modal, nameInput: e.target.value, nameError: null })}
          placeholder="申請者名"
          style={{ width: "100%", padding: "7px 9px", border: "1px solid var(--rk-border)", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }}
        />
        {modal.nameError && <p style={{ color: "var(--rk-critical)", fontSize: 12.5 }}>{modal.nameError}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button
            className="ghost-btn"
            onClick={() => {
              if (modal.nameInput.trim() !== modal.reservation.applicant_name) {
                setModal({ ...modal, nameError: "申請者名が一致しません。" });
                return;
              }
              if (isDelete) {
                setModal({ kind: "deleteConfirm", reservation: modal.reservation, applicantName: modal.nameInput.trim() });
              } else {
                const r = modal.reservation;
                setModal({
                  kind: "editForm",
                  reservation: r,
                  applicantName: modal.nameInput.trim(),
                  date: r.reservation_date,
                  startTime: r.start_time.slice(0, 5),
                  endTime: r.end_time.slice(0, 5),
                  visitorName: r.visitor_name ?? "",
                });
              }
            }}
          >
            確認
          </button>
          <button className="ghost-btn" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </ModalShell>
    );
  }

  if (modal.kind === "editForm") {
    return (
      <ModalShell title="予約の変更" onClose={onClose}>
        <ReservationForm
          date={modal.date}
          startTime={modal.startTime}
          endTime={modal.endTime}
          visitorName={modal.visitorName}
          applicantName={modal.applicantName}
          onChange={(patch) => setModal({ ...modal, ...patch })}
          submitting={submitting}
          error={actionError}
          submitLabel="変更を保存"
          onCancel={onClose}
          onSubmit={() => {
            if (!isValidTimeRange(modal.startTime, modal.endTime)) {
              setActionError("終了時刻は開始時刻より後にしてください。");
              return;
            }
            onSubmitEdit(modal);
          }}
        />
      </ModalShell>
    );
  }

  if (modal.kind === "deleteConfirm") {
    const r = modal.reservation;
    return (
      <ModalShell title="本当に削除しますか?" onClose={onClose}>
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <div>日付: {r.reservation_date}</div>
          <div>
            時間: {r.start_time.slice(0, 5)}〜{r.end_time.slice(0, 5)}
          </div>
          <div>申請者名: {r.applicant_name}</div>
        </div>
        {actionError && <p style={{ color: "var(--rk-critical)", fontSize: 12.5 }}>{actionError}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button
            className="ghost-btn"
            style={{ color: "var(--rk-critical)", borderColor: "var(--rk-critical)" }}
            disabled={submitting}
            onClick={() => onSubmitDelete(modal)}
          >
            {submitting ? (
              <>
                <span className="spinner" />
                削除中…
              </>
            ) : (
              "削除する"
            )}
          </button>
          <button className="ghost-btn" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </ModalShell>
    );
  }

  return null;
}

function NameEntryForm({ onNext, onCancel }: { onNext: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  return (
    <div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="申請者名(利用者本人)"
        autoFocus
        style={{ width: "100%", padding: "7px 9px", border: "1px solid var(--rk-border)", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }}
      />
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button className="ghost-btn" disabled={!name.trim()} onClick={() => onNext(name.trim())}>
          次へ
        </button>
        <button className="ghost-btn" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </div>
  );
}

function ReservationForm({
  date,
  startTime,
  endTime,
  visitorName,
  applicantName,
  onChange,
  submitting,
  error,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  date: string;
  startTime: string;
  endTime: string;
  visitorName: string;
  applicantName: string;
  onChange: (patch: Partial<{ date: string; startTime: string; endTime: string; visitorName: string }>) => void;
  submitting: boolean;
  error: string | null;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const allTimes = [...SLOT_TIMES, "18:00"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="cell-sub">申請者名: {applicantName}</div>
      <label style={{ fontSize: 12.5 }}>
        日付
        <input
          type="date"
          value={date}
          onChange={(e) => onChange({ date: e.target.value })}
          style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--rk-border)", borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginTop: 3 }}
        />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ fontSize: 12.5, flex: 1 }}>
          開始時刻
          <select
            value={startTime}
            onChange={(e) => {
              const newStart = e.target.value;
              const opts = endTimeOptions(newStart);
              onChange({ startTime: newStart, endTime: opts.includes(endTime) ? endTime : opts[0] ?? "18:00" });
            }}
            style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--rk-border)", borderRadius: 6, fontSize: 13, marginTop: 3 }}
          >
            {allTimes.slice(0, -1).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12.5, flex: 1 }}>
          終了時刻
          <select
            value={endTime}
            onChange={(e) => onChange({ endTime: e.target.value })}
            style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--rk-border)", borderRadius: 6, fontSize: 13, marginTop: 3 }}
          >
            {endTimeOptions(startTime).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label style={{ fontSize: 12.5 }}>
        訪問者名(任意)
        <input
          type="text"
          value={visitorName}
          onChange={(e) => onChange({ visitorName: e.target.value })}
          style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--rk-border)", borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginTop: 3 }}
        />
      </label>
      {error && <p style={{ color: "var(--rk-critical)", fontSize: 12.5, margin: 0 }}>{error}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button className="ghost-btn" disabled={submitting} onClick={onSubmit}>
          {submitting ? (
            <>
              <span className="spinner" />
              保存中…
            </>
          ) : (
            submitLabel
          )}
        </button>
        <button className="ghost-btn" onClick={onCancel} disabled={submitting}>
          キャンセル
        </button>
      </div>
    </div>
  );
}
