import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fiscalYearQuarterEnds } from "@/lib/period";
import { fetchAllPagesConcurrent } from "@/lib/fetchPaged";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export type SupplierQuarterCell = { amount: number; line_count: number };
export type PurchaseSupplierMatrixRow = {
  supplier_code: string;
  supplier_name: string;
  quarters: SupplierQuarterCell[]; // 4件(第1〜第4四半期)
  total_amount: number;
  total_line_count: number;
  cmp: { quarters: SupplierQuarterCell[]; total_amount: number } | null; // 対比年度(選んでいなければnull)
};

type SupplierQuarterRow = {
  supplier_code: string;
  supplier_name: string | null;
  quarter_end: string;
  total_amount: number;
  line_count: number;
};

// 仕入先別・四半期の仕入額(v_purchase_supplier_quarter)を、指定の会計年度
// (10月始まり、9/20決算)の4四半期ぶんまとめてマトリクス形式で返す。
// 売上ダッシュボードの月別マトリクスと同じ考え方で、対比年度を選ぶとその年度分も
// あわせて返す。検索・並び替えは件数が少ないためブラウザ側で行う。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const yearParam = searchParams.get("year");
  const compareYearParam = searchParams.get("compareYear");

  const year = yearParam ? parseInt(yearParam, 10) : NaN;
  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: "year(会計年度の期首西暦年)を指定してください。" }, { status: 400 });
  }
  const compareYear = compareYearParam ? parseInt(compareYearParam, 10) : null;
  const compareYearValid = compareYear !== null && Number.isFinite(compareYear);

  const quarterEnds = fiscalYearQuarterEnds(year);
  const compareQuarterEnds = compareYearValid ? fiscalYearQuarterEnds(compareYear as number) : null;
  const allQuarterEnds = [...quarterEnds, ...(compareQuarterEnds ?? [])];

  const supabase = getSupabaseServerClient();
  // 表示年度+対比年度の8四半期ぶんで仕入先×四半期の行数が1,000件を超えるため
  // (最大で仕入先数×8件程度)、Data APIのデフォルト上限(1,000件)で切り捨てられ
  // ないようページングして全件取得する(年度一覧と同じ原因で見つかった不具合)。
  let rows: SupplierQuarterRow[];
  try {
    rows = await fetchAllPagesConcurrent<SupplierQuarterRow>((from, to) =>
      supabase
        .from("v_purchase_supplier_quarter")
        .select("supplier_code, supplier_name, quarter_end, total_amount, line_count")
        .in("quarter_end", allQuarterEnds)
        .order("supplier_code", { ascending: true })
        .order("quarter_end", { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const indexByQuarter = new Map(quarterEnds.map((q, i) => [q, i]));
  const cmpIndexByQuarter = compareQuarterEnds ? new Map(compareQuarterEnds.map((q, i) => [q, i])) : null;

  const map = new Map<string, PurchaseSupplierMatrixRow>();
  for (const r of rows) {
    const code = r.supplier_code;
    let row = map.get(code);
    if (!row) {
      row = {
        supplier_code: code,
        supplier_name: r.supplier_name || code,
        quarters: Array.from({ length: 4 }, () => ({ amount: 0, line_count: 0 })),
        total_amount: 0,
        total_line_count: 0,
        cmp: compareQuarterEnds
          ? { quarters: Array.from({ length: 4 }, () => ({ amount: 0, line_count: 0 })), total_amount: 0 }
          : null,
      };
      map.set(code, row);
    }

    const qi = indexByQuarter.get(r.quarter_end);
    if (qi !== undefined) {
      row.quarters[qi] = { amount: Number(r.total_amount), line_count: Number(r.line_count) };
      row.total_amount += Number(r.total_amount);
      row.total_line_count += Number(r.line_count);
      continue;
    }
    const ci = cmpIndexByQuarter?.get(r.quarter_end);
    if (ci !== undefined && row.cmp) {
      row.cmp.quarters[ci] = { amount: Number(r.total_amount), line_count: Number(r.line_count) };
      row.cmp.total_amount += Number(r.total_amount);
    }
  }

  return NextResponse.json({ rows: Array.from(map.values()), quarterEnds, compareQuarterEnds });
}
