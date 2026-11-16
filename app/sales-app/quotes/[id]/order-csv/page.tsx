import { notFound } from "next/navigation";
import { getDocument } from "@/lib/documentCrud";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import OrderCsvForm from "@/components/OrderCsvForm";
import { splitZenkaku20, type OrderCsvHeaderInput, type OrderCsvLineInput } from "@/lib/orderCsvLayout";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const doc = Number.isFinite(id) ? await getDocument("quote", id) : null;
  return { title: doc ? `受注CSV作成 ${doc.doc_no}` : "受注CSV作成" };
}

// 受注CSV作成画面(OrderCsvForm)は見積の存在を知らない、単体で完結した画面。
// ここでは見積の内容を、その画面の初期値の形に変換して渡すだけ。
export default async function QuoteOrderCsvPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const doc = await getDocument("quote", id);
  if (!doc) notFound();

  // 納入先情報の初期値(郵便番号・電話番号)を、得意先マスタから引いておく
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

  const [name1, name2] = splitZenkaku20(doc.customer_name);
  const [addr1, addr2] = splitZenkaku20(doc.customer_address);

  const initialHeader: Partial<OrderCsvHeaderInput> = {
    customer_code: doc.customer_code ?? "",
    delivery_code: doc.customer_code ?? "",
    delivery_name1: name1,
    delivery_name2: name2,
    delivery_address1: addr1,
    delivery_address2: addr2,
    delivery_postal_code: (customerMaster?.postal_code ?? doc.customer_postal_code ?? "").replaceAll("-", ""),
    delivery_tel: (customerMaster?.phone_number ?? "").replaceAll("-", ""),
    note: doc.note ?? "",
    desired_date: doc.due_or_valid_date ?? "",
    subject: doc.subject ?? "",
  };

  const initialLines: OrderCsvLineInput[] = doc.lines.map((l) => ({
    product_code: l.product_code,
    product_name: l.product_name,
    spec: l.spec,
    qty: l.qty,
    unit_price: l.unit_price,
    note: l.note,
    unit: "",
    arrange_code: "",
    supplier_code: l.supplier_code,
    cost_price: l.cost_price,
    purchase_note: "",
    department1: "",
    department2: "",
    ship_date: "",
    arrival_date: "",
    ship_location: "200",
    delivery_method: "1",
    arrival_spec: "0",
    time_spec: "0",
  }));

  return (
    <OrderCsvForm
      title={`受注CSV作成 - ${doc.doc_no}`}
      backHref={`/sales-app/quotes/${doc.id}`}
      backLabel="← 見積書に戻る"
      downloadFileNameBase={`受注_${doc.doc_no}`}
      initialHeader={initialHeader}
      initialLines={initialLines}
    />
  );
}
