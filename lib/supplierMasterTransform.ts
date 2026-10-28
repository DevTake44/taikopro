// 仕入先マスタCSVの変換ルールをまとめた場所。
// 2026-10-22: 「支払統括店コード」も取り込むように追加。仕入先マスタには、同じ会社が
// 実務で使う仕入先コードと、支払をまとめる先(支払統括店コード)が自分自身と同じコードに
// なっている「支払先」専用の行の、両方が混在している。実データで確認したところ、
// 支払統括店コード=自分自身 の行はほぼ実際の仕入(purchases)に使われておらず、
// 支払統括店コード≠自分自身 の行がほぼそのまま実際に使われている仕入先コードだった。
// 見積の仕入先検索(v_selectable_suppliers)で、支払先専用の行を除外するために使う。
export type SupplierMasterRow = {
  supplier_code: string;
  supplier_name: string;
  is_deleted: boolean;
  payment_hub_code: string | null;
};

function s(v: unknown): string {
  return (v ?? "").toString().trim();
}

// Papa.parse(text, { header: true }) の結果を受け取る想定
export function transformSupplierMasterCsv(raw: Record<string, string>[]): {
  rows: SupplierMasterRow[];
  skipped: string[];
} {
  const skipped: string[] = [];
  const rows: SupplierMasterRow[] = [];

  for (const r of raw) {
    const code = s(r["仕入先コード"]);
    if (code === "") {
      skipped.push("仕入先コードが空白のため除外");
      continue;
    }
    const upper = s(r["仕入先名上段"]);
    const lower = s(r["仕入先名下段"]);
    const paymentHubCode = s(r["支払統括店コード"]);
    rows.push({
      supplier_code: code,
      supplier_name: lower ? `${upper} ${lower}` : upper,
      is_deleted: s(r["削除フラグ"]) === "9", // このファイルは9=削除(商品マスタの0/1とは別ルール)
      payment_hub_code: paymentHubCode || null,
    });
  }

  return { rows, skipped };
}
