// ブラウザ内で、CP932(Shift-JIS系)かUTF-8(BOM付き)かを自動判定してデコードする。
// ブラウザのTextDecoderは 'shift_jis' というラベルでCP932相当のデコードに対応しているため、
// サーバー側のような追加ライブラリ(iconv-lite)なしでそのまま使える。
export function decodeCsvBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const isUtf8Bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (isUtf8Bom) {
    return new TextDecoder("utf-8").decode(bytes);
  }
  return new TextDecoder("shift_jis").decode(bytes);
}
