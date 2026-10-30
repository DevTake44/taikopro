import { notFound } from "next/navigation";
import { getDocument } from "@/lib/documentCrud";
import { getCompanyInfo } from "@/lib/companyInfo";
import DocumentPrintView from "@/components/DocumentPrintView";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const doc = Number.isFinite(id) ? await getDocument("quote", id) : null;
  return { title: doc ? `見積書 ${doc.doc_no}(印刷)` : "見積書(印刷)" };
}

export default async function QuotePrintPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const doc = await getDocument("quote", id);
  if (!doc) notFound();
  const company = await getCompanyInfo(doc.branch_code);

  return <DocumentPrintView kind="quote" doc={doc} company={company} />;
}
