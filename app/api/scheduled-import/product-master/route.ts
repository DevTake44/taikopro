import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { decodeCsvBufferServer } from "@/lib/csvDecodeServer";
import { transformProductMasterCsv } from "@/lib/productMasterTransform";
import { PRODUCT_MASTER_CONFLICT_COLUMNS } from "@/lib/uploadRules";
import { logUpload } from "@/lib/logUpload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHUNK_SIZE = 1000;

// 社内共有フォルダ(\\192.168.64.211\マスタcsv\商品マスタ.csv)から、定期実行スクリプトが
// 毎朝9時にこのエンドポイントへCSVの中身をそのままPOSTすることを想定した取込口。
// 画面からの手動アップロード(③商品マスタの更新、/api/commit-product-master)と
// 処理内容は完全に同じにする(decodeCsvBuffer→Papa.parse→transformProductMasterCsv→
// upsert)。ログイン画面を経由しないため、ヘッダーのトークンで個別に認証する
// (SCHEDULED_IMPORT_TOKEN環境変数に設定した値と一致する場合だけ受け付ける)。
export async function POST(req: NextRequest) {
  const expectedToken = process.env.SCHEDULED_IMPORT_TOKEN;
  const givenToken = req.headers.get("x-import-token");
  if (!expectedToken || givenToken !== expectedToken) {
    return NextResponse.json({ error: "認証に失敗しました(トークンが一致しません)。" }, { status: 401 });
  }

  try {
    const arrayBuf = await req.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    if (buf.length === 0) {
      return NextResponse.json({ error: "送信されたファイルが空です。" }, { status: 400 });
    }

    const text = decodeCsvBufferServer(buf);
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const fatalErrors = parsed.errors.filter((e) => e.type !== "FieldMismatch");
    if (fatalErrors.length > 0) {
      return NextResponse.json(
        { error: "CSVの読み込み中にエラーが発生しました: " + fatalErrors[0].message },
        { status: 400 }
      );
    }

    const { rows, skipped } = transformProductMasterCsv(parsed.data);
    if (rows.length === 0) {
      return NextResponse.json({ error: "有効なデータ行がありませんでした。" }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const supabase = getSupabaseServerClient();
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE).map((r) => ({ ...r, updated_at: nowIso }));
      const { error } = await supabase
        .from("product_master")
        .upsert(chunk, { onConflict: PRODUCT_MASTER_CONFLICT_COLUMNS });
      if (error) {
        await logUpload({
          uploadType: "product_master",
          action: "commit",
          rowCount: rows.length,
          success: false,
          errorMessage: error.message,
        });
        return NextResponse.json(
          { error: `本番データへの反映中にエラーが発生しました: ${error.message}` },
          { status: 500 }
        );
      }
    }

    await logUpload({
      uploadType: "product_master",
      action: "commit",
      rowCount: rows.length,
      skippedCount: skipped.length,
      success: true,
    });
    return NextResponse.json({ success: true, rowCount: rows.length, skippedCount: skipped.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logUpload({ uploadType: "product_master", action: "commit", success: false, errorMessage: message });
    return NextResponse.json({ error: "予期しないエラーが発生しました: " + message }, { status: 500 });
  }
}
