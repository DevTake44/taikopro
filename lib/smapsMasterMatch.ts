// SMAPS商品マスタ: 発注書(取引詳細PDF)の明細と、同じ通番の受注明細(order_history_lines)を
// 突き合わせ、どの受注行がどのPDF明細(イオン品番)にあたるかを自動で割り当てる。
// 1つのPDF明細に複数の受注行が付く場合(セット商品: 本体・照明・カーテンなど)にも対応する。
import { dice, key } from "./smapsMatch";

export type MasterPdfItem = {
  no: string;
  name: string;
  aeonCode: string;
  model: string;
  unitPrice: number | null;
  qty: number | null;
  amount: number | null;
};

export type MasterOrderLine = {
  order_no: string;
  order_line: string;
  order_date: string | null;
  product_code: string | null;
  product_name: string | null;
  spec: string | null;
  qty: number | null;
  unit_price: number | null;
  hand_type: string | null;
  supplier_code: string | null;
  supplier_name: string | null;
  cost: number | null;
  cost_source: "実仕入" | "仮原価" | "";
};

export const NON_GOODS_CODES = new Set(["99", "88"]);

export function lineKey(l: { order_no: string; order_line: string }): string {
  return `${l.order_no}-${l.order_line}`;
}

function same(a: number | null | undefined, b: number | null | undefined): boolean {
  return a != null && b != null && Math.abs(a - b) < 0.5;
}

function itemAmount(it: MasterPdfItem): number | null {
  if (it.amount != null) return it.amount;
  if (it.unitPrice != null && it.qty != null) return it.unitPrice * it.qty;
  return null;
}

export type AssignResult = {
  // 受注行キー → PDF明細No(割り当て無しは "")
  assign: Record<string, string>;
  // PDF明細No → 自動一致かどうか
  auto: Record<string, boolean>;
};

// 自動割り当て:
// 1. 単価が一致する受注行を1対1で割り当てる(単価50点+品名の似ている度合い×40点+数量10点+型番30点の高い順)。
//    同じ単価の行が1つだけ、または品名・型番が似ていれば「自動一致」。
// 2. 残ったPDF明細が1つだけなら、残りの商品行をすべてその明細に割り当てる(セット商品)。
//    受注行の金額合計(値引行も含めて)がPDFの金額と一致すれば「自動一致」。
// 3. それ以外は割り当てず「要確認」(画面で人が選ぶ)。
export function autoAssign(items: MasterPdfItem[], lines: MasterOrderLine[]): AssignResult {
  const goods = lines.filter((l) => !NON_GOODS_CODES.has(l.product_code ?? ""));
  const discount = lines
    .filter((l) => l.product_code === "88")
    .reduce((s, l) => s + (l.unit_price ?? 0) * (l.qty ?? 0), 0);
  const assign: Record<string, string> = Object.fromEntries(goods.map((l) => [lineKey(l), ""]));
  const auto: Record<string, boolean> = Object.fromEntries(items.map((it) => [it.no, false]));

  type Pair = { it: MasterPdfItem; l: MasterOrderLine; score: number; sim: number; modelHit: boolean };
  const pairs: Pair[] = [];
  for (const it of items) {
    const itemText = key(`${it.name}${it.model}`);
    const model = key(it.model);
    for (const l of goods) {
      if (!same(it.unitPrice, l.unit_price)) continue;
      const lineText = key(`${l.product_name ?? ""}${l.spec ?? ""}`);
      const sim = dice(itemText, lineText);
      const modelHit = model.length >= 3 && lineText.includes(model);
      const score = 50 + sim * 40 + (same(it.qty, l.qty) ? 10 : 0) + (modelHit ? 30 : 0);
      pairs.push({ it, l, score, sim, modelHit });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedItems = new Set<string>();
  for (const p of pairs) {
    const k = lineKey(p.l);
    if (usedItems.has(p.it.no) || assign[k] !== "") continue;
    assign[k] = p.it.no;
    usedItems.add(p.it.no);
    const samePrice = goods.filter((l) => same(l.unit_price, p.it.unitPrice)).length;
    auto[p.it.no] = samePrice === 1 || p.sim >= 0.25 || p.modelHit;
  }

  const restItems = items.filter((it) => !usedItems.has(it.no));
  const restLines = goods.filter((l) => assign[lineKey(l)] === "");
  if (restItems.length === 1 && restLines.length > 0) {
    const it = restItems[0];
    for (const l of restLines) assign[lineKey(l)] = it.no;
    const sum = restLines.reduce((s, l) => s + (l.unit_price ?? 0) * (l.qty ?? 0), 0);
    const amt = itemAmount(it);
    const allLinesUsed = restLines.length === goods.length;
    auto[it.no] =
      (items.length === 1 && goods.length === 1) ||
      same(sum, amt) ||
      (allLinesUsed && same(sum + discount, amt));
  }
  return { assign, auto };
}

export type TradeStatus = "自動一致" | "要確認" | "照合不可";

export function tradeStatus(items: MasterPdfItem[], lines: MasterOrderLine[], r: AssignResult): TradeStatus {
  const goods = lines.filter((l) => !NON_GOODS_CODES.has(l.product_code ?? ""));
  if (goods.length === 0 || items.length === 0) return "照合不可";
  const everyItemAssigned = items.every((it) => Object.values(r.assign).includes(it.no));
  return everyItemAssigned && items.every((it) => r.auto[it.no]) ? "自動一致" : "要確認";
}

// 登録用の1行(smaps_product_obsの列)
export type ObsRow = {
  trade_no: string;
  item_no: string;
  aeon_code: string;
  pdf_name: string;
  pdf_model: string;
  pdf_price: number | null;
  pdf_qty: number | null;
  pdf_amount: number | null;
  store_name: string;
  order_no: string;
  order_line: string;
  order_date: string | null;
  our_code: string | null;
  our_name: string | null;
  spec: string | null;
  qty: number | null;
  supplier_code: string | null;
  supplier_name: string | null;
  hand_type: string | null;
  cost: number | null;
  cost_source: string;
  sell_price: number | null;
};

export function buildObsRows(
  tradeNo: string,
  store: string,
  items: MasterPdfItem[],
  lines: MasterOrderLine[],
  assign: Record<string, string>
): ObsRow[] {
  const byNo = new Map(items.map((it) => [it.no, it]));
  const rows: ObsRow[] = [];
  for (const l of lines) {
    const no = assign[lineKey(l)];
    const it = no ? byNo.get(no) : undefined;
    if (!it) continue;
    rows.push({
      trade_no: tradeNo,
      item_no: it.no,
      aeon_code: it.aeonCode,
      pdf_name: it.name,
      pdf_model: it.model,
      pdf_price: it.unitPrice,
      pdf_qty: it.qty,
      pdf_amount: itemAmount(it),
      store_name: store,
      order_no: l.order_no,
      order_line: l.order_line,
      order_date: l.order_date,
      our_code: l.product_code,
      our_name: l.product_name,
      spec: l.spec,
      qty: l.qty,
      supplier_code: l.supplier_code,
      supplier_name: l.supplier_name,
      hand_type: l.hand_type,
      cost: l.cost,
      cost_source: l.cost_source,
      sell_price: l.unit_price,
    });
  }
  return rows;
}
