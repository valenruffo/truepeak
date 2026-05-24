"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function SuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutId = searchParams.get("checkout_id");
  const [planUpdated, setPlanUpdated] = useState(false);
  const [detectedPlan, setDetectedPlan] = useState<string | null>(null);

  useEffect(() => {
    // Signal to dashboard that payment completed — trigger plan re-fetch
    localStorage.setItem("payment_completed", "true");
    if (checkoutId) {
      localStorage.setItem("payment_checkout_id", checkoutId);
    }

    // Poll backend for plan update (webhook may take a few seconds)
    const slug = localStorage.getItem("slug");
    const currentPlan = localStorage.getItem("plan") || "free";

    if (slug) {
      let attempts = 0;
      const maxAttempts = 20; // 20 * 2s = 40s max wait for webhook
      
      const pollInterval = setInterval(async () => {
        attempts++;
        try {
          const res = await fetch(`/api/labels/${slug}`);
          if (res.ok) {
            const data = await res.json();
            if (data?.plan && data.plan !== currentPlan && data.plan !== "free") {
              // Plan updated!
              clearInterval(pollInterval);
              setPlanUpdated(true);
              setDetectedPlan(data.plan);
              localStorage.setItem("plan", data.plan);
              window.dispatchEvent(new Event("plan_updated"));
            }
          }
        } catch {}

        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
        }
      }, 2000);

      return () => clearInterval(pollInterval);
    }
  }, [checkoutId]);

  useEffect(() => {
    if (planUpdated) {
      // Auto-redirect 3 seconds after confirming the plan was upgraded
      const timer = setTimeout(() => {
        router.push("/settings");
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [planUpdated, router]);

  const planLabel = detectedPlan
    ? detectedPlan.charAt(0).toUpperCase() + detectedPlan.slice(1)
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#09090b" }}>
      <div className="w-full max-w-md text-center">
        {/* Success icon */}
        <div
          className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
          style={{ background: planUpdated ? "rgba(16,185,129,0.12)" : "rgba(161,161,170,0.1)" }}
        >
          {planUpdated ? (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          )}
        </div>

        <h1 className="font-display font-bold text-2xl tracking-tight mb-2" style={{ color: "#fafafa" }}>
          {planUpdated ? "¡Pago confirmado!" : "Procesando tu pago..."}
        </h1>

        {planUpdated && planLabel ? (
          <div>
            <p className="text-sm mb-6" style={{ color: "#10b981" }}>
              Tu plan se actualizó a <strong>{planLabel}</strong>. ¡Bienvenido a True Peak AI!
            </p>
            <p className="text-xs" style={{ color: "#52525b" }}>
              Redirigiendo a tu cuenta en unos segundos...
            </p>
          </div>
        ) : (
          <div className="mb-6">
            <p className="text-sm mb-4" style={{ color: "#a1a1aa" }}>
              Estamos esperando la confirmación del servidor. Por favor no cierres esta ventana.
            </p>
            <div className="flex items-center justify-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs" style={{ color: "#52525b" }}>Aguardando webhook...</span>
            </div>
          </div>
        )}

        {checkoutId && (
          <div
            className="inline-block px-3 py-1.5 rounded text-[10px] font-mono mt-8"
            style={{ background: "rgba(161,161,170,0.06)", color: "#71717a", border: "1px solid rgba(161,161,170,0.1)" }}
          >
            Ref: {checkoutId}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#09090b" }}>
        <div className="text-sm" style={{ color: "#a1a1aa" }}>Cargando...</div>
      </div>
    }>
      <SuccessContent />
    </Suspense>
  );
}
