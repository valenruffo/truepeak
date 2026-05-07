"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (password !== confirmPassword) { setError("Las contraseñas no coinciden."); return; }
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/labels/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, slug: slug.toLowerCase().replace(/\s+/g, "-"), owner_email: email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: "Error al crear la cuenta" }));
        throw new Error(data.detail || "Error al crear la cuenta");
      }
      const data = await res.json();
      localStorage.setItem("slug", data.slug);
      localStorage.setItem("label_id", data.id);
      localStorage.setItem("plan", data.plan || "free");
      router.push("/inbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear la cuenta");
    } finally { setLoading(false); }
  };

  return (
    <div className="rounded border p-8" style={{ borderColor: "#27272a", background: "#111114" }}>
      <h1 className="font-display font-semibold text-xl mb-2">Crear cuenta</h1>
      <p className="text-sm text-muted mb-6">Plan gratuito — hasta 5 tracks. Sin tarjeta.</p>
      {error && <div className="mb-4 px-4 py-3 rounded text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className="text-sm font-medium mb-1.5 block">Nombre del sello</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2.5 rounded border text-sm bg-transparent" style={{ borderColor: "#27272a" }} placeholder="Nocturnal Records" required /></div>
        <div><label className="text-sm font-medium mb-1.5 block">Slug (para tu link)</label><input type="text" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} className="w-full px-3 py-2.5 rounded border text-sm bg-transparent" style={{ borderColor: "#27272a" }} placeholder="nocturnal-records" required /><p className="text-xs text-muted mt-1">{typeof window !== "undefined" ? window.location.origin : ""}/s/{slug || "tu-sello"}</p></div>
        <div><label className="text-sm font-medium mb-1.5 block">Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2.5 rounded border text-sm bg-transparent" style={{ borderColor: "#27272a" }} placeholder="tu@email.com" required /></div>
        <div><label className="text-sm font-medium mb-1.5 block">Contraseña</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2.5 rounded border text-sm bg-transparent" style={{ borderColor: "#27272a" }} placeholder="Mínimo 8 caracteres" required minLength={8} /></div>
        <div><label className="text-sm font-medium mb-1.5 block">Confirmar contraseña</label><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full px-3 py-2.5 rounded border text-sm bg-transparent" style={{ borderColor: "#27272a" }} placeholder="Repetí la contraseña" required minLength={8} /></div>
        <button type="submit" disabled={loading} className="w-full py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 disabled:opacity-50 cursor-pointer" style={{ background: "#10b981", color: "#09090b" }}>{loading ? "Creando cuenta..." : "Crear cuenta gratis"}</button>
      </form>
    </div>
  );
}
