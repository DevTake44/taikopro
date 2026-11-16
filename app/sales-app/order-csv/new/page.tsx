import OrderCsvForm from "@/components/OrderCsvForm";

export const metadata = { title: "受注CSV作成" };

export default function NewOrderCsvPage() {
  return (
    <OrderCsvForm
      title="受注CSV作成"
      backHref="/sales-app"
      backLabel="← 営業アプリ"
      downloadFileNameBase={`受注_${new Date().toISOString().slice(0, 10)}`}
    />
  );
}
