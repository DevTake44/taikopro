import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// 見積書・請求書の明細行「仕入先」選択用。supplier_master(仕入先コード・仕入先名のみ。
// 支払先コードという別概念はこのテーブルにもCSV取込にも存在しない)を検索する。
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
