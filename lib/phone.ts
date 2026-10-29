// 電話番号は登録時・検索時ともハイフン等を無視して数字だけで比較できるようにする。
export function normalizePhoneDigits(input: string): string {
  return input.replace(/[^\d]/g, "");
}
