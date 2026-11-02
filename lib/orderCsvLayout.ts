// 販売管理「共通CSV取込」(受注データ取込)用のレイアウト定義。
// 見積書から受注取込用CSVを作るための、選択肢・列順をここにまとめる。
// 列の意味・必須/任意・選択肢の値は、社内の「受注取込CSVルール」資料(新レイアウト、
// 2026-02-18以降)に基づく。

export const SHIPPING_LOCATION_OPTIONS = [
  { value: "200", label: "直送" },
  { value: "201", label: "入荷先変更" },
];

export const ARRANGE_CODE_OPTIONS = [
  { value: "0", label: "在庫" },
  { value: "10", label: "手配" },
  { value: "80", label: "メーカー直送" },
  { value: "99", label: "商品外" },
];

export const ARRIVAL_SPEC_OPTIONS = [
  { value: "0", label: "無し" },
  { value: "1", label: "必着" },
  { value: "2", label: "指定着" },
];

export const TIME_SPEC_OPTIONS = [
  { value: "0", label: "無し" },
  { value: "1", label: "午前" },
  { value: "2", label: "午後" },
];

export const DELIVERY_METHOD_OPTIONS = [
  { value: "1", label: "西濃" },
  { value: "2", label: "ヤマト" },
  { value: "11", label: "西濃営業所止め" },
  { value: "90", label: "引取" },
  { value: "91", label: "引取配達" },
];

export const UNIT_SUGGESTIONS = ["個", "箱", "本", "式", "枚", "台", "袋", "セット", "m", "kg"];

export type OrderCsvHeaderInput = {
  customer_code: string;
  delivery_code: string;
  delivery_name1: string;
  delivery_name2: string;
  delivery_address1: string;
  delivery_address2: string;
  delivery_postal_code: string;
  delivery_tel: string;
  delivery_contact: string;
  customer_po_no: string;
  customer_contact: string;
  note: string;
  ship_date: string; // YYYY-MM-DD
  desired_date: string; // YYYY-MM-DD
  arrival_date: string; // YYYY-MM-DD
  ship_location: string; // 200|201
  receive_location: string; // 200|201
  delivery_method: string;
  arrival_spec: string; // 0|1|2
  time_spec: string; // 0|1|2
  subject: string;
};

export type OrderCsvLineInput = {
  product_code: string | null;
  product_name: string;
  spec: string | null;
  qty: number;
  unit_price: number;
  note: string | null;
  unit: string;
  arrange_code: string; // 0|10|80|99
  supplier_code: string | null;
  cost_price: number | null;
  department1: string;
  department2: string;
};

// 全角文字数での切り詰め(サロゲートペア文字は1文字として数える簡易実装)。
function truncateZenkaku(s: string, maxChars: number): string {
  return Array.from(s).slice(0, maxChars).join("");
}

function yyyymmdd(dateStr: string): string {
  if (!dateStr) return "";
  return dateStr.replaceAll("-", "");
}

// CSVの1フィールドをダブルクォートで囲む(カンマ・改行・ダブルクォートを含む場合)。
function csvField(v: string | number): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes("\n") || s.includes('"')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

const HEADER_COLUMNS = [
  "得意先コード", "納入先コード", "納入先名称１", "納入先名称２", "納入先住所１", "納入先住所２",
  "納入先郵便番号", "納入先TEL", "納入先担当", "客先注番", "客先担当", "伝票備考",
  "出荷日", "希望納期", "着日", "カタログ", "カタログコード", "品目コード", "定番コード",
  "品名", "仕様", "数量", "単位", "単価", "備考", "発注備考", "出荷場所", "手配コード",
  "仕入先", "仕入単価", "件名コード", "件名", "件名金額", "部門１", "部門２", "申請理由",
  "記事１", "記事２", "記事３", "社内連絡", "着日指定", "時間帯指定", "申請番号", "入荷場所", "配送方法",
];

export function buildOrderCsvRows(header: OrderCsvHeaderInput, lines: OrderCsvLineInput[]): string[][] {
  return lines.map((l) => [
    header.customer_code,
    header.delivery_code,
    truncateZenkaku(header.delivery_name1, 20),
    truncateZenkaku(header.delivery_name2, 20),
    truncateZenkaku(header.delivery_address1, 20),
    truncateZenkaku(header.delivery_address2, 20),
    header.delivery_postal_code,
    header.delivery_tel,
    truncateZenkaku(header.delivery_contact, 15),
    header.customer_po_no,
    truncateZenkaku(header.customer_contact, 8),
    truncateZenkaku(header.note, 20),
    yyyymmdd(header.ship_date),
    yyyymmdd(header.desired_date),
    yyyymmdd(header.arrival_date),
    "", // カタログ
    "", // カタログコード
    l.product_code ?? "",
    "", // 定番コード
    truncateZenkaku(l.product_name ?? "", 20),
    truncateZenkaku(l.spec ?? "", 20),
    String(l.qty ?? 0),
    l.unit ?? "",
    String(l.unit_price ?? 0),
    truncateZenkaku(l.note ?? "", 20),
    "", // 発注備考
    header.ship_location,
    l.arrange_code,
    l.supplier_code ?? "",
    l.cost_price != null ? String(l.cost_price) : "",
    "0", // 件名コード
    truncateZenkaku(header.subject, 50),
    "", // 件名金額
    l.department1 || "",
    l.department2 || "",
    "", // 申請理由
    "", // 記事1
    "", // 記事2
    "", // 記事3
    "", // 社内連絡
    header.arrival_spec,
    header.time_spec,
    "0", // 申請番号
    header.receive_location,
    header.delivery_method,
  ]);
}

export function buildOrderCsvText(header: OrderCsvHeaderInput, lines: OrderCsvLineInput[]): string {
  const rows = [HEADER_COLUMNS, ...buildOrderCsvRows(header, lines)];
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n");
}
