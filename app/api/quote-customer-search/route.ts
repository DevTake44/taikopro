import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// 見積書・請求書の得意先選択用。customer_masterを得意先コード・得意先名で検索する。
// branch(拠点)・rep(担当)を指定すると、その拠点・担当の実績(v_customer_branch_rep_map、
// sales_linesベース)がある得意先だけに絞り込む。queryが空でもbranch/repだけで一覧表示できる。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("query") ?? "").trim();
  const branch = searchParams.get("branch") || null;
  const rep = searchParams.get("rep") || null;

  const supabase = getSupabaseServerClient();

  // 拠点・担当での絞り込みがある場合は、対応表から該当する得意先コードを先に求める。
  let allowedCodes: Set<string> | null = null;
  if (branch || rep) {
    let mapQuery = supabase.from("v_customer_branch_rep_map").select("customer_code, customer_name");
    if (branch) mapQuery = mapQuery.eq("branch_code", branch);
    if (rep) mapQuery = mapQuery.eq("rep_code", rep);
    const { data: mapRows, error: mapError } = await mapQuery.limit(2000);
    if (mapError) return NextResponse.json({ error: mapError.message }, { status: 500 });

    if (!query) {
      // 絞り込み条件だけで一覧表示(文字検索なし)。
      const seen = new Set<string>();
      const rows: { customer_code: string; customer_name: string }[] = [];
      for (const r of mapRows ?? []) {
        const code = r.customer_code as string;
        if (seen.has(code)) continue;
        seen.add(code);
        rows.push({ customer_code: code, customer_name: r.customer_name as string });
      }
      rows.sort((a, b) => a.customer_code.localeCompare(b.customer_code));
      return NextResponse.json({ rows: rows.slice(0, 50) });
    }

    allowedCodes = new Set((mapRows ?? []).map((r) => r.customer_code as string));
    if (allowedCodes.size === 0) return NextResponse.json({ rows: [] });
  }

  if (!query) return NextResponse.json({ rows: [] });

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
      .limit(100),
  ]);
  if (byCode.error) return NextResponse.json({ error: byCode.error.message }, { status: 500 });
  if (byName.error) return NextResponse.json({ error: byName.error.message }, { status: 500 });

  const seen = new Set<string>();
  const rows: { customer_code: string; customer_name: string }[] = [];
  for (const r of [...(byCode.data ?? []), ...(byName.data ?? [])]) {
    if (seen.has(r.customer_code)) continue;
    if (allowedCodes && !allowedCodes.has(r.customer_code)) continue;
    seen.add(r.customer_code);
    rows.push(r);
    if (rows.length >= 30) break;
  }

  return NextResponse.json({ rows });
}
