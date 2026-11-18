"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  NON_GOODS_CODES,
  buildObsRows,
  lineKey,
  tradeStatus,
  type MasterOrderLine,
  type MasterPdfItem,
  type ObsRow,
} from "@/lib/smapsMasterMatch";

/**
 * SMAPS商品マスタ(イオン品番 ↔ 自社商品コード)。
 * 発注書(SMAPSの取引詳細PDF)を貼ると、同じ通番の受注データ(受注番号・行)と突き合わせて
 * 登録する。現在のマスタは「受注日が最新の発注書」の内容(貼った順番は関係ない)。
 */

const GENERIC_CODE = "77700";

type Trade = {
  fileName: string;
  tradeNo: string;
  store: string;
  title: string;
  items: MasterPdfItem[];
  lines: MasterOrderLine[];
  proposal: Record<string, string>;
  assign: Record<string, string>;
  auto: Record<string, boolean>;
  registeredAt: string | null;
  dirty: boolean;
};

type Loading = { fileName: string; error: string | null };

type MasterRow = ObsRow & { obs_count?: number; code_changed?: boolean; updated_at?: string };

function yen(n: number | null | undefined): string {
  return n == null ? "―" : `¥${Math.round(Number(n)).toLocaleString("ja-JP")}`;
}

function codeLabel(code: string | null | undefined): string {
  if (!code) return "―";
  return code === GENERIC_CODE ? `${code}(共通コード)` : code;
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(fileName: string, header: string[], rows: unknown[][]) {
  const text = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function itemJudge(t: Trade, it: MasterPdfItem): { label: string; color: string } {
  const assigned = Object.values(t.assign).includes(it.no);
  if (!assigned) return { label: "未割当", color: "var(--neg)" };
  const same = Object.keys(t.assign).every((k) => (t.assign[k] === it.no) === (t.proposal[k] === it.no));
  if (same && t.auto[it.no]) return { label: "自動一致", color: "var(--pos, #15803d)" };
  if (!same) return { label: "手動", color: "var(--ink)" };
  return { label: "要確認", color: "#b45309" };
}

function statusOf(t: Trade): string {
  if (t.registeredAt && !t.dirty) return "登録済み";
  const goods = t.lines.filter((l) => !NON_GOODS_CODES.has(l.product_code ?? ""));
  if (goods.length === 0) return "照合不可";
  const allAssigned = t.items.every((it) => Object.values(t.assign).includes(it.no));
  if (!t.dirty) return tradeStatus(t.items, t.lines, { assign: t.assign, auto: t.auto });
  return allAssigned ? "確認済み(未登録)" : "要確認";
}

export default function SmapsProductMaster() {
  const [tab, setTab] = useState<"match" | "master" | "history">("match");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState<Loading[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    for (const f of list) {
      setLoading((prev) => [...prev.filter((l) => l.fileName !== f.name), { fileName: f.name, error: null }]);
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/smaps-master/match", { method: "POST", body: fd });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? res.statusText);
        const trade: Trade = {
          fileName: f.name,
          tradeNo: json.tradeNo,
          store: json.store ?? "",
          title: json.title ?? "",
          items: json.items ?? [],
          lines: json.lines ?? [],
          proposal: { ...(json.assign ?? {}) },
          assign: { ...(json.assign ?? {}) },
          auto: json.auto ?? {},
          registeredAt: json.registeredAt ?? null,
          dirty: false,
        };
        setTrades((prev) => {
          const idx = prev.findIndex((t) => t.tradeNo === trade.tradeNo);
          const next = idx >= 0 ? prev.map((t, i) => (i === idx ? trade : t)) : [...prev, trade];
          setSelected(idx >= 0 ? idx : next.length - 1);
          return next;
        });
        setLoading((prev) => prev.filter((l) => l.fileName !== f.name));
      } catch (e) {
        setLoading((prev) =>
          prev.map((l) => (l.fileName === f.name ? { ...l, error: e instanceof Error ? e.message : String(e) } : l))
        );
      }
    }
  }

  function setAssign(tradeIndex: number, k: string, itemNo: string) {
    setTrades((prev) =>
      prev.map((t, i) => (i === tradeIndex ? { ...t, assign: { ...t.assign, [k]: itemNo }, dirty: true } : t))
    );
  }

  async function register(indexes: number[]) {
    const targets = indexes.map((i) => trades[i]);
    const payload = targets.map((t) => ({
      tradeNo: t.tradeNo,
      rows: buildObsRows(t.tradeNo, t.store, t.items, t.lines, t.assign),
    }));
    const empty = payload.find((p) => p.rows.length === 0);
    if (empty) {
      setMessage({ ok: false, text: `通番 ${empty.tradeNo}: 受注行が1つも割り当てられていないため登録できません。` });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/smaps-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trades: payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      const now = new Date().toISOString();
      setTrades((prev) =>
        prev.map((t, i) => (indexes.includes(i) ? { ...t, registeredAt: now, dirty: false, proposal: { ...t.assign } } : t))
      );
      setMessage({ ok: true, text: `${targets.map((t) => t.tradeNo).join("・")} を登録しました(${json.saved} 行)。` });
    } catch (e) {
      setMessage({ ok: false, text: `登録に失敗しました: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSaving(false);
    }
  }

  const autoIndexes = trades
    .map((t, i) => (statusOf(t) === "自動一致" ? i : -1))
    .filter((i) => i >= 0);
  const trade = selected !== null ? trades[selected] : null;

  return (
    <div className="wrap" style={{ maxWidth: 1400 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>SMAPS商品マスタ</h1>
          <p>
            発注書(SMAPSの取引詳細PDF)を受注データと突き合わせて、イオン品番と自社商品コードの対応を作ります。
            マスタは受注日が最新の発注書の内容になります(貼った順番は関係ありません)。
          </p>
        </div>
        <Link href="/sales-app" className="ghost-btn-inline">
          ← 営業アプリ
        </Link>
      </header>

      <div className="maintabs" style={{ marginBottom: 14 }}>
        <button className={tab === "match" ? "active" : ""} onClick={() => setTab("match")}>
          発注書照合
        </button>
        <button className={tab === "master" ? "active" : ""} onClick={() => setTab("master")}>
          商品マスタ
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          履歴
        </button>
      </div>

      {tab === "match" && (
        <>
          <div
            className="card"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
            }}
            style={{ padding: 20, marginBottom: 16, ...(dragging ? { outline: "2px dashed var(--brand)", outlineOffset: -2 } : {}) }}
          >
            <h2 style={{ marginTop: 0, fontSize: 16 }}>発注書PDF(複数可)</h2>
            <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--ink-faint)" }}>
              ここにドラッグ&ドロップするか、ボタンで選んでください。通番から受注データ(データ更新 ⑥)の受注番号・行を探して照合します。
            </p>
            <input
              type="file"
              accept=".pdf"
              multiple
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {loading.map((l) => (
              <div key={l.fileName} style={{ fontSize: 12.5, marginTop: 6, color: l.error ? "var(--neg)" : "var(--ink-faint)" }}>
                {l.error ? (
                  `${l.fileName}: ${l.error}(照合不可)`
                ) : (
                  <>
                    <span className="spinner" /> {l.fileName} を読み取り中…
                  </>
                )}
              </div>
            ))}
          </div>

          {trades.length > 0 && (
            <div className="card" style={{ padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <h2 style={{ margin: 0, fontSize: 16 }}>読み込んだ発注書</h2>
                <button
                  className="btn-primary"
                  disabled={saving || autoIndexes.length === 0}
                  onClick={() => register(autoIndexes)}
                >
                  自動一致をすべて登録({autoIndexes.length}件)
                </button>
              </div>
              <div className="table-scroll">
                <table className="smaps-tbl">
                  <thead>
                    <tr>
                      <th>通番</th>
                      <th>店舗</th>
                      <th>受注番号</th>
                      <th>受注日</th>
                      <th style={{ textAlign: "right" }}>明細</th>
                      <th>状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => {
                      const st = statusOf(t);
                      const orderNos = Array.from(new Set(t.lines.map((l) => l.order_no)));
                      const dates = Array.from(new Set(t.lines.map((l) => l.order_date).filter(Boolean)));
                      return (
                        <tr
                          key={t.tradeNo}
                          onClick={() => setSelected(i)}
                          style={{ cursor: "pointer", background: i === selected ? "var(--brand-soft, #eef2ff)" : undefined }}
                        >
                          <td>{t.tradeNo}</td>
                          <td>{t.store}</td>
                          <td>{orderNos.join("・") || "―"}</td>
                          <td>{dates.join("・") || "―"}</td>
                          <td className="nw" style={{ textAlign: "right" }}>{t.items.length}</td>
                          <td
                            style={{
                              fontWeight: 600,
                              color:
                                st === "照合不可" || st === "要確認"
                                  ? "var(--neg)"
                                  : st === "登録済み"
                                  ? "var(--ink-faint)"
                                  : "var(--pos, #15803d)",
                            }}
                          >
                            {st}
                            {st === "照合不可" ? "(受注データ未取込)" : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {message && (
            <div className={message.ok ? "alert" : "alert alert-error"} style={{ marginBottom: 12 }}>
              {message.text}
            </div>
          )}

          {trade && selected !== null && (
            <TradeDetail
              trade={trade}
              saving={saving}
              onAssign={(k, no) => setAssign(selected, k, no)}
              onRegister={() => register([selected])}
            />
          )}
        </>
      )}

      {tab === "master" && <MasterTab />}
      {tab === "history" && <HistoryTab />}
    </div>
  );
}

function TradeDetail({
  trade: t,
  saving,
  onAssign,
  onRegister,
}: {
  trade: Trade;
  saving: boolean;
  onAssign: (k: string, itemNo: string) => void;
  onRegister: () => void;
}) {
  const status = statusOf(t);
  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <h2 style={{ marginTop: 0, fontSize: 16 }}>
        通番 {t.tradeNo} {t.store}
        <span className="cell-sub" style={{ fontWeight: 400, marginLeft: 8 }}>
          {t.title} / {t.fileName}
          {t.registeredAt ? ` / 登録 ${new Date(t.registeredAt).toLocaleString("ja-JP")}` : ""}
        </span>
      </h2>

      <h3 style={{ fontSize: 14, margin: "12px 0 6px" }}>発注書の明細</h3>
      <div className="table-scroll">
        <table className="smaps-tbl">
          <thead>
            <tr>
              <th>No</th>
              <th>イオン品番</th>
              <th>品名</th>
              <th>型番</th>
              <th style={{ textAlign: "right" }}>単価</th>
              <th style={{ textAlign: "right" }}>数量</th>
              <th style={{ textAlign: "right" }}>金額</th>
              <th style={{ textAlign: "right" }}>割り当てた受注行の金額</th>
              <th>判定</th>
            </tr>
          </thead>
          <tbody>
            {t.items.map((it) => {
              const assigned = t.lines.filter((l) => t.assign[lineKey(l)] === it.no);
              const sum = assigned.reduce((s, l) => s + (l.unit_price ?? 0) * (l.qty ?? 0), 0);
              const j = itemJudge(t, it);
              return (
                <tr key={it.no}>
                  <td>{it.no}</td>
                  <td>{it.aeonCode}</td>
                  <td>{it.name}</td>
                  <td>{it.model || "―"}</td>
                  <td className="nw" style={{ textAlign: "right" }}>{yen(it.unitPrice)}</td>
                  <td className="nw" style={{ textAlign: "right" }}>{it.qty ?? "―"}</td>
                  <td className="nw" style={{ textAlign: "right" }}>{yen(it.amount ?? (it.unitPrice ?? 0) * (it.qty ?? 0))}</td>
                  <td className="nw" style={{ textAlign: "right" }}>{assigned.length > 0 ? `${yen(sum)}(${assigned.length}行)` : "―"}</td>
                  <td style={{ fontWeight: 600, color: j.color }}>{j.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>受注データ(同じ通番の受注明細)</h3>
      {t.lines.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--neg)" }}>
          この通番の受注が受注データにありません(照合不可)。データ更新 ⑥ で受注データを取り込んでから、もう一度PDFを入れてください。
        </p>
      ) : (
        <>
          <p style={{ margin: "0 0 6px", fontSize: 12.5, color: "var(--ink-faint)" }}>
            右端で、各受注行がどの発注書明細にあたるかを選んでください。セット商品は、構成部材の行をすべて同じ明細に割り当てます。運賃・値引の行は対象外です。
          </p>
          <div className="table-scroll">
            <table className="smaps-tbl">
              <thead>
                <tr>
                  <th>受注番号-行</th>
                  <th>受注日</th>
                  <th>自社商品コード</th>
                  <th>品名</th>
                  <th>仕様</th>
                  <th style={{ textAlign: "right" }}>数量</th>
                  <th style={{ textAlign: "right" }}>売価</th>
                  <th>手配</th>
                  <th>仕入先</th>
                  <th style={{ textAlign: "right" }}>原価</th>
                  <th>発注書の明細</th>
                </tr>
              </thead>
              <tbody>
                {t.lines.map((l) => {
                  const k = lineKey(l);
                  const nonGoods = NON_GOODS_CODES.has(l.product_code ?? "");
                  return (
                    <tr key={k} style={nonGoods ? { color: "var(--ink-faint)" } : undefined}>
                      <td className="nw">{k}</td>
                      <td className="nw">{l.order_date ?? "―"}</td>
                      <td className="nw">{codeLabel(l.product_code)}</td>
                      <td>{l.product_name ?? ""}</td>
                      <td>{l.spec ?? ""}</td>
                      <td className="nw" style={{ textAlign: "right" }}>{l.qty ?? ""}</td>
                      <td className="nw" style={{ textAlign: "right" }}>{yen(l.unit_price)}</td>
                      <td>{l.hand_type ?? ""}</td>
                      <td>{l.supplier_name ?? ""}</td>
                      <td className="nw" style={{ textAlign: "right" }}>
                        {yen(l.cost)}
                        {l.cost_source ? <span className="cell-sub">({l.cost_source})</span> : null}
                      </td>
                      <td>
                        {nonGoods ? (
                          "対象外"
                        ) : (
                          <select value={t.assign[k] ?? ""} onChange={(e) => onAssign(k, e.target.value)}>
                            <option value="">― 割り当てない</option>
                            {t.items.map((it) => (
                              <option key={it.no} value={it.no}>
                                {it.no}. {it.aeonCode} {it.name.slice(0, 20)}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
        <button
          className="btn-primary"
          disabled={saving || t.lines.length === 0 || !Object.values(t.assign).some((v) => v)}
          onClick={onRegister}
        >
          {saving ? "登録中…" : t.registeredAt ? "この発注書を登録し直す" : "この発注書を登録"}
        </button>
        <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>
          状態: {status}。割り当てなかった明細は登録されません。
        </span>
      </div>
    </div>
  );
}

const MASTER_CSV_HEADER = [
  "イオン品番", "発注書品名", "型番", "発注書単価", "自社商品コード", "品名", "仕様", "数量", "仕入先コード", "仕入先名",
  "手配区分", "原価", "原価区分", "売価", "受注日", "通番", "受注番号", "受注行", "店舗",
];

function masterCsvRow(r: MasterRow): unknown[] {
  return [
    r.aeon_code, r.pdf_name, r.pdf_model, r.pdf_price, r.our_code, r.our_name, r.spec, r.qty, r.supplier_code,
    r.supplier_name, r.hand_type, r.cost, r.cost_source, r.sell_price, r.order_date, r.trade_no, r.order_no,
    r.order_line, r.store_name,
  ];
}

function useRows(view: "master" | "history") {
  const [rows, setRows] = useState<MasterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/smaps-master?view=${view}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? res.statusText);
        if (alive) setRows(json.rows ?? []);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [view]);
  return { rows, error };
}

function matches(r: MasterRow, q: string): boolean {
  if (!q) return true;
  const s = [r.aeon_code, r.pdf_name, r.pdf_model, r.our_code, r.our_name, r.spec, r.supplier_name, r.trade_no, r.order_no]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => s.includes(w));
}

function MasterTab() {
  const { rows, error } = useRows("master");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "changed" | "generic" | "own">("all");

  const filtered = useMemo(() => {
    if (!rows) return [];
    const codesByAeon = new Map<string, string[]>();
    for (const r of rows) codesByAeon.set(r.aeon_code, [...(codesByAeon.get(r.aeon_code) ?? []), r.our_code ?? ""]);
    const okAeon = new Set(
      Array.from(new Set(rows.map((r) => r.aeon_code))).filter((a) => {
        const group = rows.filter((r) => r.aeon_code === a);
        if (!group.some((r) => matches(r, q))) return false;
        const codes = codesByAeon.get(a) ?? [];
        if (filter === "changed") return group.some((r) => r.code_changed);
        if (filter === "generic") return codes.includes(GENERIC_CODE);
        if (filter === "own") return codes.some((c) => c && c !== GENERIC_CODE);
        return true;
      })
    );
    return rows.filter((r) => okAeon.has(r.aeon_code));
  }, [rows, q, filter]);

  if (error) return <div className="alert alert-error">読み込みに失敗しました: {error}</div>;
  if (!rows) return <div className="card" style={{ padding: 20 }}><span className="spinner" /> 読み込み中…</div>;

  const aeonCount = new Set(filtered.map((r) => r.aeon_code)).size;
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input
          type="search"
          placeholder="イオン品番・品名・自社商品コード・仕入先・通番で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 320 }}
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">すべて</option>
          <option value="own">自社商品コードあり</option>
          <option value="generic">共通コード(77700)</option>
          <option value="changed">商品コード変更あり</option>
        </select>
        <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>
          イオン品番 {aeonCount} 件({filtered.length} 行)
        </span>
        <button
          className="ghost-btn"
          disabled={filtered.length === 0}
          onClick={() =>
            downloadCsv(`SMAPS商品マスタ_${today()}.csv`, [...MASTER_CSV_HEADER, "観測数", "商品コード変更あり"], filtered.map((r) => [
              ...masterCsvRow(r),
              r.obs_count ?? "",
              r.code_changed ? "あり" : "",
            ]))
          }
        >
          CSV出力
        </button>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 13 }}>まだ登録がありません。「発注書照合」タブで発注書PDFを登録してください。</p>
      ) : (
        <div className="table-scroll table-scroll-v" style={{ maxHeight: "70vh" }}>
          <table className="smaps-tbl">
            <thead>
              <tr>
                <th>イオン品番</th>
                <th>発注書品名</th>
                <th>自社商品コード</th>
                <th>品名</th>
                <th>仕様</th>
                <th>仕入先</th>
                <th>手配</th>
                <th style={{ textAlign: "right" }}>原価</th>
                <th style={{ textAlign: "right" }}>売価</th>
                <th>受注日</th>
                <th>通番</th>
                <th style={{ textAlign: "right" }}>観測数</th>
                <th>変更</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const first = i === 0 || filtered[i - 1].aeon_code !== r.aeon_code;
                return (
                  <tr key={`${r.aeon_code}-${r.order_no}-${r.order_line}`} style={first ? undefined : { borderTop: "none" }}>
                    <td style={{ fontWeight: 600 }}>{first ? r.aeon_code : ""}</td>
                    <td>{first ? r.pdf_name : ""}</td>
                    <td className="nw">{codeLabel(r.our_code)}</td>
                    <td>{r.our_name}</td>
                    <td>{r.spec}</td>
                    <td>{r.supplier_name}</td>
                    <td>{r.hand_type}</td>
                    <td className="nw" style={{ textAlign: "right" }}>
                      {yen(r.cost)}
                      {r.cost_source ? <span className="cell-sub">({r.cost_source})</span> : null}
                    </td>
                    <td className="nw" style={{ textAlign: "right" }}>{yen(r.sell_price)}</td>
                    <td className="nw">{first ? r.order_date : ""}</td>
                    <td>{first ? r.trade_no : ""}</td>
                    <td className="nw" style={{ textAlign: "right" }}>{first ? r.obs_count : ""}</td>
                    <td style={{ color: "var(--neg)", fontWeight: 600 }}>{first && r.code_changed ? "変更あり" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HistoryTab() {
  const { rows, error } = useRows("history");
  const [q, setQ] = useState("");
  const filtered = useMemo(() => (rows ?? []).filter((r) => matches(r, q)), [rows, q]);

  if (error) return <div className="alert alert-error">読み込みに失敗しました: {error}</div>;
  if (!rows) return <div className="card" style={{ padding: 20 }}><span className="spinner" /> 読み込み中…</div>;

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input
          type="search"
          placeholder="イオン品番・品名・自社商品コード・仕入先・通番で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 320 }}
        />
        <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>{filtered.length} 行(受注日の新しい順)</span>
        <button
          className="ghost-btn"
          disabled={filtered.length === 0}
          onClick={() => downloadCsv(`SMAPS商品マスタ_履歴_${today()}.csv`, MASTER_CSV_HEADER, filtered.map(masterCsvRow))}
        >
          CSV出力
        </button>
      </div>
      <div className="table-scroll table-scroll-v" style={{ maxHeight: "70vh" }}>
        <table className="smaps-tbl">
          <thead>
            <tr>
              <th>受注日</th>
              <th>通番</th>
              <th>No</th>
              <th>イオン品番</th>
              <th>発注書品名</th>
              <th style={{ textAlign: "right" }}>発注書単価</th>
              <th>受注番号-行</th>
              <th>自社商品コード</th>
              <th>品名</th>
              <th>仕入先</th>
              <th style={{ textAlign: "right" }}>原価</th>
              <th style={{ textAlign: "right" }}>売価</th>
              <th>店舗</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={`${r.trade_no}-${r.item_no}-${r.order_no}-${r.order_line}`}>
                <td className="nw">{r.order_date}</td>
                <td>{r.trade_no}</td>
                <td>{r.item_no}</td>
                <td>{r.aeon_code}</td>
                <td>{r.pdf_name}</td>
                <td className="nw" style={{ textAlign: "right" }}>{yen(r.pdf_price)}</td>
                <td>
                  {r.order_no}-{r.order_line}
                </td>
                <td className="nw">{codeLabel(r.our_code)}</td>
                <td>
                  {r.our_name} {r.spec}
                </td>
                <td>{r.supplier_name}</td>
                <td className="nw" style={{ textAlign: "right" }}>
                  {yen(r.cost)}
                  {r.cost_source ? <span className="cell-sub">({r.cost_source})</span> : null}
                </td>
                <td className="nw" style={{ textAlign: "right" }}>{yen(r.sell_price)}</td>
                <td>{r.store_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
