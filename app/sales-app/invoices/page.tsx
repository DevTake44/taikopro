import Link from "next/link";
import { listDocuments } from "@/lib/documentCrud";
import { yen } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { draft: "下書き", confirmed: "確定" };

export default async function InvoicesListPage() {
  const rows = await listDocuments("invoice", null);

  return (
    <div className="wrap" style={{ maxWidth: 1100 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>請求書一覧</h1>
          <p>見積書から変換した請求書の確認・編集を行います。</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/sales-app/quotes" className="ghost-btn-inline">
            見積書一覧へ
          </Link>
          <Link href="/sales-app" className="ghost-btn-inline">
            ← 営業アプリ
          </Link>
        </div>
      </header>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <div className="card-head">
          <h2>一覧(新しい順・最大200件)</h2>
        </div>
        <div className="matwrap">
          <table className="mat">
            <thead>
              <tr>
                <th className="codecol">請求書番号</th>
                <th className="namecol">得意先</th>
                <th className="namecol">件名</th>
                <th>請求日</th>
                <th>合計</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="codecol">
                    <Link href={`/sales-app/invoices/${r.id}`}>{r.doc_no}</Link>
                  </td>
                  <td className="namecol">{r.customer_name}</td>
                  <td className="namecol">{r.subject || "—"}</td>
                  <td>{r.doc_date}</td>
                  <td>{yen(r.total)}</td>
                  <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="cell-sub" style={{ padding: 16 }}>
                    請求書がまだありません。見積書を確定し「請求書に変換」から作成してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
