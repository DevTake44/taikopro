# taikopro (統合版アプリ)

`sales-dashboard` と `rieki-check-app` を1つに統合したアプリ。DBは `taiko-pro`(Supabase Proプラン)に一本化。

## 構成

```
ログイン(合言葉、1つに統一)
 └ メインメニュー (/menu)
    ├ 売上管理 (役員・経営層向け)
    │  ├ 経営報告・全体サマリー・月次マトリクス・目標対比 (/sales)
    │  └ 売上利益 (/sales/profit)
    └ 社内DX (/dx、社員が日々使う実務ツール)
       ├ 仕入価格検索 (/dx/purchase-lookup、新purchasesテーブル向けに作り直し)
       ├ 不動在庫チェック (/dx/stock)
       └ データ更新 (/dx/upload)
```

社内DXには、上記以外のrieki-check-appの実務ツール(値上げ検知・べんりネット照合・買掛月報照合など)も、必要に応じて今後追加していく想定。

## 環境変数

- `SITE_PASSWORD` : ログイン合言葉
- `SUPABASE_URL` : taiko-proのProject URL
- `SUPABASE_SERVICE_ROLE_KEY` : taiko-proのservice_roleキー(ブラウザ側には一切出さない)

## セットアップ

```
npm install
npm run dev
```
 
## 未完了・要確認の作業

- 旧`purchase_lines`/`purchases_detail`からの`purchases`テーブルへのデータ移行(元の仕入CSV全期間分が必要)
- `product_master`の`spec`・`source_updated_at`列の既存156,163行バックフィル(商品マスタ元ファイルxlsb全件が必要)
- `lib/purchasesTransform.ts`の受注番号・受注行番号の列見出し名は未確認(実ファイルでの検証が必要)
- rieki-check-appのその他の実務ツールの移植可否
