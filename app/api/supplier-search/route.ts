import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// 見積書・請求書の明細行「仕入先」選択用。v_selectable_suppliers(supplier_masterから、
// 支払先専用のコードと実際に使われたことのないコードを除外した一覧)を検索する。
// 仕入先マスタには、同じ会社に複数のコードが登録されている(例: エコー金属株式会社に
// 405300・405390の2つ)。405390のように支払統括店コードが自分自身と同じ行は、実際の
// 仕入では使われない支払先専用のコードであることが実データで確認できたため、
// v_selectable_suppliersではこうした行を除外している。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("query") ?? "").trim();
  if (!query) return NextResponse.json({ rows: [] });

  const supabase = getSupabaseServerClient();
  const SELECT_COLUMNS = "supplier_code, supplier_name";
  const [byCode, byName] = await Promise.all([
    supabase.from("v_selectable_suppliers").select(SELECT_COLUMNS).eq("supplier_code", query).limit(5),
    supabase
      .from("v_selectable_suppliers")
      .select(SELECT_COLUMNS)
      .ilike("supplier_name", `%${query}%`)
      .order("supplier_code", { ascending: true })
      .limit(30),
  ]);
  if (byCode.error) return NextResponse.json({ error: byCode.error.message }, { status: 500 });
  if (byName.error) return NextResponse.json({ error: byName.error.message }, { status: 500 });

  const seen = new Set<string>();
  const rows: { supplier_code: string; supplier_name: string }[] = [];
  for (const r of [...(byCode.data ?? []), ...(byName.data ?? [])] as { supplier_code: string; supplier_name: string }[]) {
    if (seen.has(r.supplier_code)) continue;
    seen.add(r.supplier_code);
    rows.push(r);
    if (rows.length >= 30) break;
  }

  return NextResponse.json({ rows });
}
