import { notFound } from "next/navigation";
import { getDocument } from "@/lib/documentCrud";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import OrderCsvForm from "@/components/OrderCsvForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const doc = Number.isFinite(id) ? await getDocument("quote", id) : null;
  return { title: doc ? `受注CSV作成 ${doc.doc_no}` : "受注CSV作成" };
}

export default async function QuoteOrderCsvPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const doc = await getDocument("quote", id);
  if (!doc) notFound();

  // 納入先情報の初期値(郵便番号・住所・電話番号)を、得意先マスタから引いておく
  // (画面側で編集可能。マスタに無ければ空のまま)。
  type CustomerMasterRow = { postal_code: string | null; phone_number: string | null };
  let customerMaster: CustomerMasterRow | null = null;
  if (doc.customer_code) {
    const supabase = getSupabaseServerClient();
    const { data } = await supabase
      .from("customer_master")
      .select("postal_code, phone_number")
      .eq("customer_code", doc.customer_code)
      .maybeSingle();
    customerMaster = data as CustomerMasterRow | null;
  }

  return (
    <OrderCsvForm
      doc={doc}
      defaultPostalCode={customerMaster?.postal_code ?? doc.customer_postal_code}
      defaultPhone={customerMaster?.phone_number ?? null}
    />
  );
}
