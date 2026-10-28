import { getSupabaseServerClient } from "./supabaseServer";
import type { CompanyInfo } from "./quoteTypes";

// 拠点ごとにcompany_info行を持てるようにしている(branch_codeで一意)。
// 指定した拠点の行が無ければ、branch_code is null の行(全社共通のフォールバック)を使う。
export async function getCompanyInfo(branchCode?: string | null): Promise<CompanyInfo | null> {
  const supabase = getSupabaseServerClient();
  if (branchCode) {
    const { data } = await supabase.from("company_info").select("*").eq("branch_code", branchCode).maybeSingle();
    if (data) return data as CompanyInfo;
  }
  const { data: fallback } = await supabase.from("company_info").select("*").is("branch_code", null).maybeSingle();
  return fallback as CompanyInfo | null;
}
