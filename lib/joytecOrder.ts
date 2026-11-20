// ジョイテック(ベルク各店)の発注データCSV(setYYYYMMDD.csv)を、販売管理の受注取込CSV用の
// 受注(伝票ごと)に変換する。2025-04作成の「変換用エクセル」と同じ考え方:
// - 得意先コードは 210994171(㈱ジョイテック本部)固定、納入先コード=取引先コード、客先注番=伝票No
// - 自社管理商品コード → ジョイテック商品マスタ(joytec_product_master)で品番・品名・仕様・
//   販売単価・出荷場所・手配・仕入先・原価・単位を当てる(単価はマスタを正とし、発注データと
//   違えば注意を出す)
// - 納入先担当 = 発注時コメント(空なら「店長【納品部門指定無】」)
// - 1134・1135(蛸引・柳刃)の次に 1136「刃付け代」を同じ数量で追加
// - 伝票の最後に運賃(品番99)を1行。仕入先ごとに1回ずつ、在庫品 1,500円・遠藤商事 800円・
//   それ以外 1,500円を足す(原価は 800→700、1,500→1,200)
import type { OrderCsvHeaderInput, OrderCsvLineInput } from "./orderCsvLayout";

export const JOYTEC_CUSTOMER_CODE = "210994171";
export const DEFAULT_CONTACT = "店長【納品部門指定無】";
export const KNIFE_CODES = new Set(["1134", "1135"]);
export const SHARPEN_CODE = "1136";
const ENDO_SUPPLIER = "405400";

export type JoytecMaster = {
  own_code: string;
  product_code: string | null;
  product_name: string | null;
  spec: string | null;
  sell_price: number | null;
  note: string | null;
  ship_location: string | null;
  arrange_code: string | null;
  supplier_code: string | null;
  supplier_name: string | null;
  cost: number | null;
  unit: string | null;
};

export type JoytecSourceRow = {
  storeCode: string;
  storeName: string;
  slipNo: string;
  deliveryDate: string; // YYYY-MM-DD
  slipDate: string;
  ownCode: string;
  itemName: string;
  unitPrice: number | null;
  qty: number;
  unit: string;
  comment: string;
};

// 見出しの［］や全角スペースを外して比べる
function headKey(s: string): string {
  return s.normalize("NFKC").replace(/[\[\]［］\s]/g, "");
}

function ymd(s: string): string {
  const m = (s ?? "").match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

function codeText(s: string): string {
  const t = (s ?? "").normalize("NFKC").trim();
  return /^\d+(\.0+)?$/.test(t) ? String(Math.round(Number(t))) : t;
}

export function parseJoytecCsv(rows: string[][]): JoytecSourceRow[] {
  if (rows.length === 0) throw new Error("CSVが空です。");
  const header = rows[0].map(headKey);
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`「${name}」の列が見つかりません。ジョイテックの発注データCSVか確認してください。`);
    return i;
  };
  const C = {
    store: col("取引先コード"),
    storeName: col("取引先名"),
    slip: col("伝票No"),
    delivery: col("納品日"),
    slipDate: col("伝票日付"),
    own: col("自社管理商品コード"),
    name: col("商品名"),
    price: col("単価"),
    qty: col("数量"),
    unit: col("単位"),
    comment: col("発注時コメント"),
  };
  return rows
    .slice(1)
    .filter((r) => r.some((v) => (v ?? "").trim() !== ""))
    .map((r) => ({
      storeCode: codeText(r[C.store]),
      storeName: (r[C.storeName] ?? "").trim(),
      slipNo: (r[C.slip] ?? "").trim(),
      deliveryDate: ymd(r[C.delivery]),
      slipDate: ymd(r[C.slipDate]),
      ownCode: codeText(r[C.own]),
      itemName: (r[C.name] ?? "").trim(),
      unitPrice: r[C.price] ? Number(r[C.price]) : null,
      qty: Number(r[C.qty] || 0),
      unit: (r[C.unit] ?? "").trim(),
      comment: (r[C.comment] ?? "").trim(),
    }));
}

export type LineWarning = "マスタ未登録" | "単価相違";

export type JoytecLine = OrderCsvLineInput & {
  ownCode: string;
  sourceName: string; // 発注データの商品名(運賃・刃付け代は空)
  sourcePrice: number | null;
  kind: "商品" | "刃付け代" | "運賃";
  warnings: LineWarning[];
};

export type JoytecOrder = {
  slipNo: string;
  storeCode: string;
  storeName: string;
  slipDate: string;
  header: OrderCsvHeaderInput;
  lines: JoytecLine[];
};

export type ConvertOptions = {
  shipDate: string; // YYYY-MM-DD
  arrivalDate: string; // YYYY-MM-DD
  deliveryMethod: string;
  arrivalSpec: string;
  timeSpec: string;
  receiveLocation: string;
};

function arrivalLabel(d: string): string {
  const m = d.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}／${m[2]}着` : "";
}

export function convertJoytec(
  rows: JoytecSourceRow[],
  master: Map<string, JoytecMaster>,
  opt: ConvertOptions
): JoytecOrder[] {
  // 伝票Noの切り替わりで区切る(元CSVは伝票ごとに並んでいる)。念のため同じ伝票Noはまとめる。
  const slips = new Map<string, JoytecSourceRow[]>();
  for (const r of rows) slips.set(r.slipNo, [...(slips.get(r.slipNo) ?? []), r]);

  const common = (): Omit<OrderCsvLineInput, "product_code" | "product_name" | "spec" | "qty" | "unit_price" | "note" | "unit" | "arrange_code" | "supplier_code" | "cost_price" | "ship_location"> => ({
    purchase_note: "",
    department1: "",
    department2: "",
    ship_date: opt.shipDate,
    arrival_date: opt.arrivalDate,
    delivery_method: opt.deliveryMethod,
    arrival_spec: opt.arrivalSpec,
    time_spec: opt.timeSpec,
  });

  const productLine = (own: string, qty: number, src: JoytecSourceRow | null, kind: JoytecLine["kind"]): JoytecLine => {
    const m = master.get(own);
    const warnings: LineWarning[] = [];
    if (!m) warnings.push("マスタ未登録");
    const sellPrice = m?.sell_price ?? null;
    if (src && m && sellPrice != null && src.unitPrice != null && Math.abs(sellPrice - src.unitPrice) >= 0.5) {
      warnings.push("単価相違");
    }
    return {
      ...common(),
      product_code: m?.product_code ?? "",
      product_name: m?.product_name ?? src?.itemName ?? "",
      spec: m?.spec ?? "",
      qty,
      unit_price: sellPrice ?? src?.unitPrice ?? 0,
      note: m?.note ?? "",
      unit: m?.unit ?? "",
      arrange_code: m?.arrange_code ?? "",
      supplier_code: m?.supplier_code ?? "",
      cost_price: m?.cost ?? null,
      ship_location: m?.ship_location ?? "200",
      ownCode: own,
      sourceName: src?.itemName ?? "",
      sourcePrice: src?.unitPrice ?? null,
      kind,
      warnings,
    };
  };

  const orders: JoytecOrder[] = [];
  for (const [slipNo, srcRows] of slips) {
    const first = srcRows[0];
    const lines: JoytecLine[] = [];
    for (const r of srcRows) {
      lines.push(productLine(r.ownCode, r.qty, r, "商品"));
      if (KNIFE_CODES.has(r.ownCode)) lines.push(productLine(SHARPEN_CODE, r.qty, null, "刃付け代"));
    }
    // 運賃: 仕入先ごとに1回
    const seen = new Set<string>();
    let freight = 0;
    let freightCost = 0;
    for (const l of lines) {
      const sup = l.supplier_code ?? "";
      if (seen.has(sup)) continue;
      seen.add(sup);
      const x = l.arrange_code === "0" ? 1500 : sup === ENDO_SUPPLIER ? 800 : 1500;
      freight += x;
      freightCost += x === 800 ? 700 : 1200;
    }
    lines.push({
      ...common(),
      product_code: "99",
      product_name: "運賃",
      spec: "",
      qty: 1,
      unit_price: freight,
      note: "",
      unit: "1",
      arrange_code: "99",
      supplier_code: "2",
      cost_price: freightCost,
      ship_location: "200",
      ownCode: "99",
      sourceName: "",
      sourcePrice: null,
      kind: "運賃",
      warnings: [],
    });
    orders.push({
      slipNo,
      storeCode: first.storeCode,
      storeName: first.storeName,
      slipDate: first.slipDate,
      header: {
        customer_code: JOYTEC_CUSTOMER_CODE,
        delivery_code: first.storeCode,
        delivery_name1: "",
        delivery_name2: "",
        delivery_address1: "",
        delivery_address2: "",
        delivery_postal_code: "",
        delivery_tel: "",
        delivery_contact: first.comment || DEFAULT_CONTACT,
        customer_po_no: slipNo,
        customer_contact: "",
        note: "",
        desired_date: opt.arrivalDate,
        receive_location: opt.receiveLocation,
        subject: "",
        subject_amount: "",
        internal_note: "",
        article1: arrivalLabel(opt.arrivalDate),
      },
      lines,
    });
  }
  return orders;
}

// 変換用エクセルの「商品マスタ」シート(1行目見出し: 自社コード, 品番, 品名, 仕様, 販売単価, 備考,
// 出荷場所, 出荷場所名, 手配区分(名前), 手配区分(コード), 仕入先コード, 仕入先名１, 仕入先名２, 原価, 単位)
// を、joytec_product_master の行にする。品番の無い行(空行)は飛ばす。
type Cell = string | number | boolean | null | undefined;
export function parseJoytecMasterSheet(rows: Cell[][]): { items: JoytecMaster[]; skipped: number } {
  // 品名などの全角文字・全角スペースはそのまま残す(前後の空白だけ取る)。見出しの比較だけNFKCでそろえる。
  const norm = (v: Cell) => (v == null ? "" : String(v).replace(/^[\s\u3000]+|[\s\u3000]+$/g, ""));
  const headNorm = (v: Cell) => norm(v).normalize("NFKC").replace(/\s/g, "");
  const hIdx = rows.findIndex((r) => r.some((c) => headNorm(c) === "自社コード"));
  if (hIdx < 0) throw new Error("「自社コード」の見出しが見つかりません。変換用エクセルの「商品マスタ」シートか確認してください。");
  const h = rows[hIdx].map(headNorm);
  const find = (name: string, nth = 0) => {
    let seen = 0;
    for (let i = 0; i < h.length; i++) if (h[i] === name && seen++ === nth) return i;
    return -1;
  };
  const C = {
    own: find("自社コード"),
    code: find("品番"),
    name: find("品名"),
    spec: find("仕様"),
    price: find("販売単価"),
    note: find("備考"),
    ship: find("出荷場所"),
    arrange: find("手配区分", 1) >= 0 ? find("手配区分", 1) : find("手配区分"),
    sup: find("仕入先コード"),
    supName: find("仕入先名1") >= 0 ? find("仕入先名1") : find("仕入先名"),
    cost: find("原価"),
    unit: find("単位"),
  };
  if (C.own < 0 || C.code < 0) throw new Error("「自社コード」「品番」の列が見つかりません。");
  const txt = (r: Cell[], i: number) => (i < 0 ? null : norm(r[i]) || null);
  const code = (r: Cell[], i: number) => {
    const t = txt(r, i)?.normalize("NFKC").replace(/\s/g, "") || null;
    return t && /^\d+(\.0+)?$/.test(t) ? String(Math.round(Number(t))) : t;
  };
  const num = (r: Cell[], i: number) => {
    const t = txt(r, i);
    if (t == null) return null;
    const n = Number(t.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const items: JoytecMaster[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const r of rows.slice(hIdx + 1)) {
    const own = code(r, C.own);
    const pc = code(r, C.code);
    if (!own || !pc || seen.has(own)) {
      if (own || pc) skipped++;
      continue;
    }
    seen.add(own);
    items.push({
      own_code: own,
      product_code: pc,
      product_name: txt(r, C.name),
      spec: txt(r, C.spec),
      sell_price: num(r, C.price),
      note: code(r, C.note),
      ship_location: code(r, C.ship),
      arrange_code: code(r, C.arrange),
      supplier_code: code(r, C.sup),
      supplier_name: txt(r, C.supName),
      cost: num(r, C.cost),
      unit: code(r, C.unit),
    });
  }
  return { items, skipped };
}
