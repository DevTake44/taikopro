import { NextRequest, NextResponse } from "next/server";
import { getDocument, updateDocument, deleteDocument, setDocumentStatus, type HeaderInput } from "@/lib/documentCrud";
import type { DocumentLine } from "@/lib/quoteTypes";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "idが不正です。" }, { status: 400 });

  try {
    const row = await getDocument("invoice", id);
    if (!row) return NextResponse.json({ error: "請求書が見つかりません。" }, { status: 404 });
    return NextResponse.json({ row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "idが不正です。" }, { status: 400 });

  let body: { header?: HeaderInput; lines?: DocumentLine[]; confirm?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です。" }, { status: 400 });
  }
  if (!body.header || !body.header.customer_name?.trim()) {
    return NextResponse.json({ error: "得意先名は必須です。" }, { status: 400 });
  }

  try {
    await updateDocument("invoice", id, body.header, body.lines ?? []);
    if (body.confirm) await setDocumentStatus("invoice", id, "confirmed");
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "idが不正です。" }, { status: 400 });

  try {
    await deleteDocument("invoice", id);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
