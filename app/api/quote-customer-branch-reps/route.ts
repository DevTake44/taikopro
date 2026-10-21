import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export type BranchRepPair = { branch_code: string; rep_code: string | null };

// 見積書・請求書の得意先選択で、拠点プルダウンに応じて担当プルダウンを絞り込むための
// 対応表(実績ベース)。
export async function GET() {
  const supabase = getSupabaseServerClient();
  // v_customer_branch_rep_map(得意先単位、5000行超)を直接selectすると
  // Data APIの1000行上限に引っかかり拠点が一部しか返らなくなるため、
  // 重複排除済みの軽量ビューを使う。
  const { data, error } = await supabase.from("v_customer_branch_rep_pairs").select("branch_code, rep_code");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pairs: BranchRepPair[] = (data ?? []).map((r) => ({
    branch_code: r.branch_code as string,
    rep_code: r.rep_code as string | null,
  }));
  return NextResponse.json({ pairs });
}
