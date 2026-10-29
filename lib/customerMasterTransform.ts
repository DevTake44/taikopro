import { normalizePhoneDigits } from "@/lib/phone";

// 得意先マスタCSVの変換ルールをまとめた場所。
// 締日の値は実データで99(末締め)が最多であることを確認済み。5/10/15/20/25はその日が締め日、
// 0(19件のみ)は締め日不明として扱う(customer_masterにはそのまま数値で保持し、
// 表示側で「締め日不明」等に変換する)。
// 2026-10-21: 見積書・請求書の得意先住所表示用に、郵便番号・住所(上段+下段１+下段２を
// 連結)も取り込むように追加。
// 2026-10-29: 顧客実績の電話番号検索用に、電話番号(24列目)も取り込むように追加。
// ハイフン等を無視して検索できるよう、customer_phone_numbers(手動登録分)と同じく
// 数字だけに正規化して保存する。
export type CustomerMasterRow = {
  customer_code: string;
  customer_name: string;
  closing_day: number;
  is_deleted: boolean;
  postal_code: string | null;
  address: string | null;
  phone_number: string | null;
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
    const postalCode = s(r["郵便番号"]);
    const addressParts = [s(r["住所上段"]), s(r["住所下段１"]), s(r["住所下段２"])].filter((p) => p !== "");
    const address = addressParts.join("");
    const phoneDigits = normalizePhoneDigits(s(r["電話番号"]));

    rows.push({
      customer_code: code,
      customer_name: lower ? `${upper} ${lower}` : upper,
      closing_day: closingDay,
      is_deleted: s(r["削除フラグ"]) === "1",
      postal_code: postalCode || null,
      address: address || null,
      phone_number: phoneDigits || null,
    });
  }

  return { rows, skipped };
}
