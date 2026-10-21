import DocumentEditor from "@/components/DocumentEditor";

export const dynamic = "force-dynamic";

export default function NewQuotePage() {
  return (
    <DocumentEditor kind="quote" doc={null} title="見積書 新規作成" backHref="/sales-app/quotes" backLabel="← 見積書一覧" />
  );
}
