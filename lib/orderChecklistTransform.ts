// 未売上受注チェック用の受注データCSVの変換ルールをまとめた場所。
// このCSVは、受注チェックリストPDF(担当者がチャット側で解析)から機械的に抽出したもの。
// 受注番号はPDF上「2113-103577」のようにハイフン付きだが、sales_lines.order_noは
// ハイフン無しの数字文字列(実データで確認済み)のため、ここでハイフンを除去して揃える。
export type OrderChecklistRow = {
  target_month: string;
  order_no: string;
  order_date: string; // "YYYY-MM-DD"
  customer_code: string;
  customer_name_ref: string;
  due_date: string; // "YYYY-MM-DD"
  order_amount: number;
  rep_code: string;
  rep_name: string;
};

function s(v: unknown): string {
  return (v ?? "").toString().trim();
}

// "2026/07/01" -> "2026-07-01"
function toIsoDate(v: unknown): string | null {
  const str = s(v);
  const m = str.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// Papa.parse(text, { header: true }) の結果を受け取る想定
export function transformOrderChecklistCsv(raw: Record<string, string>[]): {
  rows: OrderChecklistRow[];
  skipped: string[];
} {
  const skipped: string[] = [];
  const rows: OrderChecklistRow[] = [];

  for (const r of raw) {
    const rawOrderNo = s(r["受注番号"]);
    const orderNo = rawOrderNo.replace(/-/g, "");
    if (orderNo === "") {
      skipped.push("受注番号が空白のため除外");
      continue;
    }
    const orderDate = toIsoDate(r["受注日"]);
    const dueDate = toIsoDate(r["指定納期"]);
    if (!orderDate || !dueDate) {
      skipped.push(`受注日・指定納期の形式が不正なため除外(受注番号:${rawOrderNo})`);
      continue;
    }
    const amountStr = s(r["受注金額合計"]).replace(/,/g, "");
    const amount = Number(amountStr);
    if (amountStr === "" || Number.isNaN(amount)) {
      skipped.push(`受注金額合計が不正なため除外(受注番号:${rawOrderNo})`);
      continue;
    }
    rows.push({
      target_month: s(r["対象年月"]),
      order_no: orderNo,
      order_date: orderDate,
      customer_code: s(r["得意先コード"]),
      customer_name_ref: s(r["得意先名(参考)"]),
      due_date: dueDate,
      order_amount: amount,
      rep_code: s(r["担当者コード"]),
      rep_name: s(r["担当者名"]),
    });
  }

  return { rows, skipped };
}
