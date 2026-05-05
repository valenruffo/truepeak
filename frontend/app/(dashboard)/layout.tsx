"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/config", label: "Firma sónica" },
  { href: "/link", label: "Link" },
  { href: "/inbox", label: "Demos" },
  { href: "/crm", label: "CRM" },
];

const plans = [
  { id: "starter", name: "Starter", price: "$12", demos: "100/mes", firmas: 1 },
  { id: "pro", name: "Label Pro", price: "$39", demos: "500/mes", firmas: 2 },
] as const;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [currentPlan, setCurrentPlan] = useState<"starter" | "pro">("starter");
  const isAdmin = typeof window !== "undefined" && localStorage.getItem("admin") === "true";

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "#09090b", color: "#fafafa" }}>
      <header className="sticky top-0 z-40 border-b" style={{ borderColor: "#27272a", background: "rgba(17,17,20,0.8)", backdropFilter: "blur(12px)" }}>
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/inbox">
            <img src="/logo.png" alt="True Peak AI" className="h-7 w-auto" />
          </Link>
          <nav className="flex items-center gap-6">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "text-sm transition-colors",
                    isActive ? "text-fg" : "text-muted hover:text-fg"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <div className="flex items-center gap-1 rounded border px-2 py-1" style={{ borderColor: "#27272a" }}>
                {plans.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setCurrentPlan(p.id as "starter" | "pro")}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors"
                    style={{
                      background: currentPlan === p.id ? "#10b981" : "transparent",
                      color: currentPlan === p.id ? "#09090b" : "#71717a",
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            <div className="w-6 h-6 rounded-full" style={{ background: "#27272a" }} />
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6">{children}</div>
      </main>
    </div>
  );
}
