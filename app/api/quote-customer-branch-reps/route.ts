import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export type BranchRepPair = { branch_code: string; rep_code: string | null };

// 見積書・請求書の得意先選択で、拠点プルダウンに応じて担当プルダウンを絞り込むための
// 対応表(実績ベース)。
export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("v_customer_branch_rep_map").select("branch_code, rep_code");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const seen = new Set<string>();
  const pairs: BranchRepPair[] = [];
  for (const r of data ?? []) {
    const key = `${r.branch_code}::${r.rep_code ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ branch_code: r.branch_code as string, rep_code: r.rep_code as string | null });
  }
  return NextResponse.json({ pairs });
}
