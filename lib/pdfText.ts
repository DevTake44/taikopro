// サーバー側でPDFから文字(位置付き)を取り出す。SMAPS受注取込・SMAPS商品マスタで共通。
import type { PdfPage } from "./smapsPdf";

export async function readPdfPages(data: Uint8Array): Promise<PdfPage[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages: PdfPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push(
      (tc.items as { str?: string; transform?: number[] }[])
        .filter((i) => typeof i.str === "string" && Array.isArray(i.transform))
        .map((i) => ({ str: i.str as string, x: (i.transform as number[])[4], y: (i.transform as number[])[5] }))
    );
  }
  await doc.destroy();
  return pages;
}
