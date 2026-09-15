// 仕入CSVの「除外・補完ルール」を1箇所にまとめた場所。
// ブラウザ(クライアント側)から呼ばれる、環境に依存しない純粋な関数です。
//
// 統合版での変更点(4章「仕入まわりの新設計」参照):
// 旧purchases_detail向けの変換ロジック(伝票消費税行・仕入先コード7の除外、
// 営業担当コード0の補完など)はそのまま踏襲しつつ、新設計のpurchasesテーブル向けに
// 受注番号(order_no)・受注行番号(order_line)の2列を追加で読み込む。
//
// 注意: 受注番号・受注行番号の実際のCSV列見出し名は、元CSV全期間分の実物で
// 未確認(rieki-check-app側は見出し無しの列位置(17列目・18列目)で読んでいたため、
// 見出し名の実例が無かった)。ここでは仕入番号・仕入行番号などの命名規則から
// 「受注番号」「受注行番号」という表記を採用しているが、実際の一括移行(4.3節)の
// 前に、必ず実ファイルのヘッダーと突き合わせて確認すること。

export type PurchaseRow = {
  purchase_number: string;
  purchase_line: string;
  purchase_date_raw: string;
  order_no: string | null;
  order_line: string | null;
  location_code: string;
  staff_code: string;
  customer_code: string;
  customer_name: string;
  amount: number;
  product_code: string;
  product_name: string;
  supplier_code: string;
  supplier_name: string;
  unit_price: number | null;
  qty: number | null;
  spec: string;
};

function s(v: unknown): string {
  return (v ?? "").toString().trim();
}
function sOrNull(v: unknown): string | null {
  const str = s(v);
  return str === "" ? null : str;
}

// Papa.parse(text, { header: true }) の結果(Record<string,string>[])を受け取る想定
export function transformPurchasesCsv(raw: Record<string, string>[]): {
  rows: PurchaseRow[];
  skipped: string[];
} {
  // ① 伝票消費税行・仕入番号空白行を除外
  const afterTaxExclusion = raw.filter((r) => {
    const purchaseNumber = s(r["仕入番号"]);
    const productName = s(r["品名"]);
    return purchaseNumber !== "" && productName !== "伝票消費税";
  });

  // ② 営業担当=0の行を、同じ仕入番号の他行から補完するためのマップを作る
  const staffByPurchaseNumber = new Map<string, string>();
  for (const r of afterTaxExclusion) {
    const pn = s(r["仕入番号"]);
    const staff = s(r["営業担当"]);
    if (staff !== "0" && staff !== "" && !staffByPurchaseNumber.has(pn)) {
      staffByPurchaseNumber.set(pn, staff);
    }
  }

  // ③ 仕入先コード=7、金額空白、重複行を除外しつつ本体を組み立て
  const skipped: string[] = [];
  const seenKeys = new Set<string>();
  const rows: PurchaseRow[] = [];

  for (const r of afterTaxExclusion) {
    const supplierCode = s(r["仕入先コード"]);
    if (supplierCode === "7") {
      skipped.push(`仕入先コード7のため除外(仕入番号:${s(r["仕入番号"])})`);
      continue;
    }

    const amountStr = s(r["金額"]);
    if (amountStr === "") {
      skipped.push(`金額が空白のため除外(仕入番号:${s(r["仕入番号"])})`);
      continue;
    }
    const amount = Number(amountStr);
    if (Number.isNaN(amount)) {
      skipped.push(`金額が数値でないため除外(仕入番号:${s(r["仕入番号"])})`);
      continue;
    }

    const purchaseNumber = s(r["仕入番号"]);
    const purchaseLine = s(r["仕入行番号"]);
    if (purchaseLine === "") {
      skipped.push(`仕入行番号が空白のため除外(仕入番号:${purchaseNumber})`);
      continue;
    }

    const key = `${purchaseNumber}_${purchaseLine}`;
    if (seenKeys.has(key)) {
      skipped.push(`仕入番号+仕入行番号が重複のため除外(${key})`);
      continue;
    }
    seenKeys.add(key);

    let staffCode = s(r["営業担当"]);
    if (staffCode === "0" || staffCode === "") {
      staffCode = staffByPurchaseNumber.get(purchaseNumber) ?? staffCode;
    }

    // 単価・数量は金額と違い、空白/数値でない場合も行自体は除外せず null にする
    const unitPriceStr = s(r["単価"]);
    const unitPriceNum = unitPriceStr === "" ? null : Number(unitPriceStr);
    const unitPrice = unitPriceNum !== null && Number.isNaN(unitPriceNum) ? null : unitPriceNum;

    const qtyStr = s(r["仕入総数量"]);
    const qtyNum = qtyStr === "" ? null : Number(qtyStr);
    const qty = qtyNum !== null && Number.isNaN(qtyNum) ? null : qtyNum;

    rows.push({
      purchase_number: purchaseNumber,
      purchase_line: purchaseLine,
      purchase_date_raw: s(r["仕入年月日"]),
      order_no: sOrNull(r["受注番号"]),
      order_line: sOrNull(r["受注行番号"]),
      location_code: s(r["営業所コード"]),
      staff_code: staffCode,
      customer_code: s(r["得意先コード"]),
      customer_name: s(r["得意先名１"]) || s(r["得意先名1"]),
      amount,
      product_code: s(r["品番"]), // 「入力商品コード」は使わない
      product_name: s(r["品名"]),
      supplier_code: supplierCode,
      supplier_name: s(r["仕入先名１"]) || s(r["仕入先名1"]),
      unit_price: unitPrice,
      qty,
      spec: s(r["仕様"]),
    });
  }

  return { rows, skipped };
}

// "20260423" -> "2026-04-23" 形式に変換(purchase_date_rawから)。空欄・"0"はnull。
export function purchaseDateFromRaw(raw: string): string | null {
  const v = raw.trim();
  if (v === "" || v === "0") return null;
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return null;
}
