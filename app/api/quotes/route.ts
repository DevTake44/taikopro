import { NextRequest, NextResponse } from "next/server";
import { listDocuments, createDocument, type HeaderInput } from "@/lib/documentCrud";
import type { DocumentLine } from "@/lib/quoteTypes";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerQuery = searchParams.get("customer")?.trim() || null;
  const branchCode = searchParams.get("branch")?.trim() || null;
  try {
    const rows = await listDocuments("quote", { customerQuery, branchCode });
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { header?: HeaderInput; lines?: DocumentLine[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です。" }, { status: 400 });
  }
  if (!body.header || !body.header.customer_name?.trim()) {
    return NextResponse.json({ error: "得意先名は必須です。" }, { status: 400 });
  }
  if (!body.header.branch_code) {
    return NextResponse.json({ error: "発行拠点は必須です。" }, { status: 400 });
  }

  try {
    const row = await createDocument("quote", body.header, body.lines ?? []);
    return NextResponse.json({ row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
