export const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
export const jpn = (n: number) => Math.round(n).toLocaleString("ja-JP");
export const oku = (n: number) => (n / 1e8).toFixed(2) + "億";
export const monL = (ym: string) => `${parseInt(ym.slice(4, 6), 10)}月`;
