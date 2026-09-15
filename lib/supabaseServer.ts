import { createClient } from "@supabase/supabase-js";

// この関数は、Next.jsの「サーバー側の処理」からしか呼ばれません。
// SUPABASE_SERVICE_ROLE_KEY はブラウザ（画面を見る人）には一切送られず、
// Vercelのサーバーの中だけで使われます。
export function getSupabaseServerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が設定されていません。Vercelの環境変数を確認してください。"
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
    global: {
      // Vercel/Next.jsは、fetch()を使った通信の結果を裏側で覚えておく
      // 「データキャッシュ」という仕組みを持っている。これはビルドキャッシュとは別物で、
      // 再デプロイしても消えない。ここで明示的に「絶対に使うな(no-store)」と
      // 指定することで、Supabaseへの問い合わせが常に最新の結果を返すようにする。
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
