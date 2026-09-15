// 売上CSVの「整形ルール」を1箇所にまとめた場所。
// ブラウザ(クライアント側)から呼ばれる、環境に依存しない純粋な関数です。

export type SalesRow = {
  target_month_raw: string;
  location_code: string;
  location_name: string;
  staff_code: string;
  staff_name: string;
  customer_code: string;
  customer_name: string;
  sales_amount: number;
};

// Papa.parse(text, { header: false }) の結果(string[][])を受け取る想定
export function transformSalesCsv(allRows: string[][]): {
  rows: SalesRow[];
  skipped: string[];
} {
  if (allRows.length === 0) {
    return { rows: [], skipped: [] };
  }

  // 1行目が「対象年月」のようなヘッダー文字ならスキップ、6桁の数字ならヘッダー無しとみなす
  const firstCell = (allRows[0][0] ?? "").trim();
  const dataRows = /^\d{6}$/.test(firstCell) ? allRows : allRows.slice(1);

  const rows: SalesRow[] = [];
  const skipped: string[] = [];

  for (const r of dataRows) {
    const targetMonthRaw = (r[0] ?? "").trim();
    if (!/^\d{6}$/.test(targetMonthRaw)) {
      skipped.push(`対象年月が不正な行: ${r.slice(0, 3).join(",")}`);
      continue;
    }
    const salesAmount = Number((r[7] ?? "").trim());
    if (Number.isNaN(salesAmount)) {
      skipped.push(`売上金額が数値でない行(得意先:${r[6] ?? ""})`);
      continue;
    }
    rows.push({
      target_month_raw: targetMonthRaw,
      location_code: (r[1] ?? "").trim(),
      location_name: (r[2] ?? "").trim(),
      staff_code: (r[3] ?? "").trim(),
      staff_name: (r[4] ?? "").trim(),
      customer_code: (r[5] ?? "").trim(),
      customer_name: (r[6] ?? "").trim(),
      sales_amount: salesAmount,
    });
  }

  return { rows, skipped };
}
