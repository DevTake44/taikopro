// 見積書・請求書システムで共通して使う型。
// quotesとinvoicesはほぼ同じ構造を持つため、画面・計算ロジックを共通化できるよう
// kind("quote"|"invoice")で切り替えて使う。

export type TaxType = "10" | "8" | "0";

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
};

export type DocumentStatus = "draft" | "confirmed" | "converted";

export type DocumentHeader = {
  id: number;
  // quoteは quote_no、invoiceは invoice_no
  doc_no: string;
  quote_id?: number | null; // invoiceのみ、元になった見積
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
};

export type DocumentWithLines = DocumentHeader & { lines: DocumentLine[] };

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

// 明細行から、税区分ごとの小計・消費税・合計を計算する。
// 端数処理は行ごとの金額(qty*unit_price)はそのまま、税額だけ税区分合計に対して
// 1円未満切り捨てにする(御請求書サンプルと同じ、税区分ごとに1回だけ計算する方式)。
export function calcTotals(lines: DocumentLine[]) {
  const byTax: Record<TaxType, number> = { "10": 0, "8": 0, "0": 0 };
  for (const l of lines) {
    byTax[l.tax_type] += l.amount;
  }
  const tax10 = Math.floor(byTax["10"] * 0.1);
  const tax8 = Math.floor(byTax["8"] * 0.08);
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
