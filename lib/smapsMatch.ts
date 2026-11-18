// SMAPSのPDF明細と、過去の受注明細(order_history_lines)を照合して候補を出す。
import { norm } from "./smapsPdf";

export type HistoryLine = {
  order_no: string;
  order_line: string;
  order_date: string | null;
  customer_po_no: string | null;
  customer_contact: string | null;
  delivery_name1: string | null;
  delivery_name2: string | null;
  product_code: string | null;
  product_name: string | null;
  spec: string | null;
  unit: string | null;
  unit_price: number | null;
  note: string | null;
  hand_type: string | null;
  supplier_code: string | null;
  supplier_name: string | null;
  cost: number | null;
};

export type ItemCandidate = {
  product_code: string;
  product_name: string;
  spec: string;
  unit: string;
  unit_price: number | null;
  note: string;
  hand_type: string;
  supplier_code: string;
  supplier_name: string;
  cost: number | null;
  order_no: string;
  order_date: string;
  customer_po_no: string;
  score: number;
};

// 比較用: 全角半角・大小文字・空白・記号の違いを無視する。
export function key(s: string | null | undefined): string {
  return norm(s ?? "")
    .toLowerCase()
    .replace(/[\s・\-ー－―()【】\[\]/,、.。:*×]/g, "");
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

export function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size);
}

const NON_GOODS = new Set(["99", "88"]);

// 1明細分の候補(同じ品番・品名・仕様・仕入先はまとめ、新しい受注を代表にする)を点数順に返す。
export function findCandidates(
  item: { name: string; model: string; unitPrice: number | null },
  history: HistoryLine[],
  limit = 5
): ItemCandidate[] {
  const itemName = key(item.name);
  const itemModel = key(item.model);
  const best = new Map<string, ItemCandidate>();
  for (const h of history) {
    if (!h.product_code || NON_GOODS.has(h.product_code)) continue;
    const text = key(`${h.product_name ?? ""}${h.spec ?? ""}${h.note ?? ""}`);
    let score = dice(itemName, key(`${h.product_name ?? ""}${h.spec ?? ""}`)) * 100;
    if (itemModel.length >= 3 && text.includes(itemModel)) score += 60;
    if (item.unitPrice != null && h.unit_price != null && Math.abs(h.unit_price - item.unitPrice) < 0.5) score += 15;
    if (score < 25) continue;
    const groupKey = [h.product_code, h.product_name, h.spec, h.supplier_code].join("|");
    const cand: ItemCandidate = {
      product_code: h.product_code,
      product_name: h.product_name ?? "",
      spec: h.spec ?? "",
      unit: h.unit ?? "",
      unit_price: h.unit_price,
      note: h.note ?? "",
      hand_type: h.hand_type ?? "",
      supplier_code: h.supplier_code ?? "",
      supplier_name: h.supplier_name ?? "",
      cost: h.cost,
      order_no: h.order_no,
      order_date: h.order_date ?? "",
      customer_po_no: h.customer_po_no ?? "",
      score: Math.round(score),
    };
    const prev = best.get(groupKey);
    if (!prev || cand.score > prev.score || (cand.score === prev.score && cand.order_date > prev.order_date)) {
      best.set(groupKey, cand);
    }
  }
  return Array.from(best.values())
    .sort((a, b) => b.score - a.score || (a.order_date < b.order_date ? 1 : -1))
    .slice(0, limit);
}

// 同じ店舗の過去受注で使った「○○様」(納入先名称2など)を探す。無ければ受入担当名+様。
export function guessReceiverName(store: string, receiver: string, history: HistoryLine[]): string {
  const storeKey = key(store);
  const hits = history
    .filter((h) => storeKey && key(`${h.delivery_name1 ?? ""}${h.delivery_name2 ?? ""}`).includes(storeKey))
    .sort((a, b) => ((a.order_date ?? "") < (b.order_date ?? "") ? 1 : -1));
  for (const h of hits) {
    for (const v of [h.delivery_name2, h.delivery_name1]) {
      const m = norm(v ?? "").match(/(\S+様)$/);
      if (m && receiver && norm(receiver).replace(/\s/g, "").startsWith(m[1].replace(/様$/, ""))) return m[1];
    }
  }
  return receiver ? `${norm(receiver).replace(/\s/g, "")}様` : "";
}

// 同じ店舗の過去受注から、客先担当(例: イオン琉球)を探す。見つからなければ会社名から作る。
export function guessCustomerContact(store: string, company: string, history: HistoryLine[]): string {
  const storeKey = key(store);
  const hits = history
    .filter((h) => h.customer_contact && storeKey && key(`${h.delivery_name1 ?? ""}${h.delivery_name2 ?? ""}`).includes(storeKey))
    .sort((a, b) => ((a.order_date ?? "") < (b.order_date ?? "") ? 1 : -1));
  if (hits.length > 0) return hits[0].customer_contact ?? "";
  const companyKey = key(company).replace(/株式会社|株/g, "");
  const sameCompany = history.find((h) => h.customer_contact && companyKey && key(h.customer_contact).replace(/株/g, "") === companyKey);
  if (sameCompany) return sameCompany.customer_contact ?? "";
  return norm(company).replace(/株式会社/g, "").trim();
}
