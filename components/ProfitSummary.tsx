"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ProfitSummaryRow } from "@/lib/profitTypes";
import { branchLabel } from "@/lib/branch-names";
import { repLabel } from "@/lib/rep-names";
import { periodKeyFor, periodRangeFor, fiscalYearStartOf, fiscalYearPeriods, fiscalYearLabel } from "@/lib/period";
import { CrossPageNav } from "./ProfitDashboard";
import TrendChart from "./TrendChart";
import type { ChartConfiguration } from "chart.js/auto";

/**
 * 拠点・営業担当・得意先別 利益ダッシュボード(rieki-check-appから移植)
 *
 * 売上総利益(revenue-cost、粗利)だけでなく、運賃の実費(freight_actual_summary経由で
 * 判明する実費)まで引いた最終利益・最終粗利率を、拠点別・営業担当別・得意先別に確認できる。
 *
 * profit_summaryは件数が増え続けるテーブルのため、/api/profit-summaryをoffsetをずらしながら
 * 何回かに分けて呼び出し、ブラウザ側で全件を組み立ててから集計する。
 */

type Dimension = "branch" | "rep" | "customer";
// 「今期/前期/全期間」の決算期切り替え。"month" は「月で指定」プルダウンで
// 特定の期間(period_end)を1つ選んだ状態。
type PeriodMode = "all" | "fy-current" | "fy-previous" | "month";

const CHUNK_SIZE = 5000;
const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RETRIES = 3;
const MAX_GAP_FILL_ROUNDS = 20;

type ChunkResponse = {
  rows: ProfitSummaryRow[];
  total: number | null;
  offset: number;
  hasMore: boolean;
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchChunkOnce(offset: number): Promise<ChunkResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/profit-summary?offset=${offset}&limit=${CHUNK_SIZE}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        rows: [],
        total: null,
        offset,
        hasMore: false,
        error: json.error ?? res.statusText ?? "不明なエラー",
      };
    }
    return json as ChunkResponse;
  } catch (e) {
    const message =
      e instanceof DOMException && e.name === "AbortError"
        ? `タイムアウトしました(${REQUEST_TIMEOUT_MS / 1000}秒応答なし)`
        : String(e);
    return { rows: [], total: null, offset, hasMore: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchChunk(offset: number): Promise<ChunkResponse> {
  let last: ChunkResponse = { rows: [], total: null, offset, hasMore: false, error: "不明なエラー" };
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await fetchChunkOnce(offset);
    if (!result.error) return result;
    last = result;
    if (attempt < MAX_RETRIES) {
      await sleep(1000 * (attempt + 1));
    }
  }
  return { ...last, error: `${last.error}(${MAX_RETRIES + 1}回試行しても失敗)` };
}

function fmtYen(n: number): string {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

function fmtPct(n: number | null): string {
  if (n === null) return "―";
  return `${n.toFixed(1)}%`;
}

// revenue合計から粗利率・最終粗利率を再計算する(パーセントを平均するのではなく、
// 必ず合計後の実額から計算し直す)。
function marginPct(numerator: number, revenue: number): number | null {
  if (revenue === 0) return null;
  return Math.round((numerator / revenue) * 10000) / 100;
}

function customerLabel(code: string | null, name: string | null): string {
  if (!name && !code) return "不明";
  if (!name) return code ?? "不明";
  return name;
}

type Group = {
  key: string;
  label: string;
  revenue: number;
  cost: number;
  gross_profit: number;
  freight_actual: number;
  final_profit: number;
  line_count: number;
};

function keyOf(r: ProfitSummaryRow, dimension: Dimension): string {
  if (dimension === "branch") return r.branch_code || "";
  if (dimension === "rep") return r.rep_code || "";
  return `${r.customer_code ?? ""}__${r.customer_name ?? ""}`;
}

function labelOf(r: ProfitSummaryRow, dimension: Dimension): string {
  if (dimension === "branch") return r.branch_code ? branchLabel(r.branch_code) : "不明";
  if (dimension === "rep") return r.rep_code ? repLabel(r.rep_code) : "不明";
  return customerLabel(r.customer_code, r.customer_name);
}

function aggregateByDim(rowsIn: ProfitSummaryRow[], dimension: Dimension): Map<string, Group> {
  const m = new Map<string, Group>();
  for (const r of rowsIn) {
    const key = keyOf(r, dimension);
    let g = m.get(key);
    if (!g) {
      g = { key, label: labelOf(r, dimension), revenue: 0, cost: 0, gross_profit: 0, freight_actual: 0, final_profit: 0, line_count: 0 };
      m.set(key, g);
    }
    g.revenue += r.revenue;
    g.cost += r.cost;
    g.gross_profit += r.gross_profit;
    g.freight_actual += r.freight_actual;
    g.final_profit += r.final_profit;
    g.line_count += r.line_count;
  }
  return m;
}

type MonthAgg = { revenue: number; cost: number; gross_profit: number; freight_actual: number; final_profit: number };

function sumMonths(arr: MonthAgg[], key: keyof MonthAgg): number {
  return arr.reduce((a, c) => a + c[key], 0);
}

export default function ProfitSummary() {
  const [rows, setRows] = useState<ProfitSummaryRow[] | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const startedRef = useRef(false);
  const cancelledRef = useRef(false);

  const [selectedPeriod, setSelectedPeriod] = useState<string>("all");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("fy-current");
  const [dimension, setDimension] = useState<Dimension>("branch");
  // 「個別レポート」で経営レポートと同じ構成を表示する対象(拠点/担当/得意先を1つ)。
  // ""のときは何も選ばれておらず、下の一覧表(拠点別・担当別・得意先別の比較)だけを表示する。
  const [selectedEntityKey, setSelectedEntityKey] = useState<string>("");

  async function runLoad(isRefresh: boolean) {
    if (isRefresh) {
      setRefreshing(true);
      setRefreshError(null);
    } else {
      setLoadedCount(0);
      setTotal(null);
      setInitialError(null);
    }

    const fail = (message: string) => {
      if (isRefresh) {
        setRefreshError(message);
        setRefreshing(false);
      } else {
        setInitialError(message);
      }
    };

    const first = await fetchChunk(0);
    if (cancelledRef.current) return;
    if (first.error || first.total === null) {
      fail(first.error ?? "件数の取得に失敗しました");
      return;
    }

    const firstTotal = first.total;
    const actualPageSize = first.rows.length;

    const collected: ProfitSummaryRow[] = [...first.rows];
    if (!isRefresh) {
      setTotal(firstTotal);
      setLoadedCount(collected.length);
    }

    if (actualPageSize > 0 && collected.length < firstTotal) {
      const remainingOffsets: number[] = [];
      for (let o = actualPageSize; o < firstTotal; o += actualPageSize) {
        remainingOffsets.push(o);
      }

      for (let i = 0; i < remainingOffsets.length; i += CONCURRENCY) {
        const batch = remainingOffsets.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map((o) => fetchChunk(o)));
        if (cancelledRef.current) return;
        for (const r of results) {
          if (r.error) {
            fail(r.error);
            return;
          }
          collected.push(...r.rows);
        }
        if (!isRefresh) setLoadedCount(collected.length);
      }
    }

    let gapFillRounds = 0;
    while (collected.length < firstTotal && gapFillRounds < MAX_GAP_FILL_ROUNDS) {
      if (cancelledRef.current) return;
      const r = await fetchChunk(collected.length);
      if (r.error) {
        fail(r.error);
        return;
      }
      if (r.rows.length === 0) break;
      collected.push(...r.rows);
      if (!isRefresh) setLoadedCount(collected.length);
      gapFillRounds++;
    }

    if (cancelledRef.current) return;

    if (collected.length !== firstTotal) {
      fail(
        `件数が一致しませんでした(取得: ${collected.length.toLocaleString(
          "ja-JP"
        )}件 / 本来: ${firstTotal.toLocaleString("ja-JP")}件)。もう一度お試しください。それでも解消しない場合は開発者に連絡してください。`
      );
      return;
    }

    setRows(collected);
    setLoadedAt(Date.now());
    if (isRefresh) setRefreshing(false);
  }

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      runLoad(false);
    }
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const periods = useMemo(() => {
    if (!rows) return [];
    const s = new Set(rows.map((r) => r.period_end));
    return Array.from(s).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // 新しい順
  }, [rows]);

  const availableFiscalYears = useMemo(() => {
    if (!rows) return [];
    const ys = new Set(rows.map((r) => fiscalYearStartOf(periodKeyFor(r.period_end))));
    return Array.from(ys).sort((a, b) => b - a);
  }, [rows]);
  const currentFYStart = useMemo(() => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;
    return fiscalYearStartOf(periodKeyFor(todayStr));
  }, []);
  const previousFYStart = availableFiscalYears.includes(currentFYStart - 1) ? currentFYStart - 1 : undefined;

  function fyPeriodEndSet(startCalYear: number): Set<string> {
    return new Set(fiscalYearPeriods(startCalYear).map((k) => periodRangeFor(k).to));
  }

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    if (periodMode === "month") {
      if (selectedPeriod === "all") return rows;
      return rows.filter((r) => r.period_end === selectedPeriod);
    }
    if (periodMode === "fy-current") {
      const set = fyPeriodEndSet(currentFYStart);
      return rows.filter((r) => set.has(r.period_end));
    }
    if (periodMode === "fy-previous" && previousFYStart !== undefined) {
      const set = fyPeriodEndSet(previousFYStart);
      return rows.filter((r) => set.has(r.period_end));
    }
    return rows; // "all"
  }, [rows, periodMode, selectedPeriod, currentFYStart, previousFYStart]);

  const grouped = useMemo(() => {
    const m = aggregateByDim(filteredRows, dimension);
    // 売上総利益(gross_profit)の大きい順。運賃だけの不明行(revenue=0)は自然と下に来る。
    return Array.from(m.values())
      .map((g) => ({
        ...g,
        gross_margin_pct: marginPct(g.gross_profit, g.revenue),
        final_margin_pct: marginPct(g.final_profit, g.revenue),
      }))
      .sort((a, b) => b.gross_profit - a.gross_profit);
  }, [filteredRows, dimension]);

  // 経営レポートタブと同じ「今期(累計)・前期(同期間)・昨対」比較を、拠点/営業担当/得意先
  // それぞれの内訳にも出すためのもの。periodMode==="fy-current"(今期を見ているとき)
  // だけ、前期側の「今期と同じ月数分」を集計する。全期間・前期・特定月を見ているときは
  // 比べる対象が定義できない(前期そのものを見ているときに前期と比べても意味が無い等)ため
  // 比較列は出さず、従来通りの単一期間表示のままにする。
  const prevSame = useMemo(() => {
    if (periodMode !== "fy-current" || !rows || previousFYStart === undefined) return null;
    const curFYPeriods = fiscalYearPeriods(currentFYStart);
    const curEnds = curFYPeriods.map((k) => periodRangeFor(k).to);
    const hasData = curEnds.map((end) => rows.some((r) => r.period_end === end && (r.revenue !== 0 || r.cost !== 0 || r.line_count !== 0)));
    let lastIdx = -1;
    hasData.forEach((v, i) => {
      if (v) lastIdx = i;
    });
    if (lastIdx < 0) return null;
    const prevFYPeriods = fiscalYearPeriods(previousFYStart);
    const sameEnds = new Set(prevFYPeriods.slice(0, lastIdx + 1).map((k) => periodRangeFor(k).to));
    const prevRows = rows.filter((r) => sameEnds.has(r.period_end));
    return { map: aggregateByDim(prevRows, dimension), monthCount: lastIdx + 1 };
  }, [rows, dimension, periodMode, currentFYStart, previousFYStart]);

  const prevSameTotals = useMemo(() => {
    if (!prevSame) return null;
    let revenue = 0;
    let final_profit = 0;
    for (const g of prevSame.map.values()) {
      revenue += g.revenue;
      final_profit += g.final_profit;
    }
    return { revenue, final_profit, final_margin_pct: marginPct(final_profit, revenue) };
  }, [prevSame]);

  // 個別レポートの対象を選ぶプルダウンの選択肢(今期に実績がある拠点/担当/得意先)。
  const entityOptions = useMemo(() => {
    if (!rows) return [];
    const set = fyPeriodEndSet(currentFYStart);
    const curRows = rows.filter((r) => set.has(r.period_end));
    const m = aggregateByDim(curRows, dimension);
    return Array.from(m.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map((g) => ({ key: g.key, label: g.label }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, dimension, currentFYStart]);

  // 経営レポートと同じ構成(総評・今期/前期比較表・KPI・月別推移グラフ)を、選んだ1つの
  // 拠点/担当/得意先だけの数字で組み立てる。ページ上部の「期間」ボタン(全期間/今期/前期/
  // 特定月)には左右されず、経営レポートと同じく常に「今期の累計 vs 前期の同期間」で見せる。
  const entityReport = useMemo(() => {
    if (!rows || !selectedEntityKey) return null;
    const curFYPeriods = fiscalYearPeriods(currentFYStart);
    const curEnds = curFYPeriods.map((k) => periodRangeFor(k).to);
    const prevFYPeriods = previousFYStart !== undefined ? fiscalYearPeriods(previousFYStart) : [];
    const prevEnds = prevFYPeriods.map((k) => periodRangeFor(k).to);

    function monthAgg(end: string): MonthAgg {
      let revenue = 0;
      let cost = 0;
      let gross_profit = 0;
      let freight_actual = 0;
      let final_profit = 0;
      for (const r of rows!) {
        if (r.period_end !== end || keyOf(r, dimension) !== selectedEntityKey) continue;
        revenue += r.revenue;
        cost += r.cost;
        gross_profit += r.gross_profit;
        freight_actual += r.freight_actual;
        final_profit += r.final_profit;
      }
      return { revenue, cost, gross_profit, freight_actual, final_profit };
    }

    const cur = curEnds.map(monthAgg);
    const prev = prevEnds.map(monthAgg);

    // 今期のうち実績が確定している月数(会社全体で、その月に何らかの実績があるかどうかで
    // 判定。選んだ拠点等がその月たまたま0円でも「未確定」扱いにならないようにするため)。
    const companyHasData = curEnds.map((end) => rows!.some((r) => r.period_end === end && (r.revenue !== 0 || r.cost !== 0)));
    let monthCount = 0;
    companyHasData.forEach((v, i) => {
      if (v) monthCount = i + 1;
    });

    const prevSameSlice = prev.slice(0, monthCount);
    const hasPrev = previousFYStart !== undefined && monthCount > 0;

    const cur_ts = sumMonths(cur, "revenue");
    const cur_tc = sumMonths(cur, "cost");
    const cur_gross = sumMonths(cur, "gross_profit");
    const cur_freight = sumMonths(cur, "freight_actual");
    const cur_final = sumMonths(cur, "final_profit");

    const prev_ts = sumMonths(prevSameSlice, "revenue");
    const prev_gross = sumMonths(prevSameSlice, "gross_profit");
    const prev_freight = sumMonths(prevSameSlice, "freight_actual");
    const prev_final = sumMonths(prevSameSlice, "final_profit");

    return {
      label: entityOptions.find((e) => e.key === selectedEntityKey)?.label ?? selectedEntityKey,
      monthCount,
      curKeys: curFYPeriods,
      cur,
      prev,
      hasPrev,
      cur_ts,
      cur_tc,
      cur_gross,
      cur_freight,
      cur_final,
      cur_gross_margin: marginPct(cur_gross, cur_ts),
      cur_final_margin: marginPct(cur_final, cur_ts),
      prev_ts,
      prev_gross,
      prev_freight,
      prev_final,
      prev_gross_margin: marginPct(prev_gross, prev_ts),
      prev_final_margin: marginPct(prev_final, prev_ts),
    };
  }, [rows, dimension, selectedEntityKey, currentFYStart, previousFYStart, entityOptions]);

  const totals = useMemo(() => {
    let revenue = 0;
    let cost = 0;
    let gross_profit = 0;
    let freight_actual = 0;
    let final_profit = 0;
    let line_count = 0;
    for (const r of filteredRows) {
      revenue += r.revenue;
      cost += r.cost;
      gross_profit += r.gross_profit;
      freight_actual += r.freight_actual;
      final_profit += r.final_profit;
      line_count += r.line_count;
    }
    return {
      revenue,
      cost,
      gross_profit,
      freight_actual,
      final_profit,
      line_count,
      gross_margin_pct: marginPct(gross_profit, revenue),
      final_margin_pct: marginPct(final_profit, revenue),
    };
  }, [filteredRows]);

  if (!rows) {
    if (initialError) {
      return (
        <div className="rk">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <h1>拠点・営業・得意先 利益</h1>
            <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
              <CrossPageNav current="profit-summary" />
              <Link href="/menu" className="ghost-btn" style={{ textDecoration: "none" }}>
                ← メインメニュー
              </Link>
            </div>
          </div>
          <div className="card">
            <p>データの取得に失敗しました。</p>
            <pre style={{ whiteSpace: "pre-wrap", color: "#c0392b" }}>{initialError}</pre>
            <button className="ghost-btn" style={{ marginTop: 12 }} onClick={() => runLoad(false)}>
              もう一度読み込む
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="rk">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <h1>拠点・営業・得意先 利益</h1>
          <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
            <CrossPageNav current="profit-summary" />
            <Link href="/menu" className="ghost-btn" style={{ textDecoration: "none" }}>
              ← メインメニュー
            </Link>
          </div>
        </div>
        <div className="card">
          <p>
            <span className="spinner" />
            読み込み中… {loadedCount.toLocaleString("ja-JP")}
            {total !== null ? ` / ${total.toLocaleString("ja-JP")}` : ""} 件
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rk">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <h1>拠点・営業・得意先 利益</h1>
        <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
          <CrossPageNav current="profit-summary" />
          <Link href="/menu" className="ghost-btn" style={{ textDecoration: "none" }}>
            ← メインメニュー
          </Link>
        </div>
      </div>
      <p className="subtitle">
        売上・原価に加えて運賃の実費(freight_actual)まで引いた最終利益・最終粗利率を、拠点別・営業担当別・得意先別に確認できます。売上に紐付かない運賃だけの行(送り状↔受注番号の対応が取れなかったもの)は「不明」として集計されます。
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "0 0 16px" }}>
        <span className="cell-sub">
          最終読み込み: {loadedAt !== null ? new Date(loadedAt).toLocaleString("ja-JP") : "―"}
          {refreshing && (
            <>
              {" "}
              (更新中… {loadedCount.toLocaleString("ja-JP")}
              {total !== null ? ` / ${total.toLocaleString("ja-JP")}` : ""} 件)
            </>
          )}
        </span>
        <button className="ghost-btn" onClick={() => runLoad(true)} disabled={refreshing}>
          {refreshing ? (
            <>
              <span className="spinner" />
              更新中…
            </>
          ) : (
            "更新"
          )}
        </button>
        {refreshError && <span style={{ color: "#c0392b", fontSize: 12.5 }}>更新に失敗しました: {refreshError}</span>}
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <p>まだ profit_summary にデータがありません。</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13 }}>期間(決算期・10月始まり):</span>
              <div className="segmented">
                <button type="button" className={periodMode === "all" ? "active" : ""} onClick={() => setPeriodMode("all")}>
                  全期間
                </button>
                <button
                  type="button"
                  className={periodMode === "fy-current" ? "active" : ""}
                  onClick={() => setPeriodMode("fy-current")}
                >
                  今期({fiscalYearLabel(currentFYStart)})
                </button>
                {previousFYStart !== undefined ? (
                  <button
                    type="button"
                    className={periodMode === "fy-previous" ? "active" : ""}
                    onClick={() => setPeriodMode("fy-previous")}
                  >
                    前期({fiscalYearLabel(previousFYStart)})
                  </button>
                ) : (
                  <span className="cell-sub">前期データは未アップロードです</span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ fontSize: 13 }}>
                月で指定(任意):{" "}
                <select
                  value={periodMode === "month" ? selectedPeriod : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) {
                      setPeriodMode("fy-current");
                      setSelectedPeriod("all");
                      return;
                    }
                    setPeriodMode("month");
                    setSelectedPeriod(v);
                  }}
                  style={{ padding: "4px 8px", border: "1px solid var(--rk-border)", borderRadius: 4 }}
                >
                  <option value="">―</option>
                  {periods.map((p) => (
                    <option key={p} value={p}>
                      〜{p}締め
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {(
                  [
                    ["branch", "拠点別"],
                    ["rep", "営業担当別"],
                    ["customer", "得意先別"],
                  ] as [Dimension, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setDimension(key);
                      setSelectedEntityKey("");
                    }}
                    className={dimension === key ? "" : "ghost-btn"}
                    style={
                      dimension === key
                        ? { padding: "6px 14px", borderRadius: 6, border: "1px solid var(--rk-direct)", background: "var(--rk-direct)", color: "#fff" }
                        : { padding: "6px 14px" }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
              <label style={{ fontSize: 13 }}>
                個別レポート({dimension === "branch" ? "拠点" : dimension === "rep" ? "営業担当" : "得意先"}を1つ選ぶと、経営レポートと同じ構成で表示):{" "}
                <select
                  value={selectedEntityKey}
                  onChange={(e) => setSelectedEntityKey(e.target.value)}
                  style={{ padding: "4px 8px", border: "1px solid var(--rk-border)", borderRadius: 4, minWidth: 200 }}
                >
                  <option value="">―</option>
                  {entityOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {entityReport && <EntityReportSection report={entityReport} />}

          <div className="kpi-row">
            <div className="kpi-tile">
              <div className="label">売上</div>
              <div className="value">{fmtYen(totals.revenue)}</div>
              {prevSameTotals && (
                <div className="cell-sub" style={{ marginTop: 4 }}>
                  前期同期間 {fmtYen(prevSameTotals.revenue)} ・ 昨対{" "}
                  <span style={{ color: totals.revenue >= prevSameTotals.revenue ? "var(--rk-good)" : "var(--rk-critical)" }}>
                    {prevSameTotals.revenue ? `${totals.revenue >= prevSameTotals.revenue ? "+" : ""}${((totals.revenue / prevSameTotals.revenue - 1) * 100).toFixed(1)}%` : "―"}
                  </span>
                </div>
              )}
            </div>
            <div className="kpi-tile">
              <div className="label">売上総利益</div>
              <div className="value">{fmtYen(totals.gross_profit)}</div>
            </div>
            <div className="kpi-tile">
              <div className="label">運賃実費合計</div>
              <div className="value">{fmtYen(totals.freight_actual)}</div>
            </div>
            <div className="kpi-tile">
              <div className="label">最終利益</div>
              <div className="value" style={{ color: totals.final_profit < 0 ? "var(--rk-critical)" : undefined }}>
                {fmtYen(totals.final_profit)}
              </div>
              {prevSameTotals && (
                <div className="cell-sub" style={{ marginTop: 4 }}>
                  前期同期間 {fmtYen(prevSameTotals.final_profit)} ・ 昨対{" "}
                  <span
                    style={{
                      color: totals.final_profit - prevSameTotals.final_profit >= 0 ? "var(--rk-good)" : "var(--rk-critical)",
                    }}
                  >
                    {totals.final_profit - prevSameTotals.final_profit >= 0 ? "+" : ""}
                    {fmtYen(totals.final_profit - prevSameTotals.final_profit)}
                  </span>
                </div>
              )}
            </div>
            <div className="kpi-tile">
              <div className="label">最終粗利率</div>
              <div className="value">{fmtPct(totals.final_margin_pct)}</div>
              {prevSameTotals && <div className="cell-sub" style={{ marginTop: 4 }}>前期同期間 {fmtPct(prevSameTotals.final_margin_pct)}</div>}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            {prevSame && (
              <p className="cell-sub" style={{ marginBottom: 10 }}>
                前期との比較は、今期データが確定している{prevSame.monthCount}ヶ月分(前期の同じ期間)で揃えています。
              </p>
            )}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{dimension === "branch" ? "拠点" : dimension === "rep" ? "営業担当" : "得意先"}</th>
                    <th className="num">売上(今期)</th>
                    {prevSame && (
                      <>
                        <th className="num">売上(前期同期間)</th>
                        <th className="num">昨対</th>
                      </>
                    )}
                    <th className="num">原価</th>
                    <th className="num">売上総利益</th>
                    <th className="num">粗利率</th>
                    <th className="num">運賃実費</th>
                    <th className="num">最終利益(今期)</th>
                    {prevSame && (
                      <>
                        <th className="num">最終利益(前期同期間)</th>
                        <th className="num">昨対</th>
                      </>
                    )}
                    <th className="num">最終粗利率</th>
                    <th className="num">明細行数</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map((g) => {
                    const prev = prevSame?.map.get(g.key);
                    const salesYoy = prev && prev.revenue ? (g.revenue / prev.revenue - 1) * 100 : null;
                    const profitDiff = prev ? g.final_profit - prev.final_profit : null;
                    return (
                      <tr key={g.key}>
                        <td>{g.label}</td>
                        <td className="num">{fmtYen(g.revenue)}</td>
                        {prevSame && (
                          <>
                            <td className="num cell-sub">{fmtYen(prev?.revenue ?? 0)}</td>
                            <td className="num" style={{ color: salesYoy === null ? undefined : salesYoy >= 0 ? "var(--rk-good)" : "var(--rk-critical)" }}>
                              {salesYoy === null ? "―" : `${salesYoy >= 0 ? "+" : ""}${salesYoy.toFixed(1)}%`}
                            </td>
                          </>
                        )}
                        <td className="num">{fmtYen(g.cost)}</td>
                        <td className="num">{fmtYen(g.gross_profit)}</td>
                        <td className="num cell-sub">{fmtPct(g.gross_margin_pct)}</td>
                        <td className="num">{fmtYen(g.freight_actual)}</td>
                        <td className="num" style={{ color: g.final_profit < 0 ? "var(--rk-critical)" : undefined }}>
                          {fmtYen(g.final_profit)}
                        </td>
                        {prevSame && (
                          <>
                            <td className="num cell-sub">{fmtYen(prev?.final_profit ?? 0)}</td>
                            <td className="num" style={{ color: profitDiff === null ? undefined : profitDiff >= 0 ? "var(--rk-good)" : "var(--rk-critical)" }}>
                              {profitDiff === null ? "―" : `${profitDiff >= 0 ? "+" : ""}${fmtYen(profitDiff)}`}
                            </td>
                          </>
                        )}
                        <td className="num cell-sub">{fmtPct(g.final_margin_pct)}</td>
                        <td className="num cell-sub">{g.line_count.toLocaleString("ja-JP")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type EntityReport = {
  label: string;
  monthCount: number;
  curKeys: string[];
  cur: MonthAgg[];
  prev: MonthAgg[];
  hasPrev: boolean;
  cur_ts: number;
  cur_tc: number;
  cur_gross: number;
  cur_freight: number;
  cur_final: number;
  cur_gross_margin: number | null;
  cur_final_margin: number | null;
  prev_ts: number;
  prev_gross: number;
  prev_freight: number;
  prev_final: number;
  prev_gross_margin: number | null;
  prev_final_margin: number | null;
};

// 経営レポートタブ(SalesDashboardClientのReportPage)と同じ構成
// (総評・今期/前期比較表・KPI・月別推移グラフ)を、選んだ1つの拠点/担当/得意先だけで
// 組み立てたもの。数字の意味が違う(在庫仕入の代わりに運賃実費、粗利額の代わりに
// 売上総利益・最終利益の2段)だけで、見せ方(4列比較表・KPIカード・グラフ)は同じにしている。
function EntityReportSection({ report: r }: { report: EntityReport }) {
  const salesDiffPct = r.hasPrev && r.prev_ts ? Math.round((r.cur_ts / r.prev_ts - 1) * 1000) / 10 : null;
  const grossDiffAmt = r.hasPrev ? r.cur_gross - r.prev_gross : null;
  const grossMarginDiffPt =
    r.hasPrev && r.cur_gross_margin !== null && r.prev_gross_margin !== null
      ? Math.round((r.cur_gross_margin - r.prev_gross_margin) * 10) / 10
      : null;
  const freightDiffAmt = r.hasPrev ? r.cur_freight - r.prev_freight : null;
  const finalDiffAmt = r.hasPrev ? r.cur_final - r.prev_final : null;
  const finalMarginDiffPt =
    r.hasPrev && r.cur_final_margin !== null && r.prev_final_margin !== null
      ? Math.round((r.cur_final_margin - r.prev_final_margin) * 10) / 10
      : null;

  const salesUp = salesDiffPct !== null && salesDiffPct >= 0;
  const finalMarginUp = finalMarginDiffPt !== null && finalMarginDiffPt >= 0;
  const finalUp = finalDiffAmt !== null && finalDiffAmt >= 0;
  // 運賃実費は減った方が良いので、他の指標と符号の意味が逆になる。
  const freightUp = freightDiffAmt !== null && freightDiffAmt <= 0;

  const chartConfig: ChartConfiguration = {
    type: "bar",
    data: {
      labels: r.curKeys.map((k) => `${parseInt(k.slice(4, 6), 10)}月`),
      datasets: [
        {
          type: "bar" as const,
          label: "今期 売上",
          data: r.cur.map((c) => c.revenue),
          backgroundColor: "#2563d9",
          borderRadius: 5,
          barPercentage: 0.6,
          categoryPercentage: 0.7,
        },
        {
          type: "line" as const,
          label: "前期 売上",
          data: r.prev.map((c) => c.revenue),
          borderColor: "#9aa3b2",
          borderDash: [5, 4],
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
    },
  };

  return (
    <div className="card" style={{ marginBottom: 20, padding: "18px 20px" }}>
      <h2 style={{ marginTop: 0 }}>{r.label} の経営レポート</h2>

      <p style={{ fontSize: 15, lineHeight: 1.9, marginTop: 8 }}>
        売上は前期同期間より{" "}
        {r.hasPrev && salesDiffPct !== null ? (
          <>
            <b style={{ color: salesUp ? "var(--rk-good)" : "var(--rk-critical)" }}>
              {salesUp ? "+" : ""}
              {salesDiffPct}%
            </b>
            {salesUp ? "増加" : "減少"}しています({fmtYen(r.cur_ts)})。
          </>
        ) : (
          <>比較できる前期データがありません({fmtYen(r.cur_ts)})。</>
        )}
        <br />
        最終粗利率は前期同期間より{" "}
        {r.hasPrev && finalMarginDiffPt !== null ? (
          <>
            <b style={{ color: finalMarginUp ? "var(--rk-good)" : "var(--rk-critical)" }}>
              {finalMarginUp ? "+" : ""}
              {finalMarginDiffPt}pt
            </b>
            {finalMarginUp ? "改善" : "低下"}しています({fmtPct(r.cur_final_margin)} ← {fmtPct(r.prev_final_margin)})。
          </>
        ) : (
          <>比較できる前期データがありません({fmtPct(r.cur_final_margin)})。</>
        )}
        <br />
        運賃実費は前期同期間より{" "}
        {r.hasPrev && freightDiffAmt !== null ? (
          <>
            <b style={{ color: freightUp ? "var(--rk-good)" : "var(--rk-critical)" }}>
              {freightDiffAmt >= 0 ? "+" : ""}
              {fmtYen(freightDiffAmt)}
            </b>
            {freightDiffAmt <= 0 ? "減少" : "増加"}しています。
          </>
        ) : (
          <>比較できる前期データがありません({fmtYen(r.cur_freight)})。</>
        )}
      </p>

      <div className="table-scroll" style={{ marginTop: 16 }}>
        <table className="mat" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th className="namecol">項目</th>
              <th>今期(累計)</th>
              <th>前期(同期間)</th>
              <th>昨対</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="namecol">売上</td>
              <td><span className="cell-s">{fmtYen(r.cur_ts)}</span></td>
              <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{r.hasPrev ? fmtYen(r.prev_ts) : "―"}</span></td>
              <td><span className={`cell-s ${salesUp ? "val-pos" : "val-neg"}`}>{salesDiffPct !== null ? `${salesUp ? "+" : ""}${salesDiffPct}%` : "―"}</span></td>
            </tr>
            <tr>
              <td className="namecol">売上総利益</td>
              <td><span className="cell-s">{fmtYen(r.cur_gross)}</span></td>
              <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{r.hasPrev ? fmtYen(r.prev_gross) : "―"}</span></td>
              <td>
                <span className={`cell-s ${grossDiffAmt !== null && grossDiffAmt >= 0 ? "val-pos" : "val-neg"}`}>
                  {grossDiffAmt !== null ? `${grossDiffAmt >= 0 ? "+" : ""}${fmtYen(grossDiffAmt)}` : "―"}
                </span>
              </td>
            </tr>
            <tr>
              <td className="namecol">粗利率</td>
              <td><span className="cell-s">{fmtPct(r.cur_gross_margin)}</span></td>
              <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{r.hasPrev ? fmtPct(r.prev_gross_margin) : "―"}</span></td>
              <td>
                <span className={`cell-s ${grossMarginDiffPt !== null && grossMarginDiffPt >= 0 ? "val-pos" : "val-neg"}`}>
                  {grossMarginDiffPt !== null ? `${grossMarginDiffPt >= 0 ? "+" : ""}${grossMarginDiffPt}pt` : "―"}
                </span>
              </td>
            </tr>
            <tr>
              <td className="namecol">運賃実費</td>
              <td><span className="cell-s">{fmtYen(r.cur_freight)}</span></td>
              <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{r.hasPrev ? fmtYen(r.prev_freight) : "―"}</span></td>
              <td>
                <span className={`cell-s ${freightUp ? "val-pos" : "val-neg"}`}>
                  {freightDiffAmt !== null ? `${freightDiffAmt >= 0 ? "+" : ""}${fmtYen(freightDiffAmt)}` : "―"}
                </span>
              </td>
            </tr>
            <tr>
              <td className="namecol">最終利益</td>
              <td><span className="cell-s">{fmtYen(r.cur_final)}</span></td>
              <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{r.hasPrev ? fmtYen(r.prev_final) : "―"}</span></td>
              <td>
                <span className={`cell-s ${finalUp ? "val-pos" : "val-neg"}`}>
                  {finalDiffAmt !== null ? `${finalDiffAmt >= 0 ? "+" : ""}${fmtYen(finalDiffAmt)}` : "―"}
                </span>
              </td>
            </tr>
            <tr>
              <td className="namecol">最終粗利率</td>
              <td><span className="cell-s">{fmtPct(r.cur_final_margin)}</span></td>
              <td><span className="cell-s" style={{ color: "#9aa3b2" }}>{r.hasPrev ? fmtPct(r.prev_final_margin) : "―"}</span></td>
              <td>
                <span className={`cell-s ${finalMarginUp ? "val-pos" : "val-neg"}`}>
                  {finalMarginDiffPt !== null ? `${finalMarginUp ? "+" : ""}${finalMarginDiffPt}pt` : "―"}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="kpi-grid" style={{ marginTop: 16 }}>
        <div className="kpi primary">
          <div className="label">今期 売上累計</div>
          <div className="value">{fmtYen(r.cur_ts)}</div>
          <div className="foot">{r.monthCount}ヶ月ぶん</div>
        </div>
        <div className="kpi">
          <div className="label">今期 最終利益累計</div>
          <div className="value">{fmtYen(r.cur_final)}</div>
          <div className="foot">{r.hasPrev ? `前期同期間 ${fmtYen(r.prev_final)}` : "前期データなし"}</div>
        </div>
        <div className="kpi">
          <div className="label">最終粗利率</div>
          <div className="value">{fmtPct(r.cur_final_margin)}</div>
          <div className="foot">{r.hasPrev ? `前期同期間 ${fmtPct(r.prev_final_margin)}` : "前期データなし"}</div>
        </div>
        <div className={r.hasPrev ? (finalUp ? "kpi hit" : "kpi miss") : "kpi"}>
          <div className="label">最終利益 昨対</div>
          <div className="value">{finalDiffAmt !== null ? `${finalDiffAmt >= 0 ? "+" : ""}${fmtYen(finalDiffAmt)}` : "―"}</div>
          {r.hasPrev && <div className={`badge ${finalUp ? "b-hit" : "b-miss"}`}>{finalUp ? "✓ 前期超え" : "△ 前期割れ"}</div>}
        </div>
      </div>

      <h2 className="blk" style={{ fontSize: 14, marginTop: 20 }}>月別推移:売上(今期 vs 前期)</h2>
      <div className="legend">
        <span><i className="dot" style={{ background: "#2563d9" }} />今期 売上</span>
        <span><i className="dot" style={{ background: "#9aa3b2" }} />前期 売上</span>
      </div>
      <div className="chart-box">
        <TrendChart config={chartConfig} />
      </div>
    </div>
  );
}
