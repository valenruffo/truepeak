"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#09090b" }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="font-display font-semibold text-lg tracking-tight" style={{ color: "#fafafa" }}>
            True Peak <span style={{ color: "#10b981" }}>AI</span>
          </Link>
        </div>
        {children}
        <div className="mt-6 text-center text-sm text-muted">
          {isLogin ? (
            <>
              ¿No tenés cuenta?{" "}
              <Link href="/register" style={{ color: "#10b981" }}>
                Crear cuenta
              </Link>
            </>
          ) : (
            <>
              ¿Ya tenés cuenta?{" "}
              <Link href="/login" style={{ color: "#10b981" }}>
                Iniciar sesión
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
