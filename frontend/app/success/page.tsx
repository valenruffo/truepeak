"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function SuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutId = searchParams.get("checkout_id");
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    // Signal to dashboard that payment completed — trigger plan re-fetch
    localStorage.setItem("payment_completed", "true");
    localStorage.setItem("payment_checkout_id", checkoutId || "");

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
  }, [router, checkoutId]);

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
        <p className="text-sm mb-2" style={{ color: "#a1a1aa" }}>
          Tu cuenta ha sido actualizada. Bienvenido a True Peak AI.
        </p>

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
