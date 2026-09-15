// 仕入価格検索のロジックをまとめた場所。
//
// 統合版での変更点(4章「仕入まわりの新設計」参照): 旧purchases_detail(sales-dashboard)・
// purchase_lines(rieki-check)のどちらでもなく、新設計のpurchasesテーブルを参照する。
// 検索の考え方はrieki-check-app版を踏襲: product_masterに登録があれば、仕入実績が
// まだ無くても「登録はある」という結果を返す(0件=不明、を避けるため)。マスタに無ければ
// purchases側の実績(ダミー品番77700など)から探す。
import { getSupabaseServerClient } from "./supabaseServer";
import { normalizeForSearch } from "./textNormalize";

const DUMMY_PRODUCT_CODE = "77700";
const MAX_MATCHED_PRODUCTS = 20;
const MAX_KEYWORDS = 6;

export type SupplierPriceRow = {
  supplier_code: string | null;
  supplier_name: string | null;
  unit_price: number | null;
  purchase_date: string;
};

export type PurchaseHistoryRow = {
  purchase_date: string;
  supplier_code: string | null;
  supplier_name: string | null;
  unit_price: number | null;
  spec: string | null;
  purchase_number: string;
  purchase_line: string;
  customer_name: string | null;
};

export type MasterInfo = {
  product_name: string;
  product_kana: string | null;
  spec: string | null;
  source_updated_at: string | null;
  is_deleted: boolean;
  primary_supplier_code: string | null;
  primary_supplier_name: string | null;
  primary_supplier_price: number | null;
  secondary_supplier_code: string | null;
  secondary_supplier_name: string | null;
  secondary_supplier_price: number | null;
};

export type ProductSearchResult = {
  product_code: string;
  product_name: string;
  master: MasterInfo | null;
  masterMismatch: string | null;
  latestBySupplier: SupplierPriceRow[];
  history: PurchaseHistoryRow[];
};

export type SearchOutcome = {
  results: ProductSearchResult[];
  truncated: boolean;
};

async function findMatchingProducts(
  mode: "code" | "keyword",
  query: string
): Promise<{ product_code: string; product_name: string }[]> {
  const supabase = getSupabaseServerClient();

  if (mode === "code") {
    const code = query.trim();
    if (code === "") return [];

    // 商品マスタに登録があれば、それを正とする(仕入実績がまだ無くても
    // 「登録されている」という結果を返す。ここで0件にすると「マスタにある商品コード
    // なのに検索結果が不明」という混乱を招くため)。
    const { data: masterRows } = await supabase
      .from("product_master")
      .select("product_code, product_name")
      .eq("product_code", code)
      .limit(1);
    if (masterRows && masterRows.length > 0) return masterRows;

    // マスタに無ければ、仕入実績(purchases)から探す(ダミーコード77700など)。
    const { data: historyRows } = await supabase
      .from("purchases")
      .select("product_code, product_name")
      .eq("product_code", code)
      .not("product_name", "is", null)
      .limit(1);
    if (historyRows && historyRows.length > 0) return historyRows;

    return [];
  }

  // keyword モード: スペース区切りで何語でもAND検索(表記ゆれ吸収済みの列に対して)
  const keywords = query
    .split(/\s+/)
    .map((k) => normalizeForSearch(k))
    .filter((k) => k !== "")
    .slice(0, MAX_KEYWORDS);
  if (keywords.length === 0) return [];

  const seen = new Set<string>();
  const results: { product_code: string; product_name: string }[] = [];

  // ① 商品マスタを、正規化した品名(+カナ品名+仕様)で検索。優先して先に載せる。
  let masterQuery = supabase
    .from("product_master")
    .select("product_code, product_name")
    .eq("is_deleted", false);
  for (const kw of keywords) {
    masterQuery = masterQuery.ilike("product_name_normalized", `%${kw}%`);
  }
  const { data: masterMatches } = await masterQuery.limit(MAX_MATCHED_PRODUCTS + 1);
  for (const row of masterMatches ?? []) {
    const code = row.product_code as string;
    if (seen.has(code)) continue;
    seen.add(code);
    results.push({ product_code: code, product_name: row.product_name as string });
  }

  // ② ダミーコード77700は商品マスタに存在しないため、仕入実績の品名を直接検索する。
  //    77700は色々な雑多な明細で使い回されているので、品名ごとに別商品として扱う。
  if (results.length < MAX_MATCHED_PRODUCTS + 1) {
    const rawKeywords = query
      .split(/\s+/)
      .map((k) => k.trim())
      .filter((k) => k !== "")
      .slice(0, MAX_KEYWORDS);
    let dummyQuery = supabase
      .from("purchases")
      .select("product_name")
      .eq("product_code", DUMMY_PRODUCT_CODE);
    for (const kw of rawKeywords) {
      dummyQuery = dummyQuery.ilike("product_name", `%${kw}%`);
    }
    const { data: dummyRows } = await dummyQuery.limit(2000);
    const dummyNames = Array.from(new Set((dummyRows ?? []).map((r) => r.product_name as string)));
    for (const name of dummyNames) {
      const key = `${DUMMY_PRODUCT_CODE}::${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ product_code: DUMMY_PRODUCT_CODE, product_name: name });
      if (results.length >= MAX_MATCHED_PRODUCTS + 1) break;
    }
  }

  return results;
}

async function fetchHistory(productCode: string, productName?: string): Promise<PurchaseHistoryRow[]> {
  const supabase = getSupabaseServerClient();
  let q = supabase
    .from("purchases")
    .select(
      "purchase_date, supplier_code, supplier_name, unit_price, spec, purchase_number, purchase_line, customer_name"
    )
    .eq("product_code", productCode)
    .order("purchase_date", { ascending: false });

  // 77700は品名込みで絞らないと、無関係な明細まで混ざってしまう
  if (productCode === DUMMY_PRODUCT_CODE && productName) {
    q = q.eq("product_name", productName);
  }

  const { data } = await q;
  return (data ?? []) as PurchaseHistoryRow[];
}

function latestBySupplierFrom(history: PurchaseHistoryRow[]): SupplierPriceRow[] {
  const bySupplier = new Map<string, SupplierPriceRow>();
  for (const row of history) {
    const key = row.supplier_code ?? row.supplier_name;
    if (!key) continue;
    const existing = bySupplier.get(key);
    if (!existing || row.purchase_date > existing.purchase_date) {
      bySupplier.set(key, {
        supplier_code: row.supplier_code,
        supplier_name: row.supplier_name,
        unit_price: row.unit_price,
        purchase_date: row.purchase_date,
      });
    }
  }
  return Array.from(bySupplier.values()).sort((a, b) => {
    if (a.unit_price === null && b.unit_price === null) return 0;
    if (a.unit_price === null) return 1;
    if (b.unit_price === null) return -1;
    return a.unit_price - b.unit_price;
  });
}

type ProductMasterRow = {
  product_code: string;
  product_name: string;
  product_kana: string | null;
  spec: string | null;
  source_updated_at: string | null;
  is_deleted: boolean;
  primary_supplier_code: string | null;
  primary_supplier_price: number | null;
  secondary_supplier_code: string | null;
  secondary_supplier_price: number | null;
};

async function fetchMaster(productCode: string): Promise<MasterInfo | null> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("product_master")
    .select(
      "product_code, product_name, product_kana, spec, source_updated_at, is_deleted, primary_supplier_code, primary_supplier_price, secondary_supplier_code, secondary_supplier_price"
    )
    .eq("product_code", productCode)
    .maybeSingle();
  if (!data) return null;
  const row = data as ProductMasterRow;

  const codes = [row.primary_supplier_code, row.secondary_supplier_code].filter(
    (c): c is string => !!c
  );
  let nameByCode = new Map<string, string>();
  if (codes.length > 0) {
    const { data: suppliers } = await supabase
      .from("supplier_master")
      .select("supplier_code, supplier_name")
      .in("supplier_code", codes);
    nameByCode = new Map((suppliers ?? []).map((s) => [s.supplier_code as string, s.supplier_name as string]));
  }

  return {
    product_name: row.product_name,
    product_kana: row.product_kana,
    spec: row.spec,
    source_updated_at: row.source_updated_at,
    is_deleted: row.is_deleted,
    primary_supplier_code: row.primary_supplier_code,
    primary_supplier_name: row.primary_supplier_code
      ? nameByCode.get(row.primary_supplier_code) ?? null
      : null,
    primary_supplier_price: row.primary_supplier_price,
    secondary_supplier_code: row.secondary_supplier_code,
    secondary_supplier_name: row.secondary_supplier_code
      ? nameByCode.get(row.secondary_supplier_code) ?? null
      : null,
    secondary_supplier_price: row.secondary_supplier_price,
  };
}

// マスタ登録の仕入先(primary_supplier_code)と、実際の最安仕入先(latestBySupplierの
// 先頭=単価が一番安いもの)が一致するか比べる。仕入実績が無い場合や、マスタに仕入先
// 登録が無い場合は判定しない(比べる相手がいないため)。
function computeMasterMismatch(master: MasterInfo | null, latestBySupplier: SupplierPriceRow[]): string | null {
  if (!master || !master.primary_supplier_code) return null;
  if (latestBySupplier.length === 0) return null;
  const cheapest = latestBySupplier[0];
  if (!cheapest.supplier_code) return null;
  if (cheapest.supplier_code === master.primary_supplier_code) return null;
  const masterName = master.primary_supplier_name ?? master.primary_supplier_code;
  const cheapestName = cheapest.supplier_name ?? cheapest.supplier_code;
  return `商品マスタ登録の仕入先は「${masterName}」ですが、実績上いちばん安い仕入先は「${cheapestName}」です。`;
}

export async function searchPurchasePrices(
  mode: "code" | "keyword",
  query: string
): Promise<SearchOutcome> {
  const matches = await findMatchingProducts(mode, query);
  const truncated = matches.length > MAX_MATCHED_PRODUCTS;
  const targets = matches.slice(0, MAX_MATCHED_PRODUCTS);

  const results: ProductSearchResult[] = [];
  for (const m of targets) {
    const history = await fetchHistory(m.product_code, m.product_name);
    const latestBySupplier = latestBySupplierFrom(history);
    const master = await fetchMaster(m.product_code);
    const masterMismatch = computeMasterMismatch(master, latestBySupplier);

    results.push({
      product_code: m.product_code,
      product_name: master?.product_name ?? m.product_name,
      master,
      masterMismatch,
      latestBySupplier,
      history,
    });
  }

  return { results, truncated };
}
