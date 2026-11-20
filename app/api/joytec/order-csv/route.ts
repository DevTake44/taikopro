import { NextRequest, NextResponse } from "next/server";
import iconv from "iconv-lite";
import { buildOrderCsvTextMulti, type OrderCsvHeaderInput, type OrderCsvLineInput } from "@/lib/orderCsvLayout";

export const dynamic = "force-dynamic";

// ジョイテック受注CSV作成: 複数の受注(伝票)をまとめて、受注取込CSV(Shift-JIS)にして返す。
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orders = (body?.orders ?? []) as { header: OrderCsvHeaderInput; lines: OrderCsvLineInput[] }[];
    if (orders.length === 0) return NextResponse.json({ error: "受注がありません。" }, { status: 400 });
    for (const o of orders) {
      if (!o.header?.customer_code?.trim()) {
        return NextResponse.json({ error: "得意先コードが未設定の受注があります。" }, { status: 400 });
      }
      if (!o.lines?.length) return NextResponse.json({ error: `伝票 ${o.header.customer_po_no}: 明細がありません。` }, { status: 400 });
      const bad = o.lines.findIndex((l) => !l.product_code || !l.arrange_code);
      if (bad >= 0) {
        return NextResponse.json(
          { error: `伝票 ${o.header.customer_po_no} の${bad + 1}行目: 品目コードか手配コードが空です(商品マスタを確認してください)。` },
          { status: 400 }
        );
      }
    }
    const buf = new Uint8Array(iconv.encode(buildOrderCsvTextMulti(orders), "Shift_JIS"));
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "text/csv; charset=Shift_JIS",
        "Content-Disposition": `attachment; filename="order_joytec_${Date.now()}.csv"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: "予期しないエラーが発生しました: " + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
