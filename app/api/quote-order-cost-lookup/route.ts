import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

type ResultRow = {
  order_no: string;
  order_line: string;
  unit_price: number;
  supplier_code: string | null;
  supplier_name: string | null;
  purchase_date: string;
};

// 見積書の新規作成画面に遷移した直後に呼ぶ、受注番号+受注行番号でpurchases(仕入実績)を
// 直接ひもづけるためのAPI。品番だけでは「77700」のような複数商品が相乗りする共通コードを
// 特定できないが、受注番号+行番号なら一意に特定できる(経営レポートのv_profit_linesが
// メーカー直送・手配の原価を出す際に使っているのと同じ考え方)。
// 顧客実績の検索(/api/customer-sales-history)自体は速度を優先してこの問い合わせを
// 行わないため、カートに入れた商品をまとめてここで1回だけ問い合わせる。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orderNos = Array.from(
    new Set(
      (searchParams.get("order_nos") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
  if (orderNos.length === 0) return NextResponse.json({ rows: [] });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("purchases")
    .select("order_no, order_line, unit_price, supplier_code, supplier_name, purchase_date")
    .in("order_no", orderNos)
    .order("purchase_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 同じ受注番号+行番号に複数の仕入実績がある場合(分割仕入等)は、直近1件を代表値にする。
  // (purchase_dateの降順で取得済みのため、最初に見つかったものを残せばよい)。
  const seen = new Set<string>();
  const rows: ResultRow[] = [];
  for (const r of data ?? []) {
    const key = `${r.order_no}|${r.order_line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(r as ResultRow);
  }

  return NextResponse.json({ rows });
}
