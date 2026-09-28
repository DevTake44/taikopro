import ProfitSummary from "@/components/ProfitSummary";

// このページ自体はサーバー側でのデータ取得を一切行わない(ProfitSummaryコンポーネントが
// ブラウザ側で/api/profit-summaryを何回かに分けて呼び出し、全件を組み立ててから
// 表示する。rieki-check-appから移植)。
//
// 以前はforce-dynamic(毎回サーバーで実行)を指定していたが、これがあると
// Next.jsがこのページを静的な入れ物として扱えず、メニューから開くたびにサーバーとの
// 往復が発生してloading.tsxが挟まってしまっていた(経営レポート/sales で判明した
// のと同じ原因)。このページは元々サーバー側でデータを取得しておらず、データの
// 新旧はブラウザ側のfetchが握っているため、force-dynamicを外しても古いデータが
// 表示され続けることはない。
export default function ProfitSummaryPage() {
  return <ProfitSummary />;
}
