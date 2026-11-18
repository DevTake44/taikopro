import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { parseSmapsPdf } from "@/lib/smapsPdf";
import { readPdfPages } from "@/lib/pdfText";
import { autoAssign, lineKey, type MasterOrderLine, type MasterPdfItem } from "@/lib/smapsMasterMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SMAPS_CUSTOMER_CODE = "210960444";

type HistoryRow = Omit<MasterOrderLine, "cost_source">;

// SMAPS商品マスタ: 発注書(取引詳細PDF)を読み取り、同じ通番の受注明細(受注データ)と
// 仕入実績を付けて返す。受注行ごとのPDF明細への割り当て案(登録済みならその内容)も返す。
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "PDFファイルが送られていません。" }, { status: 400 });
  }

  let pdf;
  try {
    pdf = parseSmapsPdf(await readPdfPages(new Uint8Array(await file.arrayBuffer())));
  } catch (e) {
    return NextResponse.json({ error: `PDFを読み取れませんでした: ${e instanceof Error ? e.message : String(e)}` }, { status: 400 });
  }
  if (!pdf.tradeNo) {
    return NextResponse.json(
      { error: "取引通番が見つかりませんでした。SMAPSの取引詳細画面(発注書)を印刷したPDFか確認してください。" },
      { status: 400 }
    );
  }
  if (pdf.items.length === 0) {
    return NextResponse.json({ error: "PDFから明細を読み取れませんでした。" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data: hist, error: histErr } = await supabase
      .from("order_history_lines")
      .select("order_no, order_line, order_date, product_code, product_name, spec, qty, unit_price, hand_type, supplier_code, supplier_name, cost")
      .eq("customer_code", SMAPS_CUSTOMER_CODE)
      .eq("customer_po_no", pdf.tradeNo)
      .order("order_no", { ascending: true })
      .limit(1000);
    if (histErr) throw new Error(histErr.message);
    const history = ((hist ?? []) as HistoryRow[]).sort(
      (a, b) => a.order_no.localeCompare(b.order_no) || Number(a.order_line) - Number(b.order_line)
    );

    // 実仕入単価(同じ受注番号・行の仕入の加重平均)
    const orderNos = Array.from(new Set(history.map((h) => h.order_no)));
    const actual = new Map<string, number>();
    if (orderNos.length > 0) {
      const { data: pur, error: purErr } = await supabase
        .from("purchases")
        .select("order_no, order_line, qty, unit_price")
        .in("order_no", orderNos)
        .limit(5000);
      if (purErr) throw new Error(purErr.message);
      const acc = new Map<string, { q: number; a: number; first: number | null }>();
      for (const p of (pur ?? []) as { order_no: string; order_line: string; qty: number | null; unit_price: number | null }[]) {
        const k = `${p.order_no}-${p.order_line}`;
        const cur = acc.get(k) ?? { q: 0, a: 0, first: null };
        const q = Number(p.qty ?? 0);
        const u = p.unit_price == null ? null : Number(p.unit_price);
        cur.q += q;
        cur.a += q * (u ?? 0);
        if (cur.first == null) cur.first = u;
        acc.set(k, cur);
      }
      for (const [k, v] of acc) {
        const price = v.q > 0 ? v.a / v.q : v.first;
        if (price != null) actual.set(k, Math.round(price * 100) / 100);
      }
    }

    const lines: MasterOrderLine[] = history.map((h) => {
      const k = lineKey(h);
      const num = (v: unknown) => (v == null ? null : Number(v));
      const act = actual.get(k);
      return {
        ...h,
        qty: num(h.qty),
        unit_price: num(h.unit_price),
        cost: act != null ? act : num(h.cost),
        cost_source: act != null ? "実仕入" : h.cost != null ? "仮原価" : "",
      };
    });

    const items: MasterPdfItem[] = pdf.items.map((it) => ({
      no: it.no,
      name: it.name.replace(/[\uE000-\uF8FF]/g, "").trim(),
      aeonCode: it.aeonCode,
      model: it.model,
      unitPrice: it.unitPrice,
      qty: it.qty,
      amount: it.amount,
    }));

    const { data: reg, error: regErr } = await supabase
      .from("smaps_product_obs")
      .select("item_no, order_no, order_line, updated_at")
      .eq("trade_no", pdf.tradeNo);
    if (regErr) throw new Error(regErr.message);
    const registered = (reg ?? []) as { item_no: string; order_no: string; order_line: string; updated_at: string }[];

    const proposal = autoAssign(items, lines);
    let assign = proposal.assign;
    if (registered.length > 0) {
      // 登録済みの通番は、登録した時の割り当てを初期値にする
      assign = Object.fromEntries(Object.keys(proposal.assign).map((k) => [k, ""]));
      for (const r of registered) {
        const k = lineKey(r);
        if (k in assign) assign[k] = r.item_no;
      }
    }

    return NextResponse.json({
      tradeNo: pdf.tradeNo,
      store: pdf.store,
      title: pdf.title,
      items,
      lines,
      assign,
      auto: proposal.auto,
      registeredAt: registered.length > 0 ? registered.map((r) => r.updated_at).sort().at(-1) : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `受注データ・仕入データの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }
}
