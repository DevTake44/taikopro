import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fetchAllPagesConcurrent } from "@/lib/fetchPaged";
import type { JoytecMaster } from "@/lib/joytecOrder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "joytec_product_master";

function clean(r: Partial<JoytecMaster>, now: string) {
  const text = (v: unknown) => {
    const s = v == null ? "" : String(v).replace(/^[\s　]+|[\s　]+$/g, "");
    return s === "" ? null : s;
  };
  const num = (v: unknown) => {
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  return {
    own_code: text(r.own_code),
    product_code: text(r.product_code),
    product_name: text(r.product_name),
    spec: text(r.spec),
    sell_price: num(r.sell_price),
    note: text(r.note),
    ship_location: text(r.ship_location),
    arrange_code: text(r.arrange_code),
    supplier_code: text(r.supplier_code),
    supplier_name: text(r.supplier_name),
    cost: num(r.cost),
    unit: text(r.unit),
    updated_at: now,
  };
}

// GET: ジョイテック商品マスタ一覧
export async function GET() {
  try {
    const supabase = getSupabaseServerClient();
    const rows = await fetchAllPagesConcurrent<JoytecMaster & { updated_at: string }>((from, to) =>
      supabase.from(TABLE).select("*").order("own_code", { ascending: true }).range(from, to)
    );
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// POST { rows, replaceAll? }: 追加・修正(自社コードで上書き)。replaceAll=true は送った内容で丸ごと入れ替え(Excel取込)。
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { rows?: Partial<JoytecMaster>[]; replaceAll?: boolean } | null;
  const now = new Date().toISOString();
  const rows = (body?.rows ?? []).map((r) => clean(r, now)).filter((r) => r.own_code);
  if (rows.length === 0) return NextResponse.json({ error: "登録する商品がありません(自社コードは必須)。" }, { status: 400 });
  if (new Set(rows.map((r) => r.own_code)).size !== rows.length) {
    return NextResponse.json({ error: "同じ自社コードが重複しています。" }, { status: 400 });
  }
  try {
    const supabase = getSupabaseServerClient();
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from(TABLE).upsert(rows.slice(i, i + 500), { onConflict: "own_code" });
      if (error) throw new Error(error.message);
    }
    if (body?.replaceAll) {
      const { error } = await supabase.from(TABLE).delete().lt("updated_at", now);
      if (error) throw new Error(error.message);
      const { count, error: cErr } = await supabase.from(TABLE).select("*", { count: "exact", head: true });
      if (cErr) throw new Error(cErr.message);
      if (count !== rows.length) throw new Error(`登録件数が合いません(送信 ${rows.length} 件・登録 ${count} 件)`);
    }
    return NextResponse.json({ saved: rows.length });
  } catch (e) {
    return NextResponse.json({ error: `保存に失敗しました: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}

// DELETE ?own_code=xxxx
export async function DELETE(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("own_code")?.trim();
  if (!code) return NextResponse.json({ error: "自社コードを指定してください。" }, { status: 400 });
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from(TABLE).delete().eq("own_code", code);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
