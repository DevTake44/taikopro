// 「不動在庫チェック」の本体ロジック。
// 商品ごとに、仕入(在庫として仕入れた分)を古い順の「ロット」として並べ、
// rieki-checkの出荷実績(在庫区分の売上)を日付順に消化させていく(先入れ先出し=FIFO)。
// 出荷で消化しきれずに残ったロットが「現在の在庫」で、その中で一番古いロットの仕入日をもとに
// 在庫期間を計算する。最後に出荷されてから365日(1年)以上動きが無い商品を「不動在庫候補」とする。
//
// 重要な制約: 仕入データは2023年9月分から、出荷データ(rieki-check)は2025年9月分からしかない。
// もし出荷データが無い期間の仕入までFIFOの対象に含めてしまうと、「対応する出荷記録が無いだけ」の
// 古い仕入が大量に「今も在庫として残っている」と誤って計算されてしまう(実際は既に出荷済みのはず)。
// そのため、出荷データが存在する一番古い日付より前の仕入は、集計から除外し、参考値として別に表示する。
//
// 在庫回転月数(何ヶ月分の在庫か)の計算について:
// 「月平均の出荷金額」は、出荷実績の売価(sell_price、利益を乗せた値段)ではなく、
// FIFOで実際に消化された仕入ロットの原価(unit_price)を積み上げて計算する。
// 在庫金額の方も仕入原価ベースなので、分子・分母を同じ「原価」の物差しに揃えることで、
// 売価と原価を混ぜて回転月数が実態より短く出てしまう(利益分だけ月平均出荷額が過大になる)ことを防いでいる。

import type { PurchaseLotRow, ShipmentRow } from "./fetchStockMovement";

// 雑多な商品で使い回されているダミーの品番。品名込みで別商品として扱う(lib/buildStockDetail.tsと同じ考え方)。
const DUMMY_PRODUCT_CODE = "77700";
// 商品ではない行(運賃など)。実データ確認済み: product_code="99"は「運賃」。
const EXCLUDED_PRODUCT_CODES = new Set(["99"]);

export const DEAD_STOCK_DAYS = 365; // 不動在庫と判定する経過日数(1年)
const DAYS_PER_MONTH = 30.44; // 月平均出荷金額を計算する際に使う、1ヶ月あたりの日数(365/12)

function itemKey(code: string | null, name: string | null): { key: string; name: string } {
  const c = (code ?? "").trim() || "(不明)";
  const n = (name ?? "").trim() || c;
  const key = c === DUMMY_PRODUCT_CODE ? `${c}__${n}` : c;
  return { key, name: n };
}

type Lot = { date: string; qtyRemaining: number; unitPrice: number };

export type StockMovementItem = {
  key: string;
  name: string;
  qtyOnHand: number; // 現在庫の推定数量(仕入金額÷仕入単価から算出)
  amountOnHand: number; // 現在庫の推定金額
  oldestLotDate: string; // 残っている在庫の中で一番古い仕入日
  ageDays: number; // 今日 - oldestLotDate
  lastShipmentDate: string | null; // 最後にこの商品が出荷された日(在庫区分の売上)
  daysSinceShipment: number | null; // 今日 - lastShipmentDate(出荷実績が無ければnull)
  isDead: boolean; // 不動在庫候補かどうか
};

export type StockMovementData = {
  asOf: string; // 計算基準日(YYYY-MM-DD)
  deadThresholdDays: number;
  dataStartDate: string | null; // 出荷データが存在する一番古い日付(この日以降の仕入だけを集計対象にしている)
  excludedPreRangeAmount: number; // dataStartDateより前の仕入額(出荷記録と対応づけできないため集計対象外・参考値)
  items: StockMovementItem[]; // 在庫が残っている商品のみ。在庫金額が多い順
  totalItemsWithStock: number;
  totalAmountOnHand: number; // 出荷分を引いた、全商品ぶんの推定在庫金額の合計
  deadCount: number;
  deadAmount: number;
  activeAmount: number; // totalAmountOnHand - deadAmount(不動在庫を除いた、動いている在庫の金額)
  unmatchedShipmentQty: number; // 対応する仕入ロットが見つからなかった出荷数量(参考値)
  avgMonthlyShipmentCostAmount: number | null; // 月平均の出荷「原価」金額(売価ではなく、消化された仕入原価ベース)
  turnoverMonthsAll: number | null; // 在庫金額(全体・原価ベース)が、月平均出荷原価の何ヶ月分にあたるか
  turnoverMonthsActive: number | null; // 不動在庫を除いた在庫金額(原価ベース)が、月平均出荷原価の何ヶ月分にあたるか
};

function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

export function buildStockMovement(
  purchaseRows: PurchaseLotRow[],
  shipmentRows: ShipmentRow[],
  today: string // YYYY-MM-DD。呼び出し側(app/page.tsx)で固定して渡す
): StockMovementData {
  // 出荷データが存在する期間(一番古い日〜一番新しい日)を先に調べる
  const shipmentDates = shipmentRows
    .map((r) => r.delivery_date)
    .filter((d): d is string => !!d)
    .sort();
  const dataStartDate = shipmentDates.length > 0 ? shipmentDates[0] : null;
  const dataEndDate = shipmentDates.length > 0 ? shipmentDates[shipmentDates.length - 1] : null;

  // 商品ごとに仕入ロットをまとめ、古い順に並べる。
  // dataStartDateより前の仕入は、対応する出荷記録を確認しようが無いため対象外とする。
  const lotsByKey = new Map<string, { name: string; lots: Lot[] }>();
  let excludedPreRangeAmount = 0;

  for (const r of purchaseRows) {
    if (!r.purchase_date || !r.unit_price) continue;
    const codeRaw = (r.product_code ?? "").trim();
    if (EXCLUDED_PRODUCT_CODES.has(codeRaw)) continue;
    const qty = r.amount / r.unit_price;
    if (!isFinite(qty) || qty === 0) continue;

    if (dataStartDate && r.purchase_date < dataStartDate) {
      excludedPreRangeAmount += r.amount;
      continue;
    }

    const { key, name } = itemKey(r.product_code, r.product_name);
    let acc = lotsByKey.get(key);
    if (!acc) {
      acc = { name, lots: [] };
      lotsByKey.set(key, acc);
    }
    acc.lots.push({ date: r.purchase_date, qtyRemaining: qty, unitPrice: r.unit_price });
  }
  for (const acc of lotsByKey.values()) {
    acc.lots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // 商品ごとに出荷実績をまとめ、古い順に並べる。
  const shipmentsByKey = new Map<string, { name: string; shipments: { date: string; qty: number }[] }>();
  for (const r of shipmentRows) {
    if (!r.delivery_date || !r.qty) continue;
    const { key, name } = itemKey(r.item_code, r.item_name);
    let acc = shipmentsByKey.get(key);
    if (!acc) {
      acc = { name, shipments: [] };
      shipmentsByKey.set(key, acc);
    }
    acc.shipments.push({ date: r.delivery_date, qty: r.qty });
  }
  for (const acc of shipmentsByKey.values()) {
    acc.shipments.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  let unmatchedShipmentQty = 0;
  let matchedShipmentCostAmount = 0; // FIFOで実際に消化された分の仕入原価の合計(月平均出荷原価の算出用)
  const lastShipmentByKey = new Map<string, string>();

  // 出荷を古い順に、対応する商品の仕入ロットから先入れ先出しで消化する
  for (const [key, sAcc] of shipmentsByKey.entries()) {
    const pAcc = lotsByKey.get(key);

    for (const shp of sAcc.shipments) {
      const prevLast = lastShipmentByKey.get(key);
      if (!prevLast || shp.date > prevLast) lastShipmentByKey.set(key, shp.date);

      let remaining = shp.qty;
      if (!pAcc) {
        // この商品には対象期間内の仕入ロットが無い(dataStartDateより前にしか仕入れていない等)
        unmatchedShipmentQty += remaining;
        continue;
      }
      let li = 0;
      while (remaining > 0 && li < pAcc.lots.length) {
        const lot = pAcc.lots[li];
        if (lot.qtyRemaining <= 1e-9) {
          li++;
          continue;
        }
        if (lot.date > shp.date) break; // まだ仕入れていない(未来の)ロットからは消化しない
        const consume = Math.min(remaining, lot.qtyRemaining);
        lot.qtyRemaining -= consume;
        remaining -= consume;
        matchedShipmentCostAmount += consume * lot.unitPrice; // 消化した分の仕入原価を積み上げる
        if (lot.qtyRemaining <= 1e-9) li++;
      }
      if (remaining > 1e-9) unmatchedShipmentQty += remaining;
    }
  }

  const items: StockMovementItem[] = [];
  for (const [key, acc] of lotsByKey.entries()) {
    const remainingLots = acc.lots.filter((l) => l.qtyRemaining > 1e-6);
    if (remainingLots.length === 0) continue; // 在庫が残っていない商品は対象外

    const qtyOnHand = remainingLots.reduce((a, l) => a + l.qtyRemaining, 0);
    const amountOnHand = remainingLots.reduce((a, l) => a + l.qtyRemaining * l.unitPrice, 0);
    const oldestLotDate = remainingLots[0].date; // 既に日付順ソート済みなので先頭が最古
    const ageDays = daysBetween(oldestLotDate, today);
    const lastShipmentDate = lastShipmentByKey.get(key) ?? null;
    const daysSinceShipment = lastShipmentDate ? daysBetween(lastShipmentDate, today) : null;
    const isDead = daysSinceShipment == null ? ageDays >= DEAD_STOCK_DAYS : daysSinceShipment >= DEAD_STOCK_DAYS;

    items.push({
      key,
      name: acc.name,
      qtyOnHand: Math.round(qtyOnHand * 100) / 100,
      amountOnHand: Math.round(amountOnHand),
      oldestLotDate,
      ageDays,
      lastShipmentDate,
      daysSinceShipment,
      isDead,
    });
  }

  items.sort((a, b) => b.amountOnHand - a.amountOnHand);

  const deadItems = items.filter((i) => i.isDead);
  const totalAmountOnHand = Math.round(items.reduce((a, i) => a + i.amountOnHand, 0));
  const deadAmount = Math.round(deadItems.reduce((a, i) => a + i.amountOnHand, 0));
  const activeAmount = totalAmountOnHand - deadAmount;

  // 出荷データの実際の期間(日数)から、月平均の出荷「原価」金額を計算する(売価ではなく原価ベース)
  const shipmentSpanDays = dataStartDate && dataEndDate ? daysBetween(dataStartDate, dataEndDate) + 1 : 0;
  const shipmentSpanMonths = shipmentSpanDays > 0 ? shipmentSpanDays / DAYS_PER_MONTH : 0;
  const avgMonthlyShipmentCostAmount =
    shipmentSpanMonths > 0 ? matchedShipmentCostAmount / shipmentSpanMonths : null;

  const turnoverMonthsAll =
    avgMonthlyShipmentCostAmount && avgMonthlyShipmentCostAmount > 0
      ? Math.round((totalAmountOnHand / avgMonthlyShipmentCostAmount) * 10) / 10
      : null;
  const turnoverMonthsActive =
    avgMonthlyShipmentCostAmount && avgMonthlyShipmentCostAmount > 0
      ? Math.round((activeAmount / avgMonthlyShipmentCostAmount) * 10) / 10
      : null;

  return {
    asOf: today,
    deadThresholdDays: DEAD_STOCK_DAYS,
    dataStartDate,
    excludedPreRangeAmount: Math.round(excludedPreRangeAmount),
    items,
    totalItemsWithStock: items.length,
    totalAmountOnHand,
    deadCount: deadItems.length,
    deadAmount,
    activeAmount,
    unmatchedShipmentQty: Math.round(unmatchedShipmentQty * 100) / 100,
    avgMonthlyShipmentCostAmount:
      avgMonthlyShipmentCostAmount != null ? Math.round(avgMonthlyShipmentCostAmount) : null,
    turnoverMonthsAll,
    turnoverMonthsActive,
  };
}
