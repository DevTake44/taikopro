// ページ遷移直後(サーバー側のデータ取得中)に表示する共通のローディング画面。
// Next.jsのloading.tsxから使う。件数などの進捗が分からない場面向けなので、
// スピナー+固定メッセージのみを表示する(進捗件数を出せる場面はコンポーネント側で
// 個別に「読み込み中… X / Y 件」を出す)。
export default function PageLoading({ label = "読み込んでいます…" }: { label?: string }) {
  return (
    <div className="loading-shell">
      <span className="spinner spinner-lg" />
      <p>{label}</p>
    </div>
  );
}
