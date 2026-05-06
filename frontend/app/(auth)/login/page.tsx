"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/labels/${slug}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_email: email }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Error al iniciar sesión");
      }

      const data = await res.json();
      localStorage.setItem("token", data.token);
      localStorage.setItem("label_id", data.label_id);
      localStorage.setItem("slug", data.slug);
      router.push("/inbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded border p-8" style={{ borderColor: "#27272a", background: "#111114" }}>
      <h1 className="font-display font-semibold text-xl mb-2">Iniciar sesión</h1>
      <p className="text-sm text-muted mb-6">Accedé al dashboard de tu sello.</p>

      {error && (
        <div className="mb-4 px-4 py-3 rounded text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Slug del sello</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            className="w-full px-3 py-2.5 rounded border text-sm bg-transparent"
            style={{ borderColor: "#27272a" }}
            placeholder="tu-sello"
            required
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-1.5 block">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2.5 rounded border text-sm bg-transparent"
            style={{ borderColor: "#27272a" }}
            placeholder="tu@email.com"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: "#10b981", color: "#09090b" }}
        >
          {loading ? "Ingresando..." : "Iniciar sesión"}
        </button>
      </form>
    </div>
  );
}
