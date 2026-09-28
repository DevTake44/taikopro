import ProfitDashboardLoader from "@/components/ProfitDashboardLoader";

// このページ自体はサーバー側でのデータ取得を行わず、components/ProfitDashboardLoader.tsx
// がブラウザ側で/api/profit-ordersを何回かに分けて呼び出し、全件を組み立ててから
// 表示する(rieki-check-appから移植)。
//
// 以前はforce-dynamic(毎回サーバーで実行)を指定していたが、これがあるとNext.jsが
// このページを静的な入れ物として扱えず、メニューから開くたびにサーバーとの往復が
// 発生してloading.tsxが挟まってしまっていた(経営レポート/sales で判明したのと
// 同じ原因)。このページは元々サーバー側でデータを取得しておらず、データの新旧は
// ブラウザ側のfetchが握っているため、force-dynamicを外しても古いデータが
// 表示され続けることはない。
export default function SalesProfitPage() {
  return <ProfitDashboardLoader />;
}
