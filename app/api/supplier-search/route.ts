import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// 見積書・請求書の明細行「仕入先」選択用。supplier_masterを検索する。
// 仕入先マスタには、同じ会社に複数のコードが登録されており(例: エコー金属株式会社に
// 405300・405390の2つ)、実際の仕入(purchases)・商品マスタの仕入先では常に片方しか
// 使われていない。もう一方は支払先コード等の別目的のコードとみられ、見積の仕入先として
// 選べてしまうと紛らわしいため、実際に使われたことのあるコード(v_active_supplier_codes)
// だけに絞り込む。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("query") ?? "").trim();
  if (!query) return NextResponse.json({ rows: [] });

  const supabase = getSupabaseServerClient();
  const SELECT_COLUMNS = "supplier_code, supplier_name";
  const [byCode, byName] = await Promise.all([
    supabase.from("supplier_master").select(SELECT_COLUMNS).eq("is_deleted", false).eq("supplier_code", query).limit(5),
    supabase
      .from("supplier_master")
      .select(SELECT_COLUMNS)
      .eq("is_deleted", false)
      .ilike("supplier_name", `%${query}%`)
      .order("supplier_code", { ascending: true })
      .limit(100),
  ]);
  if (byCode.error) return NextResponse.json({ error: byCode.error.message }, { status: 500 });
  if (byName.error) return NextResponse.json({ error: byName.error.message }, { status: 500 });

  const seen = new Set<string>();
  const candidates: { supplier_code: string; supplier_name: string }[] = [];
  for (const r of [...(byCode.data ?? []), ...(byName.data ?? [])] as { supplier_code: string; supplier_name: string }[]) {
    if (seen.has(r.supplier_code)) continue;
    seen.add(r.supplier_code);
    candidates.push(r);
  }
  if (candidates.length === 0) return NextResponse.json({ rows: [] });

  const { data: activeRows, error: activeError } = await supabase
    .from("v_active_supplier_codes")
    .select("supplier_code")
    .in(
      "supplier_code",
      candidates.map((c) => c.supplier_code)
    );
  if (activeError) return NextResponse.json({ error: activeError.message }, { status: 500 });
  const activeSet = new Set((activeRows ?? []).map((r) => r.supplier_code as string));

  const rows = candidates.filter((c) => activeSet.has(c.supplier_code)).slice(0, 30);
  return NextResponse.json({ rows });
}
