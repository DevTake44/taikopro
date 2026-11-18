import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fetchAllPagesConcurrent } from "@/lib/fetchPaged";
import type { ObsRow } from "@/lib/smapsMasterMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?view=master  … 現在のマスタ(イオン品番ごとに受注日が最新の発注書の内容)
// GET ?view=history … 登録した全明細
export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get("view") === "history" ? "history" : "master";
  try {
    const supabase = getSupabaseServerClient();
    const rows = await fetchAllPagesConcurrent<Record<string, unknown>>((from, to) =>
      view === "master"
        ? supabase
            .from("v_smaps_product_master")
            .select("*")
            .order("aeon_code", { ascending: true })
            .order("order_line", { ascending: true })
            .range(from, to)
        : supabase
            .from("smaps_product_obs")
            .select("*")
            .order("order_date", { ascending: false, nullsFirst: false })
            .order("trade_no", { ascending: false })
            .order("item_no", { ascending: true })
            .order("order_line", { ascending: true })
            .range(from, to)
    );
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

const COLS: (keyof ObsRow)[] = [
  "trade_no", "item_no", "aeon_code", "pdf_name", "pdf_model", "pdf_price", "pdf_qty", "pdf_amount", "store_name",
  "order_no", "order_line", "order_date", "our_code", "our_name", "spec", "qty", "supplier_code", "supplier_name",
  "hand_type", "cost", "cost_source", "sell_price",
];

// POST { trades: [{ tradeNo, rows: ObsRow[] }] }
// 通番ごとに、送られた内容で置き換える(同じ通番を登録し直すと上書き)。
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { trades?: { tradeNo?: string; rows?: ObsRow[] }[] } | null;
  const trades = body?.trades ?? [];
  if (trades.length === 0) return NextResponse.json({ error: "登録する内容がありません。" }, { status: 400 });

  try {
    const supabase = getSupabaseServerClient();
    let saved = 0;
    for (const t of trades) {
      const tradeNo = String(t.tradeNo ?? "").trim();
      const rows = (t.rows ?? []).filter(
        (r) => r && String(r.trade_no) === tradeNo && r.item_no && r.aeon_code && r.order_no && r.order_line
      );
      if (!tradeNo || rows.length === 0) {
        return NextResponse.json({ error: `通番 ${tradeNo || "(空)"}: 割り当てた受注行がありません。` }, { status: 400 });
      }
      const now = new Date().toISOString();
      const clean = rows.map((r) => ({
        ...Object.fromEntries(COLS.map((c) => [c, r[c] ?? null])),
        updated_at: now,
      }));
      const { error: upErr } = await supabase
        .from("smaps_product_obs")
        .upsert(clean, { onConflict: "trade_no,item_no,order_no,order_line" });
      if (upErr) throw new Error(`通番 ${tradeNo}: ${upErr.message}`);
      // 今回の割り当てに含まれない古い行を消す
      const { error: delErr } = await supabase
        .from("smaps_product_obs")
        .delete()
        .eq("trade_no", tradeNo)
        .lt("updated_at", now);
      if (delErr) throw new Error(`通番 ${tradeNo}: ${delErr.message}`);
      const { count, error: cntErr } = await supabase
        .from("smaps_product_obs")
        .select("*", { count: "exact", head: true })
        .eq("trade_no", tradeNo);
      if (cntErr) throw new Error(`通番 ${tradeNo}: ${cntErr.message}`);
      if (count !== clean.length) throw new Error(`通番 ${tradeNo}: 登録件数が合いません(送信 ${clean.length} 件・登録 ${count} 件)`);
      saved += clean.length;
    }
    return NextResponse.json({ saved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
