// 「仕入未売上一覧」の本体ロジック。
// 仕入(purchases)のうち、納品先が倉庫(拠点コード90・91)のものを対象に、
// 受注番号+受注行番号で売上明細(sales_lines)と突き合わせる。
// 対応する売上明細が見つからない仕入を「未売上」とする。
//
// 本来は受注データ(品番単位の明細)から仕入と結びつけると精度が上がるが、受注データは
// 未導入のため、仕入側にも入っている受注番号・受注行番号で直接突き合わせる
// (lib/purchasesTransform.tsの注記のとおり、この列の実データ検証は未確認)。
//
// 「売値が0円(実績なし含む)の商品は在庫・サンプルの可能性がある」というルールに基づき、
// その商品が売上明細上、一度も0円超で売れたことが無い場合は一覧から除外する
// (受注番号が一致しない=未売上、というだけでは、そもそも売る予定が無い商品まで
// 一覧に混ざってしまうため)。
//
// 注意(2026-09時点): 得意先名に「太幸」を含む(=自社拠点向け)仕入も本来は対象に
// 含めたいが、customer_nameに索引が無くILIKE検索がDBのstatement timeoutを起こすため
// 現時点では対象外にしている(lib/fetchUnsoldPurchases.ts参照)。destinationOf()は
// 将来そちらを対象に含めた際にそのまま使えるよう、得意先名ベースの表示ロジックも残してある。
import { BRANCH_NAMES } from "./branch-names";
import type { UnsoldPurchaseSourceRow, SalesMatchRow } from "./fetchUnsoldPurchases";

// 中央在庫仕入の拠点コード(90=鳴尾在庫, 91=土浦物流)。lib/fetchStockMovement.tsの
// STOCK_LOCATION_CODESと同じ範囲。
export const WAREHOUSE_LOCATION_CODES = ["90", "91"];

export type UnsoldPurchaseRow = {
  purchase_number: string;
  purchase_line: string;
  purchase_date: string | null;
  daysSincePurchase: number | null;
  destinationCode: string; // 絞り込み用のキー(倉庫は拠点コード、拠点向けは得意先名そのもの)
  destinationLabel: string; // 表示名
  product_code: string | null;
  product_name: string | null;
  supplier_name: string | null;
  qty: number | null;
  unit_price: number | null;
  amount: number;
  referenceSellPrice: number; // その商品が売上明細上、過去に売れた最高値(参考・必ず0円超)
};

function destinationOf(row: UnsoldPurchaseSourceRow): { code: string; label: string } {
  if (WAREHOUSE_LOCATION_CODES.includes(row.location_code)) {
    return { code: row.location_code, label: BRANCH_NAMES[row.location_code] ?? row.location_code };
  }
  const name = (row.customer_name ?? "").trim();
  return { code: name || row.location_code, label: name || `拠点不明(${row.location_code})` };
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

export function buildUnsoldPurchases(
  purchaseRows: UnsoldPurchaseSourceRow[],
  salesRows: SalesMatchRow[],
  today: string
): UnsoldPurchaseRow[] {
  const soldKeys = new Set<string>();
  const maxSellPriceByProduct = new Map<string, number>();

  for (const s of salesRows) {
    if (s.order_no && s.order_line) {
      soldKeys.add(`${s.order_no}|${s.order_line}`);
    }
    const code = (s.item_code ?? "").trim();
    if (code && s.sell_price !== null && s.sell_price > 0) {
      const cur = maxSellPriceByProduct.get(code);
      if (cur === undefined || s.sell_price > cur) maxSellPriceByProduct.set(code, s.sell_price);
    }
  }

  const rows: UnsoldPurchaseRow[] = [];
  for (const p of purchaseRows) {
    // 受注番号+受注行番号が売上明細側に見つかれば、既に売上済みとみなして対象外にする。
    const key = p.order_no && p.order_line ? `${p.order_no}|${p.order_line}` : null;
    if (key && soldKeys.has(key)) continue;

    // その商品が売上明細上、一度も0円超で売れたことが無ければ、在庫・サンプル用途の
    // 可能性が高いため一覧から除外する。
    const productCode = (p.product_code ?? "").trim();
    const referenceSellPrice = productCode ? maxSellPriceByProduct.get(productCode) : undefined;
    if (referenceSellPrice === undefined) continue;

    const { code: destinationCode, label: destinationLabel } = destinationOf(p);
    rows.push({
      purchase_number: p.purchase_number,
      purchase_line: p.purchase_line,
      purchase_date: p.purchase_date,
      daysSincePurchase: p.purchase_date ? daysBetween(p.purchase_date, today) : null,
      destinationCode,
      destinationLabel,
      product_code: p.product_code,
      product_name: p.product_name,
      supplier_name: p.supplier_name,
      qty: p.qty,
      unit_price: p.unit_price,
      amount: p.amount,
      referenceSellPrice,
    });
  }

  rows.sort((a, b) => b.amount - a.amount);
  return rows;
}
