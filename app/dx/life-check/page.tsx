import LifeCheck from "@/components/LifeCheck";

// このページはブラウザ内だけで完結する(サーバー/DBを使わない)ため、
// 他ページのようなSupabaseからのデータ取得は不要。
export const dynamic = "force-dynamic";
export const metadata = { title: "ライフ照合" };

export default function LifeCheckPage() {
  return <LifeCheck />;
}
