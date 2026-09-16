// 「在庫」タブ用のデータ集計。
// 拠点90・91(在庫仕入)の仕入明細(purchases)を、商品別・仕入先別・月別に集計する。
// v_monthlyには商品・仕入先の情報が無いため、こちらは生の仕入明細から直接集計する。

import { fiscalYearOf, periodIndexOf, ymFromDate, monthsOfFiscalYear } from "./fiscal";

// 雑多な商品で使い回されているダミーの品番。品名込みで別商品として扱う(lib/purchaseSearch.tsと同じ考え方)。
const DUMMY_PRODUCT_CODE = "77700";

export type StockDetailRow = {
  fiscal_month: string; // 例 "2026-06-01"
  location_code: string;
  product_code: string | null;
  product_name: string | null;
  supplier_code: string | null;
  supplier_name: string | null;
  amount: number;
};

export type StockMonthlyPoint = { ym: string; cur: number; prev: number };

// 仕入先の中の商品1件ぶん(仕入先→商品のドリルダウン用)
export type StockChildRow = {
  key: string;
  name: string;
  cur: number;
  prev: number;
  diff: number;
};

export type StockSupplierRow = {
  key: string;
  name: string;
  cur: number;
  prev: number;
  diff: number;
  curCount: number;
  prevCount: number;
  topProductName: string | null; // その仕入先の中で一番金額の多い商品
  products: StockChildRow[]; // その仕入先の商品一覧(今期金額の多い順)
};

export type StockProductRow = {
  key: string;
  name: string;
  cur: number;
  prev: number;
  diff: number;
  curCount: number;
  prevCount: number;
  topSupplierName: string | null; // その商品の一番の仕入先
};

export type StockDetailData = {
  CUR: number;
  PREV: number;
  cur_months: string[];
  prev_months: string[];
  cur_total: number;
  prev_total: number;
  prev_same: number; // 前期のうち、今期と同じ月数分
  diff_same: number;
  yoy_pct_same: number | null;
  n_cur_months: number;
  monthly: StockMonthlyPoint[];
  suppliers: StockSupplierRow[]; // 今期金額の多い順
  products: StockProductRow[]; // 今期金額の多い順
};

const round = (n: number) => Math.round(n);

function supplierKey(r: StockDetailRow): { key: string; name: string } {
  const code = (r.supplier_code ?? "").trim() || "(不明)";
  const name = (r.supplier_name ?? "").trim() || code;
  return { key: code, name };
}

function productKey(r: StockDetailRow): { key: string; name: string } {
  const code = (r.product_code ?? "").trim() || "(不明)";
  const name = (r.product_name ?? "").trim() || code;
  const key = code === DUMMY_PRODUCT_CODE ? `${code}__${name}` : code;
  return { key, name };
}

type OuterAcc = {
  name: string;
  cur: number;
  prev: number;
  curCount: number;
  prevCount: number;
  inner: Map<string, { name: string; cur: number; prev: number }>;
};

// outerKeyFn(例:仕入先)で集計しつつ、その中をさらにinnerKeyFn(例:商品)で内訳集計する。
// 「仕入先ごとの商品一覧」「商品ごとの主な仕入先」の両方をこの1つの関数で作る。
function buildNested(
  curRows: StockDetailRow[],
  prevRows: StockDetailRow[],
  outerKeyFn: (r: StockDetailRow) => { key: string; name: string },
  innerKeyFn: (r: StockDetailRow) => { key: string; name: string }
): Map<string, OuterAcc> {
  const map = new Map<string, OuterAcc>();

  const add = (r: StockDetailRow, which: "cur" | "prev") => {
    const outer = outerKeyFn(r);
    const inner = innerKeyFn(r);
    let acc = map.get(outer.key);
    if (!acc) {
      acc = { name: outer.name, cur: 0, prev: 0, curCount: 0, prevCount: 0, inner: new Map() };
      map.set(outer.key, acc);
    }
    if (which === "cur") {
      acc.cur += r.amount;
      acc.curCount += 1;
    } else {
      acc.prev += r.amount;
      acc.prevCount += 1;
    }
    let innerAcc = acc.inner.get(inner.key);
    if (!innerAcc) {
      innerAcc = { name: inner.name, cur: 0, prev: 0 };
      acc.inner.set(inner.key, innerAcc);
    }
    if (which === "cur") innerAcc.cur += r.amount;
    else innerAcc.prev += r.amount;
  };

  for (const r of curRows) add(r, "cur");
  for (const r of prevRows) add(r, "prev");

  return map;
}

// 内訳(inner)の中で一番「今期金額」が多いものの名前を返す。今期が全て0なら前期金額で代用。
function topInnerName(inner: Map<string, { name: string; cur: number; prev: number }>): string | null {
  let best: { name: string; cur: number; prev: number } | null = null;
  for (const v of inner.values()) {
    if (!best) {
      best = v;
      continue;
    }
    if (v.cur !== best.cur) {
      if (v.cur > best.cur) best = v;
    } else if (v.prev > best.prev) {
      best = v;
    }
  }
  return best ? best.name : null;
}

export function buildStockDetail(rows: StockDetailRow[], CUR: number, PREV: number): StockDetailData {
  const withYm = rows.map((r) => ({ ...r, ym: ymFromDate(r.fiscal_month) }));

  const cur_months = monthsOfFiscalYear(CUR);
  const prev_months = monthsOfFiscalYear(PREV);

  const curRows = withYm.filter((r) => fiscalYearOf(r.ym) === CUR);
  const prevRows = withYm.filter((r) => fiscalYearOf(r.ym) === PREV);

  const curByIdx = new Map<number, number>();
  let latestIdx = -1;
  for (const r of curRows) {
    const i = periodIndexOf(r.ym);
    curByIdx.set(i, (curByIdx.get(i) ?? 0) + r.amount);
    if (i > latestIdx) latestIdx = i;
  }
  const n_cur_months = latestIdx + 1; // 今期のうち、データがある最初の月度から最新月度までの月数

  const prevByIdx = new Map<number, number>();
  for (const r of prevRows) {
    const i = periodIndexOf(r.ym);
    prevByIdx.set(i, (prevByIdx.get(i) ?? 0) + r.amount);
  }

  const monthly: StockMonthlyPoint[] = cur_months.map((ym, i) => ({
    ym,
    cur: round(curByIdx.get(i) ?? 0),
    prev: round(prevByIdx.get(i) ?? 0),
  }));

  const cur_total = curRows.reduce((a, r) => a + r.amount, 0);
  const prev_total = prevRows.reduce((a, r) => a + r.amount, 0);
  const prev_same = Array.from(prevByIdx.entries())
    .filter(([i]) => i <= latestIdx)
    .reduce((a, [, v]) => a + v, 0);
  const diff_same = cur_total - prev_same;
  const yoy_pct_same = prev_same ? Math.round((cur_total / prev_same - 1) * 1000) / 10 : null;

  // 仕入先別(中に商品の内訳を持つ)
  const supplierMap = buildNested(curRows, prevRows, supplierKey, productKey);
  const suppliers: StockSupplierRow[] = Array.from(supplierMap.entries()).map(([key, acc]) => {
    const products: StockChildRow[] = Array.from(acc.inner.entries())
      .map(([pKey, p]) => ({
        key: pKey,
        name: p.name || pKey,
        cur: round(p.cur),
        prev: round(p.prev),
        diff: round(p.cur - p.prev),
      }))
      .sort((a, b) => b.cur - a.cur);
    return {
      key,
      name: acc.name || key,
      cur: round(acc.cur),
      prev: round(acc.prev),
      diff: round(acc.cur - acc.prev),
      curCount: acc.curCount,
      prevCount: acc.prevCount,
      topProductName: topInnerName(acc.inner),
      products,
    };
  });
  suppliers.sort((a, b) => b.cur - a.cur);

  // 商品別(中に仕入先の内訳を持つ。一番多い仕入先の名前だけ使う)
  const productMap = buildNested(curRows, prevRows, productKey, supplierKey);
  const products: StockProductRow[] = Array.from(productMap.entries()).map(([key, acc]) => ({
    key,
    name: acc.name || key,
    cur: round(acc.cur),
    prev: round(acc.prev),
    diff: round(acc.cur - acc.prev),
    curCount: acc.curCount,
    prevCount: acc.prevCount,
    topSupplierName: topInnerName(acc.inner),
  }));
  products.sort((a, b) => b.cur - a.cur);

  return {
    CUR,
    PREV,
    cur_months,
    prev_months,
    cur_total: round(cur_total),
    prev_total: round(prev_total),
    prev_same: round(prev_same),
    diff_same: round(diff_same),
    yoy_pct_same,
    n_cur_months,
    monthly,
    suppliers,
    products,
  };
}
