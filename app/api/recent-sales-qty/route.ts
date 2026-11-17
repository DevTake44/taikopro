import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { fetchAllPagesConcurrent } from "@/lib/fetchPaged";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CODE_CHUNK = 200;

// 品番ごとの直近Nか月(納品日基準・全拠点)の売上数量合計を返す。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const codes: string[] = Array.isArray(body?.codes)
    ? Array.from(new Set((body.codes as unknown[]).filter((c): c is string => typeof c === "string" && c.trim() !== "")))
    : [];
  const months = typeof body?.months === "number" && body.months > 0 ? body.months : 3;
  if (codes.length === 0) return NextResponse.json({ qtyByCode: {}, since: null });

  const sinceDate = new Date();
  sinceDate.setMonth(sinceDate.getMonth() - months);
  const since = sinceDate.toISOString().slice(0, 10);

  const supabase = getSupabaseServerClient();
  const qtyByCode: Record<string, number> = {};
  try {
    for (let i = 0; i < codes.length; i += CODE_CHUNK) {
      const chunk = codes.slice(i, i + CODE_CHUNK);
      const rows = await fetchAllPagesConcurrent<{ item_code: string; qty: number | string | null }>((from, to) =>
        supabase
          .from("sales_lines")
          .select("item_code, qty")
          .in("item_code", chunk)
          .gte("delivery_date", since)
          .order("id", { ascending: true })
          .range(from, to)
      );
      for (const r of rows) {
        const q = Number(r.qty ?? 0);
        qtyByCode[r.item_code] = (qtyByCode[r.item_code] ?? 0) + (Number.isFinite(q) ? q : 0);
      }
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  return NextResponse.json({ qtyByCode, since });
}
