import { getSupabaseServerClient } from "./supabaseServer";
import type { CompanyInfo } from "./quoteTypes";

export async function getCompanyInfo(): Promise<CompanyInfo | null> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase.from("company_info").select("*").eq("id", 1).maybeSingle();
  return data as CompanyInfo | null;
}
