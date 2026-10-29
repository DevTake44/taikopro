import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// コールセンター対応中の問い合わせ内容をその場でメモしておき、別の担当者が次に
// 電話を受けたときも経緯が分かるようにするための小さなテーブル(customer_notes)。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerCodes = (searchParams.get("customer_code") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (customerCodes.length === 0) return NextResponse.json({ error: "customer_codeを指定してください。" }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("customer_notes")
    .select("id, customer_code, note, created_at")
    .in("customer_code", customerCodes)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: NextRequest) {
  let body: { customer_code?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です(JSONではありません)。" }, { status: 400 });
  }
  const customerCode = (body.customer_code ?? "").trim();
  const note = (body.note ?? "").trim();
  if (!customerCode) return NextResponse.json({ error: "customer_codeを指定してください。" }, { status: 400 });
  if (!note) return NextResponse.json({ error: "メモ内容を入力してください。" }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("customer_notes")
    .insert({ customer_code: customerCode, note })
    .select("id, customer_code, note, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "idを指定してください。" }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("customer_notes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
