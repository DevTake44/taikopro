import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { SALES_CONFLICT_COLUMNS } from "@/lib/uploadRules";
import type { SalesRow } from "@/lib/salesTransform";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows = body?.rows as SalesRow[] | undefined;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "反映するデータがありません。" }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const payload = rows.map((r) => ({ ...r, updated_at: nowIso }));

    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("sales_monthly")
      .upsert(payload, { onConflict: SALES_CONFLICT_COLUMNS });

    if (error) {
      return NextResponse.json(
        { error: `本番データへの反映中にエラーが発生しました: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, count: rows.length });
  } catch (e) {
    return NextResponse.json(
      { error: "予期しないエラーが発生しました: " + (e instanceof Error ? e.message : String(e)) },
      { status: 500 }
    );
  }
}
