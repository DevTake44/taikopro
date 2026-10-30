import PayableCheck from "@/components/PayableCheck";

// このページはブラウザ内だけで完結する(サーバー/DBを使わない)ため、
// 他ページのようなSupabaseからのデータ取得は不要。
export const dynamic = "force-dynamic";
export const metadata = { title: "買掛月報照合" };

export default function PayableCheckPage() {
  return <PayableCheck />;
}
