import iconv from "iconv-lite";

// lib/csvDecode.tsのサーバー版。ブラウザのTextDecoderは'shift_jis'ラベルに対応しているが、
// Node.js(このAPIルートが動く環境)の標準TextDecoderはフルICUが無いと対応していないため、
// iconv-liteで同じ判定・変換をする。
export function decodeCsvBufferServer(buf: Buffer): string {
  const isUtf8Bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  if (isUtf8Bom) {
    return buf.toString("utf-8");
  }
  return iconv.decode(buf, "Shift_JIS");
}
