"use client";

import { useState } from "react";

// 売上管理画面共通の「更新」ボタン。押すとonRefreshを実行し、完了・失敗を一時的に表示する。
// データの取得元(サーバー側キャッシュの無効化 or ブラウザ側キャッシュの再取得)は
// onRefresh側で決める。
export default function RefreshButton({
  onRefresh,
  label = "データを更新",
}: {
  onRefresh: () => Promise<void>;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function handleClick() {
    setState("loading");
    try {
      await onRefresh();
      setState("done");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={state === "loading"}
      className="ghost-btn-inline"
      style={{ cursor: state === "loading" ? "default" : "pointer", border: "1px solid #d7dbe2", background: "#fff" }}
    >
      {state === "loading"
        ? "更新中…"
        : state === "done"
          ? "✓ 更新しました"
          : state === "error"
            ? "更新に失敗しました"
            : `↻ ${label}`}
    </button>
  );
}
