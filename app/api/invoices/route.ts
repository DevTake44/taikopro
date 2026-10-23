import { NextRequest, NextResponse } from "next/server";
import { listDocuments } from "@/lib/documentCrud";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerQuery = searchParams.get("customer")?.trim() || null;
  const branchCode = searchParams.get("branch")?.trim() || null;
  try {
    const rows = await listDocuments("invoice", { customerQuery, branchCode });
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
