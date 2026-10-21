// quotes(見積書)とinvoices(請求書)はほぼ同じ構造を持つため、CRUDロジックを
// kind("quote"|"invoice")で共通化する。カラム名が一部違う(quote_no/invoice_no、
// quote_date/invoice_date、valid_until/due_date)ので、その対応だけここで吸収する。
import { getSupabaseServerClient } from "./supabaseServer";
import { calcTotals, type DocumentHeader, type DocumentLine, type DocumentWithLines } from "./quoteTypes";

export type Kind = "quote" | "invoice";

const TABLE: Record<Kind, string> = { quote: "quotes", invoice: "invoices" };
const LINES_TABLE: Record<Kind, string> = { quote: "quote_lines", invoice: "invoice_lines" };
const FK: Record<Kind, string> = { quote: "quote_id", invoice: "invoice_id" };
const NO_COL: Record<Kind, string> = { quote: "quote_no", invoice: "invoice_no" };
const DATE_COL: Record<Kind, string> = { quote: "quote_date", invoice: "invoice_date" };
const DUE_COL: Record<Kind, string> = { quote: "valid_until", invoice: "due_date" };

// DBの行(スネークケース、kindごとに列名が違う)を、画面共通で使うDocumentHeaderへ変換。
function rowToHeader(kind: Kind, row: Record<string, unknown>): DocumentHeader {
  return {
    id: row.id as number,
    doc_no: row[NO_COL[kind]] as string,
    quote_id: kind === "invoice" ? ((row.quote_id as number | null) ?? null) : undefined,
    customer_code: row.customer_code as string | null,
    customer_name: row.customer_name as string,
    customer_postal_code: row.customer_postal_code as string | null,
    customer_address: row.customer_address as string | null,
    subject: row.subject as string | null,
    doc_date: row[DATE_COL[kind]] as string,
    due_or_valid_date: row[DUE_COL[kind]] as string | null,
    staff_name: row.staff_name as string | null,
    status: row.status as DocumentHeader["status"],
    subtotal: Number(row.subtotal),
    tax_10: Number(row.tax_10),
    tax_8: Number(row.tax_8),
    tax_exempt_amount: Number(row.tax_exempt_amount),
    total: Number(row.total),
    note: row.note as string | null,
  };
}

export type HeaderInput = {
  customer_code: string | null;
  customer_name: string;
  customer_postal_code: string | null;
  customer_address: string | null;
  subject: string | null;
  doc_date: string;
  due_or_valid_date: string | null;
  staff_name: string | null;
  note: string | null;
};

// 画面側の共通フィールド名から、DB保存用(kindごとの列名)へ変換。
function headerInputToRow(kind: Kind, input: HeaderInput, totals: ReturnType<typeof calcTotals>) {
  return {
    customer_code: input.customer_code,
    customer_name: input.customer_name,
    customer_postal_code: input.customer_postal_code,
    customer_address: input.customer_address,
    subject: input.subject,
    [DATE_COL[kind]]: input.doc_date,
    [DUE_COL[kind]]: input.due_or_valid_date,
    staff_name: input.staff_name,
    note: input.note,
    ...totals,
  };
}

export async function listDocuments(kind: Kind, customerQuery: string | null) {
  const supabase = getSupabaseServerClient();
  let q = supabase
    .from(TABLE[kind])
    .select("*")
    .order("id", { ascending: false })
    .limit(200);
  if (customerQuery) {
    q = q.ilike("customer_name", `%${customerQuery}%`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => rowToHeader(kind, r));
}

export async function getDocument(kind: Kind, id: number): Promise<DocumentWithLines | null> {
  const supabase = getSupabaseServerClient();
  const { data: header, error: headerError } = await supabase.from(TABLE[kind]).select("*").eq("id", id).maybeSingle();
  if (headerError) throw new Error(headerError.message);
  if (!header) return null;

  const { data: lines, error: linesError } = await supabase
    .from(LINES_TABLE[kind])
    .select("*")
    .eq(FK[kind], id)
    .order("line_no", { ascending: true });
  if (linesError) throw new Error(linesError.message);

  return { ...rowToHeader(kind, header), lines: (lines ?? []) as DocumentLine[] };
}

export async function createDocument(kind: Kind, header: HeaderInput, lines: DocumentLine[]) {
  const supabase = getSupabaseServerClient();
  const totals = calcTotals(lines);

  const { data: inserted, error: insertError } = await supabase
    .from(TABLE[kind])
    .insert(headerInputToRow(kind, header, totals))
    .select("*")
    .single();
  if (insertError) throw new Error(insertError.message);

  if (lines.length > 0) {
    const { error: linesError } = await supabase.from(LINES_TABLE[kind]).insert(
      lines.map((l, i) => ({ ...lineToRow(l, i), [FK[kind]]: inserted.id }))
    );
    if (linesError) throw new Error(linesError.message);
  }

  return rowToHeader(kind, inserted);
}

function lineToRow(l: DocumentLine, index: number) {
  return {
    line_no: index + 1,
    product_code: l.product_code,
    product_name: l.product_name,
    spec: l.spec,
    qty: l.qty,
    unit_price: l.unit_price,
    amount: l.amount,
    tax_type: l.tax_type,
    note: l.note,
    source: l.source,
  };
}

// 保存(下書き更新)。明細は全削除→全挿入のシンプルな洗い替え方式
// (行の並び替え・削除が多い編集画面のため、差分更新より単純で確実)。
export async function updateDocument(kind: Kind, id: number, header: HeaderInput, lines: DocumentLine[]) {
  const supabase = getSupabaseServerClient();
  const totals = calcTotals(lines);

  const { error: updateError } = await supabase
    .from(TABLE[kind])
    .update({ ...headerInputToRow(kind, header, totals), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) throw new Error(updateError.message);

  const { error: deleteError } = await supabase.from(LINES_TABLE[kind]).delete().eq(FK[kind], id);
  if (deleteError) throw new Error(deleteError.message);

  if (lines.length > 0) {
    const { error: linesError } = await supabase
      .from(LINES_TABLE[kind])
      .insert(lines.map((l, i) => ({ ...lineToRow(l, i), [FK[kind]]: id })));
    if (linesError) throw new Error(linesError.message);
  }
}

export async function setDocumentStatus(kind: Kind, id: number, status: DocumentHeader["status"]) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from(TABLE[kind])
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteDocument(kind: Kind, id: number) {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from(TABLE[kind]).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// 見積(quote_id)から請求書を新規作成する。明細をそのままコピーし、
// 請求日=今日、支払期限=請求日+30日をデフォルトにする。元の見積はstatusをconvertedにする。
export async function convertQuoteToInvoice(quoteId: number) {
  const quote = await getDocument("quote", quoteId);
  if (!quote) throw new Error("見積が見つかりません。");

  const today = new Date().toISOString().slice(0, 10);
  const due = new Date();
  due.setDate(due.getDate() + 30);

  const supabase = getSupabaseServerClient();
  const totals = calcTotals(quote.lines);
  const { data: inserted, error: insertError } = await supabase
    .from("invoices")
    .insert({
      quote_id: quoteId,
      customer_code: quote.customer_code,
      customer_name: quote.customer_name,
      customer_postal_code: quote.customer_postal_code,
      customer_address: quote.customer_address,
      subject: quote.subject,
      invoice_date: today,
      due_date: due.toISOString().slice(0, 10),
      staff_name: quote.staff_name,
      note: quote.note,
      ...totals,
    })
    .select("*")
    .single();
  if (insertError) throw new Error(insertError.message);

  if (quote.lines.length > 0) {
    const { error: linesError } = await supabase
      .from("invoice_lines")
      .insert(quote.lines.map((l, i) => ({ ...lineToRow(l, i), invoice_id: inserted.id })));
    if (linesError) throw new Error(linesError.message);
  }

  await setDocumentStatus("quote", quoteId, "converted");

  return rowToHeader("invoice", inserted);
}
