import Link from "next/link";
import { listDocuments } from "@/lib/documentCrud";
import { yen } from "@/lib/format";
import { BRANCH_NAMES, branchNameOnly } from "@/lib/branch-names";
import DocumentListFilters from "@/components/DocumentListFilters";
import DuplicateButton from "@/components/DuplicateButton";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { draft: "下書き", confirmed: "確定", converted: "請求書へ変換済" };

export default async function QuotesListPage({
  searchParams,
}: {
  searchParams: { branch?: string; customer?: string };
}) {
  const branchCode = searchParams.branch?.trim() || null;
  const customerQuery = searchParams.customer?.trim() || null;
  const rows = await listDocuments("quote", { customerQuery, branchCode });

  return (
    <div className="wrap" style={{ maxWidth: 1100 }}>
      <header className="top" style={{ marginBottom: 20 }}>
        <div className="title">
          <h1>見積書一覧</h1>
          <p>見積書の作成・編集・請求書への変換を行います。</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/sales-app/invoices" className="ghost-btn-inline">
            請求書一覧へ
          </Link>
          <Link href="/sales-app" className="ghost-btn-inline">
            ← 営業アプリ
          </Link>
        </div>
      </header>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <div className="card-head">
          <h2>一覧(新しい順・最大200件)</h2>
          <Link href="/sales-app/quotes/new" className="btn btn-primary btn-sm">
            + 新規見積作成
          </Link>
        </div>
        <DocumentListFilters
          branchCodes={Object.keys(BRANCH_NAMES).sort()}
          defaultBranch={branchCode ?? ""}
          defaultCustomer={customerQuery ?? ""}
        />
        <div className="matwrap">
          <table className="mat">
            <thead>
              <tr>
                <th className="codecol">見積番号</th>
                <th>拠点</th>
                <th className="namecol">得意先</th>
                <th className="namecol">件名</th>
                <th>見積日</th>
                <th>合計</th>
                <th>状態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="codecol">
                    <Link href={`/sales-app/quotes/${r.id}`}>{r.doc_no}</Link>
                  </td>
                  <td>{branchNameOnly(r.branch_code)}</td>
                  <td className="namecol">{r.customer_name}</td>
                  <td className="namecol">{r.subject || "—"}</td>
                  <td>{r.doc_date}</td>
                  <td>{yen(r.total)}</td>
                  <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td>
                    <DuplicateButton kind="quote" id={r.id} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="cell-sub" style={{ padding: 16 }}>
                    該当する見積がありません。
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
