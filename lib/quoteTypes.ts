// 見積書・請求書システムで共通して使う型。
// quotesとinvoicesはほぼ同じ構造を持つため、画面・計算ロジックを共通化できるよう
// kind("quote"|"invoice")で切り替えて使う。

export type TaxType = "10" | "8" | "0";

export type TaxRounding = "floor" | "ceil" | "round";

export const TAX_ROUNDING_LABEL: Record<TaxRounding, string> = {
  floor: "切り捨て",
  ceil: "切上げ",
  round: "四捨五入",
};

export type DocumentLine = {
  id?: number;
  line_no: number;
  product_code: string | null;
  product_name: string;
  spec: string | null;
  qty: number;
  unit_price: number;
  amount: number;
  tax_type: TaxType;
  note: string | null;
  source: "product" | "sales_history" | "manual";
  // 仕入先マスタ(supplier_master)から選択した仕入先。将来、販売管理の受注CSV取込と
  // 連動させる際に必要なため、品番・品名と同様に明細行へ保存する(表示のみのcost_price等とは違い、
  // こちらは見積データの一部として保存する)。
  supplier_code: string | null;
  supplier_name: string | null;
  // 物件用印刷(表紙=合計、部門ごとに1シート)で明細をグループ分けするための部門名。
  // 自由入力(マスタ化はしない)。未入力の行は「部門未設定」としてまとめて扱う。
  department: string | null;
  // 納品日・取引年月日。インボイス制度上、請求書(適格請求書)には必須の項目。
  // 1枚の請求書に複数回の納品分をまとめて記載することがあるため、書類全体で1つではなく
  // 明細行ごとに持つ(同じ請求書内でも行によって日付が異なり得る)。
  transaction_date: string | null;
};

export type DocumentStatus = "draft" | "confirmed" | "converted";

export type DocumentHeader = {
  id: number;
  // quoteは quote_no、invoiceは invoice_no
  doc_no: string;
  quote_id?: number | null; // invoiceのみ、元になった見積
  // 発行拠点。必須(書類の住所等は、この拠点のcompany_info行を使う)。
  branch_code: string;
  customer_code: string | null;
  customer_name: string;
  customer_postal_code: string | null;
  customer_address: string | null;
  subject: string | null;
  // quoteは quote_date、invoiceは invoice_date
  doc_date: string;
  // quoteは valid_until、invoiceは due_date
  due_or_valid_date: string | null;
  staff_name: string | null;
  status: DocumentStatus;
  subtotal: number;
  tax_10: number;
  tax_8: number;
  tax_exempt_amount: number;
  total: number;
  note: string | null;
  // 消費税額の端数処理方式。書類ごとに選べる(既定は切り捨て)。インボイス制度では
  // 税率ごとに1回だけ端数処理する必要があるため、物件用印刷の部門別シートなど
  // 明細の一部だけを対象にした消費税計算は行わない(表紙の合計でのみ計算する)。
  tax_rounding: TaxRounding;
};

export type DocumentWithLines = DocumentHeader & { lines: DocumentLine[] };

// インボイス制度(適格請求書等保存方式)で請求書に必須とされる項目が揃っているかを
// チェックする。見積書は適格請求書ではないため対象外(呼び出し側でkind==="invoice"の
// 時だけ使う)。不足項目があれば、その説明文の配列を返す(空配列=問題なし)。
export function checkInvoiceCompliance(doc: DocumentWithLines, company: CompanyInfo | null): string[] {
  const errors: string[] = [];
  if (!company) {
    errors.push("発行拠点の自社情報(会社名・住所等)が登録されていません。");
  } else if (!company.invoice_registration_no?.trim()) {
    errors.push("発行拠点の適格請求書発行事業者登録番号が登録されていません。");
  }
  if (!doc.customer_name?.trim()) {
    errors.push("得意先名(書類の宛先)が入力されていません。");
  }
  if (doc.lines.length === 0) {
    errors.push("明細が1行もありません。");
  } else {
    const missing = doc.lines.filter((l) => !l.transaction_date?.trim()).length;
    if (missing > 0) {
      errors.push(`納品日・取引年月日が入力されていない明細行があります(${missing}行)。`);
    }
  }
  return errors;
}

export type CompanyInfo = {
  name: string;
  branch_name: string | null;
  postal_code: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  bank_info: string | null;
  invoice_registration_no: string | null;
};

const ROUND_FN: Record<TaxRounding, (n: number) => number> = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};

// 明細行から、税区分ごとの小計・消費税・合計を計算する。
// 端数処理は行ごとの金額(qty*unit_price)はそのまま、税額だけ税区分合計に対して
// 1円未満の端数処理をする(税区分ごとに1回だけ計算する方式。インボイス制度の
// 「税率ごとに1回」の原則に合わせている)。端数処理方式(切り捨て/切上げ/四捨五入)は
// 書類ごとに選べ、既定は切り捨て。
export function calcTotals(lines: DocumentLine[], rounding: TaxRounding = "floor") {
  const round = ROUND_FN[rounding];
  const byTax: Record<TaxType, number> = { "10": 0, "8": 0, "0": 0 };
  for (const l of lines) {
    byTax[l.tax_type] += l.amount;
  }
  const tax10 = round(byTax["10"] * 0.1);
  const tax8 = round(byTax["8"] * 0.08);
  const subtotal = byTax["10"] + byTax["8"] + byTax["0"];
  const total = subtotal + tax10 + tax8;
  return {
    subtotal,
    tax_10: tax10,
    tax_8: tax8,
    tax_exempt_amount: byTax["0"],
    total,
  };
}
