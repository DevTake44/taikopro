// 半角・全角どちらで入力しても検索できるようにするための文字正規化。
// customer_master等の実データを調べたところ、得意先名(customer_name)に出てくる
// 数字・カナは全角のみ(半角は0件)、一方で得意先コード(customer_code)は半角数字のみ
// だった。そのため用途によって正規化の向きを変える:
//   - 名称の部分一致検索 -> 入力を全角化してからilikeする(toFullWidthForSearch)
//   - コードの完全一致検索 -> 入力を半角化してから比較する(toHalfWidthForCode)

const HALF_KANA_MAP: Record<string, string> = {
  ｦ: "ヲ", ｧ: "ァ", ｨ: "ィ", ｩ: "ゥ", ｪ: "ェ", ｫ: "ォ", ｬ: "ャ", ｭ: "ュ", ｮ: "ョ", ｯ: "ッ", ｰ: "ー",
  ｱ: "ア", ｲ: "イ", ｳ: "ウ", ｴ: "エ", ｵ: "オ",
  ｶ: "カ", ｷ: "キ", ｸ: "ク", ｹ: "ケ", ｺ: "コ",
  ｻ: "サ", ｼ: "シ", ｽ: "ス", ｾ: "セ", ｿ: "ソ",
  ﾀ: "タ", ﾁ: "チ", ﾂ: "ツ", ﾃ: "テ", ﾄ: "ト",
  ﾅ: "ナ", ﾆ: "ニ", ﾇ: "ヌ", ﾈ: "ネ", ﾉ: "ノ",
  ﾊ: "ハ", ﾋ: "ヒ", ﾌ: "フ", ﾍ: "ヘ", ﾎ: "ホ",
  ﾏ: "マ", ﾐ: "ミ", ﾑ: "ム", ﾒ: "メ", ﾓ: "モ",
  ﾔ: "ヤ", ﾕ: "ユ", ﾖ: "ヨ",
  ﾗ: "ラ", ﾘ: "リ", ﾙ: "ル", ﾚ: "レ", ﾛ: "ロ",
  ﾜ: "ワ", ﾝ: "ン",
};

// 濁点・半濁点が付く行は、2文字(例: "ｶﾞ")を1文字(例: "ガ")にまとめる必要があるため、
// 先に長い組み合わせから置換する。
const HALF_KANA_DAKUTEN_MAP: Record<string, string> = {
  ｳﾞ: "ヴ",
  ｶﾞ: "ガ", ｷﾞ: "ギ", ｸﾞ: "グ", ｹﾞ: "ゲ", ｺﾞ: "ゴ",
  ｻﾞ: "ザ", ｼﾞ: "ジ", ｽﾞ: "ズ", ｾﾞ: "ゼ", ｿﾞ: "ゾ",
  ﾀﾞ: "ダ", ﾁﾞ: "ヂ", ﾂﾞ: "ヅ", ﾃﾞ: "デ", ﾄﾞ: "ド",
  ﾊﾞ: "バ", ﾋﾞ: "ビ", ﾌﾞ: "ブ", ﾍﾞ: "ベ", ﾎﾞ: "ボ",
  ﾊﾟ: "パ", ﾋﾟ: "ピ", ﾌﾟ: "プ", ﾍﾟ: "ペ", ﾎﾟ: "ポ",
};

// 半角(数字・英字・記号・カナ) -> 全角。得意先名での検索用。
export function toFullWidthForSearch(input: string): string {
  let s = input;
  for (const [half, full] of Object.entries(HALF_KANA_DAKUTEN_MAP)) {
    s = s.split(half).join(full);
  }
  for (const [half, full] of Object.entries(HALF_KANA_MAP)) {
    s = s.split(half).join(full);
  }
  s = s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
  return s;
}

// 全角(数字・英字・記号) -> 半角。得意先コードでの完全一致検索用。
export function toHalfWidthForCode(input: string): string {
  return input.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");
}
