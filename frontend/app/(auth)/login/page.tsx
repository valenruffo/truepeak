"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/labels/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ identifier, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: "Error al iniciar sesión" }));
        throw new Error(data.detail || "Error al iniciar sesión");
      }
      const data = await res.json();
      localStorage.setItem("slug", data.slug);
      localStorage.setItem("label_id", data.id);
      localStorage.setItem("plan", data.plan || "free");
      router.push("/inbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally { setLoading(false); }
  };

  return (
    <div className="rounded border p-8" style={{ borderColor: "#27272a", background: "#111114" }}>
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-white transition-colors mb-4">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5" /><polyline points="12 19 5 12 12 5" /></svg>
        Volver al inicio
      </Link>
      <h1 className="font-display font-semibold text-xl mb-2">Iniciar sesión</h1>
      <p className="text-sm text-muted mb-6">Accedé al dashboard de tu sello.</p>
      {error && <div className="mb-4 px-4 py-3 rounded text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className="text-sm font-medium mb-1.5 block">Email o nombre del sello</label><input type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value.toLowerCase())} className="w-full px-3 py-2.5 rounded border text-sm bg-transparent" style={{ borderColor: "#27272a" }} placeholder="tu@email.com o tu-sello" required /></div>
        <div><label className="text-sm font-medium mb-1.5 block">Contraseña</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2.5 rounded border text-sm bg-transparent" style={{ borderColor: "#27272a" }} placeholder="••••••••" required minLength={8} /></div>
        <button type="submit" disabled={loading} className="w-full py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 disabled:opacity-50 cursor-pointer" style={{ background: "#10b981", color: "#09090b" }}>{loading ? "Ingresando..." : "Iniciar sesión"}</button>
      </form>
    </div>
  );
}
