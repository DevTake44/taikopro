import { notFound } from "next/navigation";
import { getDocument } from "@/lib/documentCrud";
import DocumentEditor from "@/components/DocumentEditor";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const doc = Number.isFinite(id) ? await getDocument("invoice", id) : null;
  return { title: doc ? `請求書 ${doc.doc_no}` : "請求書" };
}

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const doc = await getDocument("invoice", id);
  if (!doc) notFound();

  return (
    <DocumentEditor
      kind="invoice"
      doc={doc}
      title={`請求書 ${doc.doc_no}`}
      backHref="/sales-app/invoices"
      backLabel="← 請求書一覧"
    />
  );
}
