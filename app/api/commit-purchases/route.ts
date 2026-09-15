import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { PURCHASES_CONFLICT_COLUMNS } from "@/lib/uploadRules";
import { purchaseDateFromRaw, type PurchaseRow } from "@/lib/purchasesTransform";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows = body?.rows as PurchaseRow[] | undefined;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "反映するデータがありません。" }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const payload = rows.map((r) => ({
      purchase_number: r.purchase_number,
      purchase_line: r.purchase_line,
      purchase_date: purchaseDateFromRaw(r.purchase_date_raw),
      order_no: r.order_no,
      order_line: r.order_line,
      location_code: r.location_code || null,
      staff_code: r.staff_code || null,
      supplier_code: r.supplier_code || null,
      supplier_name: r.supplier_name || null,
      customer_code: r.customer_code || null,
      customer_name: r.customer_name || null,
      product_code: r.product_code || null,
      product_name: r.product_name || null,
      spec: r.spec || null,
      qty: r.qty,
      unit_price: r.unit_price,
      amount: r.amount,
      updated_at: nowIso,
    }));

    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("purchases")
      .upsert(payload, { onConflict: PURCHASES_CONFLICT_COLUMNS });

    if (error) {
      return NextResponse.json(
        { error: `本番データへの反映中にエラーが発生しました: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, count: rows.length });
  } catch (e) {
    return NextResponse.json(
      { error: "予期しないエラーが発生しました: " + (e instanceof Error ? e.message : String(e)) },
      { status: 500 }
    );
  }
}
