import { NextRequest, NextResponse } from "next/server";
import iconv from "iconv-lite";
import { buildOrderCsvText, type OrderCsvHeaderInput, type OrderCsvLineInput } from "@/lib/orderCsvLayout";

export const dynamic = "force-dynamic";

// 見積書から、販売管理の「共通CSV取込(受注データ)」用CSVを生成して返す。
// 取込先が旧来のシステムのため、他の取込CSV(decodeCsvBufferServer)と同じCP932
// (Shift-JIS系)で返す。見出し行は必須(資料の注記「ファイルは必ず見出しありで行う」)。
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const header = body?.header as OrderCsvHeaderInput | undefined;
    const lines = body?.lines as OrderCsvLineInput[] | undefined;
    if (!header) {
      return NextResponse.json({ error: "ヘッダー情報がありません。" }, { status: 400 });
    }
    if (!lines || lines.length === 0) {
      return NextResponse.json({ error: "明細がありません。" }, { status: 400 });
    }
    if (!header.customer_code?.trim()) {
      return NextResponse.json({ error: "得意先コードが未設定です。" }, { status: 400 });
    }
    if (!header.customer_po_no?.trim()) {
      return NextResponse.json({ error: "客先注番は必須です。" }, { status: 400 });
    }
    const missingArrange = lines.findIndex((l) => !l.arrange_code);
    if (missingArrange >= 0) {
      return NextResponse.json({ error: `${missingArrange + 1}行目の手配コードが未選択です。` }, { status: 400 });
    }

    const csvText = buildOrderCsvText(header, lines);
    const buf = new Uint8Array(iconv.encode(csvText, "Shift_JIS"));

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "text/csv; charset=Shift_JIS",
        "Content-Disposition": `attachment; filename="order_${Date.now()}.csv"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "予期しないエラーが発生しました: " + message }, { status: 500 });
  }
}
