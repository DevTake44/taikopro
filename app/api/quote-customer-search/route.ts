import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// 見積書・請求書の得意先選択用。customer_masterを得意先コード・得意先名で検索する。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("query") ?? "").trim();
  if (!query) return NextResponse.json({ rows: [] });

  const supabase = getSupabaseServerClient();

  // .or()にユーザー入力をそのまま埋め込むと、カンマ等でフィルタ構文が壊れうるため、
  // コード完全一致・名称部分一致を別々のクエリにして結果をマージする。
  const [byCode, byName] = await Promise.all([
    supabase.from("customer_master").select("customer_code, customer_name").eq("is_deleted", false).eq("customer_code", query).limit(5),
    supabase
      .from("customer_master")
      .select("customer_code, customer_name")
      .eq("is_deleted", false)
      .ilike("customer_name", `%${query}%`)
      .order("customer_code", { ascending: true })
      .limit(30),
  ]);
  if (byCode.error) return NextResponse.json({ error: byCode.error.message }, { status: 500 });
  if (byName.error) return NextResponse.json({ error: byName.error.message }, { status: 500 });

  const seen = new Set<string>();
  const rows: { customer_code: string; customer_name: string }[] = [];
  for (const r of [...(byCode.data ?? []), ...(byName.data ?? [])]) {
    if (seen.has(r.customer_code)) continue;
    seen.add(r.customer_code);
    rows.push(r);
  }

  return NextResponse.json({ rows });
}
