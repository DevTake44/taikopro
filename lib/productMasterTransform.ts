// 商品マスタCSVの変換ルールをまとめた場所。
import { normalizeForSearch } from "./textNormalize";

export type ProductMasterRow = {
  product_code: string;
  product_name: string;
  product_kana: string | null;
  product_name_normalized: string;
  primary_supplier_code: string | null;
  primary_supplier_price: number | null;
  secondary_supplier_code: string | null;
  secondary_supplier_price: number | null;
  is_deleted: boolean;
  spec: string | null;
  source_updated_at: string | null; // 基幹システム側の更新年月日(YYYY-MM-DD)。アプリ内部のupdated_atとは別物
  itf_code: string | null; // ITFコード。同じITFコードが複数の品番に付いていれば「同じ商品の別品番」とみなせる
};

function s(v: unknown): string {
  return (v ?? "").toString().trim();
}
function numOrNull(v: unknown): number | null {
  const str = s(v);
  if (str === "" || str === "0") return null;
  const n = Number(str);
  return Number.isNaN(n) ? null : n;
}
function codeOrNull(v: unknown): string | null {
  const str = s(v);
  return str === "" || str === "0" ? null : str;
}

// "20260423" -> "2026-04-23"。空欄・"0"・不正な形式はnull。
function dateOrNull(v: unknown): string | null {
  const str = s(v);
  if (str === "" || str === "0") return null;
  if (/^\d{8}$/.test(str)) return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  return null;
}

// Papa.parse(text, { header: true }) の結果を受け取る想定
export function transformProductMasterCsv(raw: Record<string, string>[]): {
  rows: ProductMasterRow[];
  skipped: string[];
} {
  const skipped: string[] = [];
  // 品番が重複している場合、更新年月日が新しい方を残す(実データで1件確認済み)
  const byCode = new Map<string, { row: Record<string, string>; updatedAt: string }>();

  for (const r of raw) {
    const code = s(r["品番"]);
    if (code === "") {
      skipped.push("品番が空白のため除外");
      continue;
    }
    const updatedAt = s(r["更新年月日"]);
    const existing = byCode.get(code);
    if (!existing || updatedAt > existing.updatedAt) {
      if (existing) skipped.push(`品番重複のため古い方を除外(品番:${code})`);
      byCode.set(code, { row: r, updatedAt });
    } else {
      skipped.push(`品番重複のため古い方を除外(品番:${code})`);
    }
  }

  const rows: ProductMasterRow[] = [];
  for (const { row: r } of byCode.values()) {
    const productName = s(r["品名"]);
    const productKana = s(r["カナ品名"]) || null;
    const spec = s(r["仕様"]);
    rows.push({
      product_code: s(r["品番"]),
      product_name: productName,
      product_kana: productKana,
      // 品名+カナ品名+仕様を連結して正規化: 品名・仕様どちらでも部分一致検索にヒットするように。
      // specはDB上は独立列のまま保持し、product_nameそのものとは結合しない(表示用の連結は画面側で行う)。
      product_name_normalized: normalizeForSearch(`${productName} ${productKana ?? ""} ${spec}`),
      primary_supplier_code: codeOrNull(r["実仕入先"]),
      primary_supplier_price: numOrNull(r["仕入基準単価（バラ）"]),
      secondary_supplier_code: codeOrNull(r["副仕入先"]),
      secondary_supplier_price: numOrNull(r["副仕入単価"]),
      is_deleted: s(r["削除フラグ"]) === "1",
      spec: spec || null,
      source_updated_at: dateOrNull(r["更新年月日"]),
      itf_code: codeOrNull(r["ＩＴＦコード"]),
    });
  }

  return { rows, skipped };
}
