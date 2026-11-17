import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fetchAllPagesConcurrent } from "@/lib/fetchPaged";
import { parseSmapsPdf, type PdfPage } from "@/lib/smapsPdf";
import { findCandidates, guessCustomerContact, guessReceiverName, type HistoryLine } from "@/lib/smapsMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SMAPS_CUSTOMER_CODE = "210960444";

async function readPdfPages(data: Uint8Array): Promise<PdfPage[]> {
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

// SMAPSの取引詳細PDFを読み取り、過去の受注(order_history_lines)から明細ごとの候補・
// 同じ取引通番の既存受注・客先担当の推定を付けて返す。
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "PDFファイルが送られていません。" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseSmapsPdf(await readPdfPages(new Uint8Array(await file.arrayBuffer())));
  } catch (e) {
    return NextResponse.json({ error: `PDFを読み取れませんでした: ${e instanceof Error ? e.message : String(e)}` }, { status: 400 });
  }
  if (!parsed.tradeNo) {
    return NextResponse.json(
      { error: "取引通番が見つかりませんでした。SMAPSの取引詳細画面を印刷したPDFか確認してください。" },
      { status: 400 }
    );
  }

  let history: HistoryLine[] = [];
  let historyError: string | null = null;
  try {
    const supabase = getSupabaseServerClient();
    history = await fetchAllPagesConcurrent<HistoryLine>((from, to) =>
      supabase
        .from("order_history_lines")
        .select(
          "order_no, order_line, order_date, customer_po_no, customer_contact, delivery_name1, delivery_name2, product_code, product_name, spec, unit, unit_price, note, hand_type, supplier_code, supplier_name, cost"
        )
        .eq("customer_code", SMAPS_CUSTOMER_CODE)
        .order("order_no", { ascending: true })
        .order("order_line", { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    historyError = e instanceof Error ? e.message : String(e);
  }

  const existingOrderNos = Array.from(
    new Set(history.filter((h) => (h.customer_po_no ?? "") === parsed.tradeNo).map((h) => h.order_no))
  );

  return NextResponse.json({
    pdf: parsed,
    historyCount: history.length,
    historyError,
    existingOrderNos,
    customerContact: guessCustomerContact(parsed.store, parsed.company, history),
    receiverName: guessReceiverName(parsed.store, parsed.receiver, history),
    candidates: parsed.items.map((it) => findCandidates(it, history)),
  });
}
