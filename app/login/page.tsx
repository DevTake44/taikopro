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
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <form onSubmit={handleSubmit} className="card" style={{ padding: 32, width: 320 }}>
        <h1 style={{ fontSize: 18, marginBottom: 16 }}>太幸 統合版アプリ</h1>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 16 }}>合言葉を入力してください</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="合言葉"
          style={{ width: "100%", padding: "10px 12px", fontSize: 14, marginBottom: 12, boxSizing: "border-box" }}
          autoFocus
        />
        {error && <p className="alert alert-error" style={{ marginTop: 0 }}>{error}</p>}
        <button type="submit" className="btn-primary" disabled={loading} style={{ width: "100%", justifyContent: "center", padding: "10px 12px", fontSize: 14 }}>
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
