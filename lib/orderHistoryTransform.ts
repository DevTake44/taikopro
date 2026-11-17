// 販売管理の「受注出力CSV」(54列・1行目見出し)を、order_history_lines(過去の受注明細)の
// 行に変換する。列位置は受注 仕入先別発注金額(OrderSupplierSummary)と同じ。
// 過去の受注との照合(PDF発注書の取込で品番・仕入先・原価の候補を出す)に使う。

export type OrderHistoryRow = {
  order_no: string;
  order_line: string;
  customer_code: string | null;
  direct_code: string | null;
  delivery_name1: string | null;
  delivery_name2: string | null;
  delivery_address1: string | null;
  delivery_address2: string | null;
  customer_po_no: string | null;
  customer_contact: string | null;
  order_date: string | null;
  delivery_date: string | null;
  branch_code: string | null;
  rep_code: string | null;
  product_code: string | null;
  product_name: string | null;
  spec: string | null;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  amount: number | null;
  note: string | null;
  ship_location_name: string | null;
  subject: string | null;
  hand_type: string | null;
  supplier_code: string | null;
  supplier_name: string | null;
  cost: number | null;
};

const MIN_COLS = 54;

function text(v: string | undefined): string | null {
  const s = (v ?? "").replace(/　/g, " ").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

function num(v: string | undefined): number | null {
  const s = (v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function ymd(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

export function isOrderOutputHeader(header: string[]): boolean {
  return (
    (header[0] ?? "").trim() === "得意先コード" &&
    (header[11] ?? "").trim() === "受注番号" &&
    (header[12] ?? "").trim() === "受注行番号"
  );
}

// 受注番号・行番号が無い行(小計・空行)は捨てる。同じ受注番号+行が重複していれば後勝ち。
export function transformOrderHistoryCsv(allRows: string[][]): { rows: OrderHistoryRow[]; skipped: number } {
  const byKey = new Map<string, OrderHistoryRow>();
  let skipped = 0;
  for (const c of allRows.slice(1)) {
    const orderNo = text(c[11]);
    const line = text(c[12]);
    if (c.length < MIN_COLS || !orderNo || !line) {
      skipped++;
      continue;
    }
    byKey.set(`${orderNo}|${line}`, {
      order_no: orderNo,
      order_line: line,
      customer_code: text(c[0]),
      direct_code: text(c[6]),
      delivery_name1: text(c[7]),
      delivery_name2: text(c[8]),
      delivery_address1: text(c[9]),
      delivery_address2: text(c[10]),
      customer_po_no: text(c[13]),
      customer_contact: text(c[14]),
      order_date: ymd(c[21]),
      delivery_date: ymd(c[22]),
      branch_code: text(c[23]),
      rep_code: text(c[24]),
      product_code: text(c[27]),
      product_name: text(c[29]),
      spec: text(c[30]),
      qty: num(c[34]),
      unit: text(c[38]),
      unit_price: num(c[39]),
      amount: num(c[40]),
      note: text(c[41]),
      ship_location_name: text(c[43]),
      subject: text(c[46]),
      hand_type: text(c[49]),
      supplier_code: text(c[50]),
      supplier_name: text(c[51]),
      cost: num(c[53]),
    });
  }
  return { rows: Array.from(byKey.values()), skipped };
}
