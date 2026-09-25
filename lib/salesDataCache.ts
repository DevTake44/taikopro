// 売上管理(経営レポート・売上ダッシュボード明細・売上利益・拠点別利益)が使う
// Supabaseからのデータ取得を、まとめて1つのタグでキャッシュ・更新するための共通タグ名。
// このタグを付けてキャッシュした関数は、/api/revalidate-sales-data が呼ばれるまで
// (=画面の「更新」ボタンが押されるまで)同じ結果を返し続ける。
export const SALES_DATA_CACHE_TAG = "sales-data";
