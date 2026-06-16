"use client";

import { useState } from "react";

export default function AdminDashboard() {
  const [password, setPassword] = useState<string>("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    try {
      const res = await fetch("/api/admin/users", {
        headers: { "X-Admin-Password": password },
      });
      if (res.ok) {
        setIsLoggedIn(true);
        setError("");
      } else {
        setError("Wrong password");
      }
    } catch (e) {
      setError("Network error");
    }
  };

  if (isLoggedIn) {
    return (
      <div style={{ minHeight: "100vh", background: "#09090b", color: "white", padding: 32 }}>
        <h1>Admin Dashboard - Logged in</h1>
        <p>Login works. Full dashboard coming next.</p>
        <button onClick={() => setIsLoggedIn(false)} style={{ marginTop: 16, padding: "8px 16px", background: "#10b981", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
          Logout
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#09090b", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 320, padding: 32, background: "#18181b", borderRadius: 8 }}>
        <h1 style={{ marginBottom: 16 }}>Admin Login</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          placeholder="Password"
          style={{ width: "100%", padding: 8, background: "#27272a", border: "1px solid #3f3f46", color: "white", borderRadius: 4, marginBottom: 8 }}
        />
        {error && <p style={{ color: "#ef4444", fontSize: 12, marginBottom: 8 }}>{error}</p>}
        <button onClick={handleLogin} style={{ width: "100%", padding: 8, background: "#10b981", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
          Login
        </button>
      </div>
    </div>
  );
}
