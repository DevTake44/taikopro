"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 見積書・請求書一覧の行から、過去の書類を複製して新しい下書きを作る。
export default function DuplicateButton({ kind, id }: { kind: "quote" | "invoice"; id: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function duplicate() {
    if (!confirm("この内容で新しい下書きを複製します。よろしいですか?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/${kind === "quote" ? "quotes" : "invoices"}/${id}/duplicate`, { method: "POST" });
      const json = await res.json();
      if (json.error) {
        alert(json.error);
        return;
      }
      router.push(`/sales-app/${kind === "quote" ? "quotes" : "invoices"}/${json.row.id}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button type="button" className="btn-sm" onClick={duplicate} disabled={loading}>
      {loading ? "複製中…" : "複製"}
    </button>
  );
}
