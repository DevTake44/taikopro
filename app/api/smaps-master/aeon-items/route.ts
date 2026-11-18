import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fetchAllPagesConcurrent } from "@/lib/fetchPaged";
import type { AeonItemRow } from "@/lib/smapsAeonItems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: SMAPS登録商品(イオン品番の一覧)
export async function GET() {
  try {
    const supabase = getSupabaseServerClient();
    const rows = await fetchAllPagesConcurrent<Record<string, unknown>>((from, to) =>
      supabase.from("smaps_aeon_items").select("*").order("aeon_code", { ascending: true }).range(from, to)
    );
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

const COLS: (keyof AeonItemRow)[] = [
  "aeon_code", "list_no", "name", "new_price", "current_price", "status", "new_cost", "supplier", "model",
  "maker_code", "size", "color", "note", "components",
];

// POST { fileName, items }: Excelの内容で丸ごと入れ替える(Excelに無くなった品番は消す)。
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { fileName?: string; items?: AeonItemRow[] } | null;
  const items = (body?.items ?? []).filter((r) => r && typeof r.aeon_code === "string" && r.aeon_code.trim() !== "");
  if (items.length === 0) return NextResponse.json({ error: "取り込む品番がありません。" }, { status: 400 });
  if (new Set(items.map((r) => r.aeon_code)).size !== items.length) {
    return NextResponse.json({ error: "同じイオン品番が重複しています。" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();
    const now = new Date().toISOString();
    const clean = items.map((r) => ({
      ...Object.fromEntries(COLS.map((c) => [c, r[c] ?? null])),
      source_file: body?.fileName ?? null,
      updated_at: now,
    }));
    for (let i = 0; i < clean.length; i += 500) {
      const { error } = await supabase.from("smaps_aeon_items").upsert(clean.slice(i, i + 500), { onConflict: "aeon_code" });
      if (error) throw new Error(error.message);
    }
    const { error: delErr } = await supabase.from("smaps_aeon_items").delete().lt("updated_at", now);
    if (delErr) throw new Error(delErr.message);
    const { count, error: cntErr } = await supabase.from("smaps_aeon_items").select("*", { count: "exact", head: true });
    if (cntErr) throw new Error(cntErr.message);
    if (count !== clean.length) throw new Error(`登録件数が合いません(送信 ${clean.length} 件・登録 ${count} 件)`);
    return NextResponse.json({ saved: count });
  } catch (e) {
    return NextResponse.json({ error: `登録に失敗しました: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}
