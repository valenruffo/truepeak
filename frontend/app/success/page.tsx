"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function SuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutId = searchParams.get("checkout_id");
  const [countdown, setCountdown] = useState(8);
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
      const maxAttempts = 10; // 10 * 2s = 20s max
      
      const syncCheckout = async () => {
        if (checkoutId) {
          try {
            const res = await fetch("/vercel-api/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ checkout_id: checkoutId })
            });
            if (res.ok) {
              const data = await res.json();
              if (data.plan && data.plan !== "free") {
                setPlanUpdated(true);
                setDetectedPlan(data.plan);
                localStorage.setItem("plan", data.plan);
                window.dispatchEvent(new Event("plan_updated"));
                return true;
              }
            }
          } catch (e) {
            console.error("Sync failed:", e);
          }
        }
        return false;
      };

      const pollInterval = setInterval(async () => {
        attempts++;
        try {
          // First try to sync checkout explicitly
          if (attempts === 1 && checkoutId) {
            const synced = await syncCheckout();
            if (synced) {
              clearInterval(pollInterval);
              return;
            }
          }

          // Then fallback to checking the backend
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
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          router.push("/inbox");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [router]);

  const planLabel = detectedPlan
    ? detectedPlan.charAt(0).toUpperCase() + detectedPlan.slice(1)
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#09090b" }}>
      <div className="w-full max-w-md text-center">
        {/* Success icon */}
        <div
          className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
          style={{ background: "rgba(16,185,129,0.12)" }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h1 className="font-display font-bold text-2xl tracking-tight mb-2" style={{ color: "#fafafa" }}>
          ¡Pago exitoso!
        </h1>

        {planUpdated && planLabel ? (
          <p className="text-sm mb-2" style={{ color: "#10b981" }}>
            Tu plan se actualizó a <strong>{planLabel}</strong>. ¡Bienvenido a True Peak AI!
          </p>
        ) : (
          <div className="mb-2">
            <p className="text-sm" style={{ color: "#a1a1aa" }}>
              Tu cuenta está siendo actualizada...
            </p>
            <div className="flex items-center justify-center gap-2 mt-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs" style={{ color: "#52525b" }}>Esperando confirmación del webhook</span>
            </div>
          </div>
        )}

        {checkoutId && (
          <div
            className="inline-block px-3 py-1.5 rounded text-[10px] font-mono mb-6"
            style={{ background: "rgba(16,185,129,0.06)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)" }}
          >
            Checkout ID: {checkoutId}
          </div>
        )}

        {/* CTA */}
        <Link
          href="/inbox"
          className="inline-block w-full py-3 text-sm font-medium rounded transition-all hover:opacity-90"
          style={{ background: "#10b981", color: "#09090b" }}
        >
          Ir al Dashboard
        </Link>

        <p className="text-xs mt-4" style={{ color: "#52525b" }}>
          Redirigiendo automáticamente en {countdown}s...
        </p>
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
