import { NextRequest, NextResponse } from "next/server";
import { duplicateDocument } from "@/lib/documentCrud";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "idが不正です。" }, { status: 400 });

  try {
    const row = await duplicateDocument("quote", id);
    return NextResponse.json({ row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
