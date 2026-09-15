"use client";

import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const json = await res.json();
      window.location.href = json.redirect ?? "/menu";
    } else {
      setError("合言葉が正しくありません");
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#f7f8fa" }}>
      <form onSubmit={handleSubmit} style={{ background: "#fff", padding: 32, borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", width: 320 }}>
        <h1 style={{ fontSize: 18, marginBottom: 16 }}>太幸 統合版アプリ</h1>
        <p style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>合言葉を入力してください</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="合言葉"
          style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid #ddd", borderRadius: 8, marginBottom: 12, boxSizing: "border-box" }}
          autoFocus
        />
        {error && <p style={{ color: "#c0392b", fontSize: 13, marginBottom: 12 }}>{error}</p>}
        <button
          type="submit"
          disabled={loading}
          style={{ width: "100%", padding: "10px 12px", fontSize: 14, background: "#2563d9", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
        >
          {loading ? (
            <>
              <span className="spinner" />
              確認中...
            </>
          ) : (
            "入る"
          )}
        </button>
      </form>
    </div>
  );
}
