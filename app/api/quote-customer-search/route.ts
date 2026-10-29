import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fetchAllPagesConcurrent } from "@/lib/fetchPaged";
import { toFullWidthForSearch, toHalfWidthForCode } from "@/lib/kana";
import { normalizePhoneDigits } from "@/lib/phone";

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
        .in("customer_code", Array.from(allowedCodes))
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
  //
  // 注意(2026-10-28判明): 以前は件数を1000件に切り詰めていたが、東京(拠点21)が
  // 1,158件と1000件を超えており、切り詰めた分(東急ストアなど)が検索候補から
  // 丸ごと漏れる不具合があった。.in()の配列サイズ自体に1000件のような上限は無い
  // (Data APIの1000行上限は「1回のレスポンスで返る行数」の話で、配列の要素数とは
  // 別物)ため、切り詰めず全件を渡す。
  const codesFilter = allowedCodes ? Array.from(allowedCodes) : null;

  // .or()にユーザー入力をそのまま埋め込むと、カンマ等でフィルタ構文が壊れうるため、
  // コード完全一致・名称部分一致を別々のクエリにして結果をマージする。
  // 名称部分一致は「イオン 岡崎」のように空白区切りで複数語を入力したら、両方を含む
  // 名称だけに絞り込む(検索エンジンのAND検索と同じ考え方)。同じ列に対して.ilike()を
  // 複数回呼ぶと、PostgREST側でAND条件になる。
  //
  // 半角・全角どちらで入力しても検索できるようにする: 得意先名(customer_name)は
  // 数字・カナとも全角のみでデータが入っているため、名称検索は入力を全角化してから
  // 照合する。得意先コード(customer_code)は逆に半角数字のみのため、完全一致検索は
  // 入力を半角化してから照合する。
  const nameTerms = query
    .split(/[\s　]+/)
    .filter(Boolean)
    .map((t) => toFullWidthForSearch(t));

  const SELECT_COLUMNS = "customer_code, customer_name, postal_code, address";
  let byCodeQuery = supabase
    .from("customer_master")
    .select(SELECT_COLUMNS)
    .eq("is_deleted", false)
    .eq("customer_code", toHalfWidthForCode(query))
    .limit(5);
  let byNameQuery = supabase.from("customer_master").select(SELECT_COLUMNS).eq("is_deleted", false);
  for (const term of nameTerms) {
    byNameQuery = byNameQuery.ilike("customer_name", `%${term}%`);
  }
  byNameQuery = byNameQuery.order("customer_code", { ascending: true }).limit(100);
  if (codesFilter) {
    byCodeQuery = byCodeQuery.in("customer_code", codesFilter);
    byNameQuery = byNameQuery.in("customer_code", codesFilter);
  }

  // 得意先マスタに電話番号は無いため、別途登録した電話番号(customer_phone_numbers、
  // コールセンター対応中にその場で登録していく)から該当の得意先コードを探し、
  // それを得意先マスタに引き直して結果に加える。ハイフン等は無視して数字だけで照合する。
  const phoneDigits = normalizePhoneDigits(query);
  async function searchByPhone(): Promise<{ data: CustomerOption[] | null; error: { message: string } | null }> {
    if (phoneDigits.length < 2) return { data: [], error: null };
    const { data: phoneRows, error: phoneError } = await supabase
      .from("customer_phone_numbers")
      .select("customer_code")
      .ilike("phone_number", `%${phoneDigits}%`)
      .limit(50);
    if (phoneError) return { data: null, error: phoneError };
    let codes = Array.from(new Set((phoneRows ?? []).map((r) => r.customer_code as string)));
    if (codesFilter) {
      const allowed = new Set(codesFilter);
      codes = codes.filter((c) => allowed.has(c));
    }
    if (codes.length === 0) return { data: [], error: null };
    return supabase.from("customer_master").select(SELECT_COLUMNS).eq("is_deleted", false).in("customer_code", codes);
  }

  const [byCode, byName, byPhone] = await Promise.all([byCodeQuery, byNameQuery, searchByPhone()]);
  if (byCode.error) return NextResponse.json({ error: byCode.error.message }, { status: 500 });
  if (byName.error) return NextResponse.json({ error: byName.error.message }, { status: 500 });
  if (byPhone.error) return NextResponse.json({ error: byPhone.error.message }, { status: 500 });

  const seen = new Set<string>();
  const rows: CustomerOption[] = [];
  for (const r of [...(byCode.data ?? []), ...(byName.data ?? []), ...(byPhone.data ?? [])] as CustomerOption[]) {
    if (seen.has(r.customer_code)) continue;
    seen.add(r.customer_code);
    rows.push(r);
    if (rows.length >= 30) break;
  }

  return NextResponse.json({ rows });
}
