import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fetchAllPagesConcurrent } from "@/lib/fetchPaged";

export const dynamic = "force-dynamic";

type CustomerOption = {
  customer_code: string;
  customer_name: string;
  postal_code: string | null;
  address: string | null;
};

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
    // v_customer_branch_rep_mapは拠点によって1000行を超えるため、
    // Data APIの1000行上限に引っかからないようページングして全件取得する。
    const mapRows = await fetchAllPagesConcurrent<{ customer_code: string }>((from, to) => {
      let q = supabase.from("v_customer_branch_rep_map").select("customer_code").range(from, to);
      if (branch) q = q.eq("branch_code", branch);
      if (rep) q = q.eq("rep_code", rep);
      return q;
    });

    allowedCodes = new Set(mapRows.map((r) => r.customer_code));
    if (allowedCodes.size === 0) return NextResponse.json({ rows: [] });

    if (!query) {
      // 絞り込み条件だけで一覧表示(文字検索なし)。customer_masterから名称・住所を引く。
      const { data: masterRows, error: masterError } = await supabase
        .from("customer_master")
        .select("customer_code, customer_name, postal_code, address")
        .eq("is_deleted", false)
        .in("customer_code", Array.from(allowedCodes).slice(0, 1000))
        .order("customer_code", { ascending: true })
        .limit(50);
      if (masterError) return NextResponse.json({ error: masterError.message }, { status: 500 });
      return NextResponse.json({ rows: (masterRows ?? []) as CustomerOption[] });
    }
  }

  if (!query) return NextResponse.json({ rows: [] });

  // 拠点・担当で絞り込みがある場合は、名称部分一致(ilike)もその得意先コード一覧に
  // scopeする。customer_nameに検索用インデックスが無く、ilikeは常にcustomer_master
  // 全件(24,000件超)を走査することになるため、絞り込み無しだと拠点を選んでも
  // 速くならない(検索後にJS側で後付けフィルタするだけでは、DB側の走査量が減らない)。
  // .in()でcustomer_code = ANY(array)の形にすると、PKインデックス経由で絞り込んだ
  // 候補だけを調べる計画になり、実測で最大の拠点(約1,300件)でも22ms→5ms程度まで
  // 速くなることを確認した。
  const codesFilter = allowedCodes ? Array.from(allowedCodes).slice(0, 1000) : null;

  // .or()にユーザー入力をそのまま埋め込むと、カンマ等でフィルタ構文が壊れうるため、
  // コード完全一致・名称部分一致を別々のクエリにして結果をマージする。
  const SELECT_COLUMNS = "customer_code, customer_name, postal_code, address";
  let byCodeQuery = supabase.from("customer_master").select(SELECT_COLUMNS).eq("is_deleted", false).eq("customer_code", query).limit(5);
  let byNameQuery = supabase
    .from("customer_master")
    .select(SELECT_COLUMNS)
    .eq("is_deleted", false)
    .ilike("customer_name", `%${query}%`)
    .order("customer_code", { ascending: true })
    .limit(100);
  if (codesFilter) {
    byCodeQuery = byCodeQuery.in("customer_code", codesFilter);
    byNameQuery = byNameQuery.in("customer_code", codesFilter);
  }

  const [byCode, byName] = await Promise.all([byCodeQuery, byNameQuery]);
  if (byCode.error) return NextResponse.json({ error: byCode.error.message }, { status: 500 });
  if (byName.error) return NextResponse.json({ error: byName.error.message }, { status: 500 });

  const seen = new Set<string>();
  const rows: CustomerOption[] = [];
  for (const r of [...(byCode.data ?? []), ...(byName.data ?? [])] as CustomerOption[]) {
    if (seen.has(r.customer_code)) continue;
    seen.add(r.customer_code);
    rows.push(r);
    if (rows.length >= 30) break;
  }

  return NextResponse.json({ rows });
}
