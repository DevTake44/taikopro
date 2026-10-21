import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export type RepBranchPair = { branch_code: string; rep_code: string };

// 「運賃 売上・仕入」画面の担当プルダウンを、選択中の拠点に実在する担当だけに
// 絞り込むための対応表(拠点×担当、実データから作成、94件程度)。
export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("v_freight_rep_branch_map").select("branch_code, rep_code");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pairs: (data ?? []) as RepBranchPair[] });
}
