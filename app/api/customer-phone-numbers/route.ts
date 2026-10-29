import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { normalizePhoneDigits } from "@/lib/phone";

export const dynamic = "force-dynamic";

// 得意先マスタには電話番号が無いため、コールセンター対応で分かった電話番号を
// 日々その場で登録していくための小さなテーブル(customer_phone_numbers)。
// 1つの得意先に複数の電話番号(部署・拠点の回線違いなど)を登録できる。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerCodes = (searchParams.get("customer_code") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (customerCodes.length === 0) return NextResponse.json({ error: "customer_codeを指定してください。" }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("customer_phone_numbers")
    .select("id, customer_code, phone_number, created_at")
    .in("customer_code", customerCodes)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: NextRequest) {
  let body: { customer_code?: string; phone_number?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です(JSONではありません)。" }, { status: 400 });
  }
  const customerCode = (body.customer_code ?? "").trim();
  const digits = normalizePhoneDigits(body.phone_number ?? "");
  if (!customerCode) return NextResponse.json({ error: "customer_codeを指定してください。" }, { status: 400 });
  if (digits.length < 2) return NextResponse.json({ error: "電話番号を入力してください。" }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("customer_phone_numbers")
    .insert({ customer_code: customerCode, phone_number: digits })
    .select("id, customer_code, phone_number, created_at")
    .single();
  if (error) {
    // customer_code+phone_numberの一意制約違反(=同じ番号を登録済み)は、エラーではなく
    // 分かりやすいメッセージにする。
    if (error.code === "23505") {
      return NextResponse.json({ error: "この電話番号はすでに登録されています。" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ row: data });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "idを指定してください。" }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("customer_phone_numbers").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
