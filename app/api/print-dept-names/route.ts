import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("print_dept_names").select("dept_id, display_name");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const mapping: Record<string, string> = {};
  for (const row of data ?? []) {
    mapping[row.dept_id] = row.display_name;
  }
  return NextResponse.json({ mapping });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // userData.csvからの一括登録(複数件まとめてupsert)。
  if (body?.mapping && typeof body.mapping === "object") {
    const entries = Object.entries(body.mapping as Record<string, string>).filter(
      ([deptId, name]) => deptId.trim() && typeof name === "string" && name.trim()
    );
    if (entries.length === 0) {
      return NextResponse.json({ error: "登録するデータがありません。" }, { status: 400 });
    }
    const nowIso = new Date().toISOString();
    const payload = entries.map(([deptId, name]) => ({
      dept_id: deptId.trim(),
      display_name: name.trim(),
      updated_at: nowIso,
    }));
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("print_dept_names").upsert(payload);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, count: payload.length });
  }

  const deptId = typeof body?.dept_id === "string" ? body.dept_id.trim() : "";
  const displayName = typeof body?.display_name === "string" ? body.display_name.trim() : "";
  if (!deptId) {
    return NextResponse.json({ error: "dept_idが必要です。" }, { status: 400 });
  }
  const supabase = getSupabaseServerClient();
  if (!displayName) {
    const { error } = await supabase.from("print_dept_names").delete().eq("dept_id", deptId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }
  const { error } = await supabase
    .from("print_dept_names")
    .upsert({ dept_id: deptId, display_name: displayName, updated_at: new Date().toISOString() });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
