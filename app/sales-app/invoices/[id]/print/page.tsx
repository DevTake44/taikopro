import { notFound } from "next/navigation";
import { getDocument } from "@/lib/documentCrud";
import { getCompanyInfo } from "@/lib/companyInfo";
import DocumentPrintView from "@/components/DocumentPrintView";

export const dynamic = "force-dynamic";

export default async function InvoicePrintPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const doc = await getDocument("invoice", id);
  if (!doc) notFound();
  const company = await getCompanyInfo();

  return <DocumentPrintView kind="invoice" doc={doc} company={company} />;
}
