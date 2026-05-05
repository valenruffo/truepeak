"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PLANS = [
  {
    id: "boutique",
    name: "Boutique",
    price: 29,
    features: [
      "Hasta 50 demos/mes",
      "1 firma sónica personalizada",
      "Análisis técnico completo",
      "Dashboard básico",
      "CRM de emails con plantillas",
      "Feedback automático para rechazos",
    ],
  },
  {
    id: "pro",
    name: "Label Pro",
    price: 79,
    highlighted: true,
    features: [
      "Demos ilimitados",
      "Hasta 5 firmas sónicas",
      "Análisis avanzado + detección de samples",
      "Dashboard completo + export CSV",
      "CRM avanzado + plantillas custom",
      "API para integrar con tu DAW",
      "Soporte prioritario",
    ],
  },
];

export default function PricingPage() {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCheckout = async (planId: string) => {
    setSelectedPlan(planId);
    setLoading(true);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/stripe/create-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: planId,
          success_url: `${window.location.origin}/inbox?payment=success`,
          cancel_url: `${window.location.origin}/pricing`,
        }),
      });

      if (!res.ok) throw new Error("Error al crear la sesión de pago");

      const { url } = await res.json();
      window.location.href = url;
    } catch {
      // Fallback: just redirect to dashboard for now
      router.push("/inbox");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "#09090b", color: "#fafafa" }}>
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b" style={{ borderColor: "#27272a", background: "rgba(9,9,11,0.92)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <button onClick={() => router.push("/")} className="font-display font-semibold text-sm tracking-tight">
            True Peak AI
          </button>
          <div className="flex items-center gap-6">
            <button onClick={() => router.push("/")} className="text-sm text-muted hover:text-fg transition-colors">
              Inicio
            </button>
            <button onClick={() => router.push("/login")} className="text-sm text-muted hover:text-fg transition-colors">
              Iniciar sesión
            </button>
          </div>
        </div>
      </nav>

      <div className="pt-28 pb-16 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <div className="text-xs font-mono uppercase tracking-wider text-muted mb-3">Precios</div>
            <h1 className="font-display font-bold text-3xl md:text-4xl tracking-tight">
              Simple. <span style={{ color: "#10b981" }}>Sin sorpresas.</span>
            </h1>
            <p className="text-sm text-muted mt-3">Elegí el plan que mejor se adapte a tu sello.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className="border p-6 rounded"
                style={{ borderColor: plan.highlighted ? "#10b981" : "#27272a" }}
              >
                {plan.highlighted && (
                  <div className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "#10b981" }}>
                    Más popular
                  </div>
                )}
                <div className="flex items-baseline justify-between mb-6">
                  <div className="text-xs font-mono uppercase tracking-wider text-muted">{plan.name}</div>
                  <div className="flex items-baseline gap-1">
                    <span className="font-display font-bold text-3xl">US${plan.price}</span>
                    <span className="text-muted text-xs">/mes</span>
                  </div>
                </div>
                <ul className="space-y-2 mb-8">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span style={{ color: "#10b981" }}>·</span>
                      <span className="text-muted">{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => handleCheckout(plan.id)}
                  disabled={loading && selectedPlan === plan.id}
                  className="w-full py-2.5 text-sm font-medium rounded transition-all hover:opacity-90 disabled:opacity-50"
                  style={{
                    background: plan.highlighted ? "#10b981" : "transparent",
                    color: plan.highlighted ? "#09090b" : "#fafafa",
                    border: plan.highlighted ? "none" : "1px solid #27272a",
                  }}
                >
                  {loading && selectedPlan === plan.id ? "Redirigiendo..." : plan.highlighted ? "Empezar ahora" : "Crear cuenta"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
