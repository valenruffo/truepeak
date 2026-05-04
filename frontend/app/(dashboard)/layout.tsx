"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard/config", label: "Firma sónica" },
  { href: "/dashboard/link", label: "Link" },
  { href: "/dashboard/inbox", label: "Demos" },
  { href: "/dashboard/crm", label: "CRM" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "#09090b", color: "#fafafa" }}>
      <header className="sticky top-0 z-40 border-b" style={{ borderColor: "#27272a", background: "rgba(17,17,20,0.8)", backdropFilter: "blur(12px)" }}>
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/dashboard/inbox" className="font-display font-semibold text-sm tracking-tight">
            True Peak AI
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
          <div className="w-6 h-6 rounded-full" style={{ background: "#27272a" }} />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
