import { notFound } from "next/navigation";
import { getDocument } from "@/lib/documentCrud";
import DocumentEditor from "@/components/DocumentEditor";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const doc = Number.isFinite(id) ? await getDocument("quote", id) : null;
  return { title: doc ? `見積書 ${doc.doc_no}` : "見積書" };
}

export default async function QuoteDetailPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const doc = await getDocument("quote", id);
  if (!doc) notFound();

  return (
    <DocumentEditor
      kind="quote"
      doc={doc}
      title={`見積書 ${doc.doc_no}`}
      backHref="/sales-app/quotes"
      backLabel="← 見積書一覧"
    />
  );
}
