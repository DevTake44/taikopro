// 得意先マスタCSVの変換ルールをまとめた場所。
// 締日の値は実データで99(末締め)が最多であることを確認済み。5/10/15/20/25はその日が締め日、
// 0(19件のみ)は締め日不明として扱う(customer_masterにはそのまま数値で保持し、
// 表示側で「締め日不明」等に変換する)。
export type CustomerMasterRow = {
  customer_code: string;
  customer_name: string;
  closing_day: number;
  is_deleted: boolean;
};

function s(v: unknown): string {
  return (v ?? "").toString().trim();
}

// Papa.parse(text, { header: true }) の結果を受け取る想定
export function transformCustomerMasterCsv(raw: Record<string, string>[]): {
  rows: CustomerMasterRow[];
  skipped: string[];
} {
  const skipped: string[] = [];
  const rows: CustomerMasterRow[] = [];

  for (const r of raw) {
    const code = s(r["得意先コード"]);
    if (code === "") {
      skipped.push("得意先コードが空白のため除外");
      continue;
    }
    const upper = s(r["得意先名上段"]);
    const lower = s(r["得意先名下段"]);
    const closingDayStr = s(r["締日"]);
    const closingDay = Number(closingDayStr);
    if (closingDayStr === "" || Number.isNaN(closingDay)) {
      skipped.push(`締日の値が不正なため除外(得意先コード:${code})`);
      continue;
    }
    rows.push({
      customer_code: code,
      customer_name: lower ? `${upper} ${lower}` : upper,
      closing_day: closingDay,
      is_deleted: s(r["削除フラグ"]) === "1",
    });
  }

  return { rows, skipped };
}
