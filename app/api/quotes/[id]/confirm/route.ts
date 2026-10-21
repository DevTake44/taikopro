import { NextRequest, NextResponse } from "next/server";
import { setDocumentStatus } from "@/lib/documentCrud";

export const dynamic = "force-dynamic";

// 見積を「確定」にする(以後、金額の勝手な変更に気づきやすいよう下書きと区別するだけ。
// 確定後も編集はできる)。
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "idが不正です。" }, { status: 400 });

  try {
    await setDocumentStatus("quote", id, "confirmed");
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
