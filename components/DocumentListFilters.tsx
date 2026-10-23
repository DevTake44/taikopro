"use client";

import { BRANCH_NAMES } from "@/lib/branch-names";

// 見積書・請求書一覧の絞り込みフォーム。GETの検索パラメータ(branch/customer)で
// サーバー側のlistDocumentsに渡す(一覧自体はサーバーコンポーネントのまま)。
export default function DocumentListFilters({
  branchCodes,
  defaultBranch,
  defaultCustomer,
}: {
  branchCodes: string[];
  defaultBranch: string;
  defaultCustomer: string;
}) {
  return (
    <form method="GET" style={{ display: "flex", gap: 8, padding: "12px 20px", borderBottom: "1px solid var(--line)" }}>
      <select name="branch" defaultValue={defaultBranch} style={{ padding: "6px 10px" }}>
        <option value="">拠点(すべて)</option>
        {branchCodes.map((code) => (
          <option key={code} value={code}>
            {BRANCH_NAMES[code] ?? code}
          </option>
        ))}
      </select>
      <input
        type="text"
        name="customer"
        placeholder="得意先名で絞り込み"
        defaultValue={defaultCustomer}
        style={{ flex: 1, padding: "6px 10px" }}
      />
      <button type="submit">絞り込む</button>
    </form>
  );
}
