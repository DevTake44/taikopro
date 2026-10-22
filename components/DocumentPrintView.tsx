"use client";

import { yen, jpn } from "@/lib/format";
import type { CompanyInfo, DocumentWithLines } from "@/lib/quoteTypes";

const TAX_LABEL: Record<string, string> = { "10": "10%", "8": "8%(軽減)", "0": "非課税" };

export default function DocumentPrintView({
  kind,
  doc,
  company,
}: {
  kind: "quote" | "invoice";
  doc: DocumentWithLines;
  company: CompanyInfo | null;
}) {
  const docTitle = kind === "quote" ? "見　積　書" : "御　請　求　書";
  const dueLabel = kind === "quote" ? "有効期限" : "お支払期限";

  return (
    <div className="print-page">
      <div className="no-print" style={{ textAlign: "right", marginBottom: 12 }}>
        <button type="button" onClick={() => window.print()}>
          印刷 / PDF保存
        </button>
      </div>

      <h1 style={{ textAlign: "center", letterSpacing: 8, fontSize: 22, margin: "0 0 20px" }}>{docTitle}</h1>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 14, marginBottom: 6 }}>
            {doc.customer_postal_code && <div>〒{doc.customer_postal_code}</div>}
            {doc.customer_address && <div style={{ whiteSpace: "pre-wrap" }}>{doc.customer_address}</div>}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, borderBottom: "1px solid #333", paddingBottom: 4, minWidth: 260 }}>
            {doc.customer_name}
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 12 }}>
          <div>{kind === "quote" ? "見積番号" : "請求番号"}: {doc.doc_no}</div>
          <div>{kind === "quote" ? "見積日" : "請求日"}: {doc.doc_date}</div>
          {doc.due_or_valid_date && <div>{dueLabel}: {doc.due_or_valid_date}</div>}
        </div>
      </div>

      {company && (
        <div style={{ textAlign: "right", fontSize: 12, marginBottom: 20, lineHeight: 1.6 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            {company.name} {company.branch_name}
          </div>
          {company.postal_code && <div>〒{company.postal_code}</div>}
          {company.address && <div>{company.address}</div>}
          {(company.phone || company.fax) && (
            <div>
              {company.phone && `TEL ${company.phone}`} {company.fax && `FAX ${company.fax}`}
            </div>
          )}
          {company.invoice_registration_no && <div>登録番号: {company.invoice_registration_no}</div>}
          {kind === "invoice" && company.bank_info && <div>振込先: {company.bank_info}</div>}
        </div>
      )}

      {doc.subject && <div style={{ marginBottom: 10, fontSize: 14 }}>件名: {doc.subject}</div>}

      <div style={{ textAlign: "center", fontSize: 20, fontWeight: 700, margin: "16px 0" }}>
        {kind === "quote" ? "御見積金額" : "御請求金額"}: {yen(doc.total)}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
        <thead>
          <tr>
            {["品番/品名", "数量", "単価", "金額", "税区分", "備考"].map((h) => (
              <th key={h} style={{ border: "1px solid #999", padding: "6px 8px", fontSize: 12, background: "#f3f4f6" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i}>
              <td style={{ border: "1px solid #ccc", padding: "6px 8px", fontSize: 12 }}>
                {l.product_name}
                {l.spec && <div style={{ fontSize: 11, color: "#666" }}>{l.spec}</div>}
              </td>
              <td style={{ border: "1px solid #ccc", padding: "6px 8px", fontSize: 12, textAlign: "right" }}>{jpn(l.qty)}</td>
              <td style={{ border: "1px solid #ccc", padding: "6px 8px", fontSize: 12, textAlign: "right" }}>{yen(l.unit_price)}</td>
              <td style={{ border: "1px solid #ccc", padding: "6px 8px", fontSize: 12, textAlign: "right" }}>{yen(l.amount)}</td>
              <td style={{ border: "1px solid #ccc", padding: "6px 8px", fontSize: 12, textAlign: "center" }}>{TAX_LABEL[l.tax_type]}</td>
              <td style={{ border: "1px solid #ccc", padding: "6px 8px", fontSize: 11 }}>{l.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="totals-block" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 280 }}>
          <tbody>
            <tr>
              <td style={{ padding: "4px 10px" }}>小計</td>
              <td style={{ padding: "4px 10px", textAlign: "right" }}>{yen(doc.subtotal)}</td>
            </tr>
            <tr>
              <td style={{ padding: "4px 10px" }}>消費税(10%対象)</td>
              <td style={{ padding: "4px 10px", textAlign: "right" }}>{yen(doc.tax_10)}</td>
            </tr>
            <tr>
              <td style={{ padding: "4px 10px" }}>消費税(8%軽減対象)</td>
              <td style={{ padding: "4px 10px", textAlign: "right" }}>{yen(doc.tax_8)}</td>
            </tr>
            <tr>
              <td style={{ padding: "4px 10px" }}>非課税</td>
              <td style={{ padding: "4px 10px", textAlign: "right" }}>{yen(doc.tax_exempt_amount)}</td>
            </tr>
            <tr style={{ borderTop: "2px solid #333" }}>
              <td style={{ padding: "6px 10px", fontWeight: 700 }}>合計</td>
              <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700 }}>{yen(doc.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="footer-block">
        {doc.note && (
          <div style={{ fontSize: 12, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>備考</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{doc.note}</div>
          </div>
        )}

        {doc.staff_name && <div style={{ fontSize: 12, textAlign: "right" }}>担当: {doc.staff_name}</div>}
      </div>

      <style jsx global>{`
        /* A4(210mm×297mm)に固定する。画面プレビューもA4の縦横比・余白で表示し、
           印刷時の見た目とズレないようにする。
           明細が1ページに収まらない場合は、表ヘッダーを各ページで繰り返し表示し
           (thead; display:table-header-groupは主要ブラウザでページをまたいだ印刷時に
           自動で各ページの先頭に再掲される)、行の途中でページが割れないようにする。 */
        @page {
          size: A4;
          margin: 15mm;
        }
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            background: #fff !important;
          }
          .print-page {
            width: auto;
            min-height: 0;
            margin: 0;
            padding: 0;
            box-shadow: none;
          }
        }
        .print-page {
          width: 210mm;
          min-height: 297mm;
          margin: 20px auto;
          padding: 15mm;
          background: #fff;
          font-family: sans-serif;
          color: #222;
          box-sizing: border-box;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
        }
        .print-page table thead {
          display: table-header-group;
        }
        .print-page table tr {
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .print-page .totals-block,
        .print-page .footer-block {
          page-break-inside: avoid;
          break-inside: avoid;
        }
      `}</style>
    </div>
  );
}
