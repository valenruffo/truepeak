"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ToastProvider } from "@/components/ui/toast";

const navItems = [
  { href: "/config", label: "Config", icon: "⚙" },
  { href: "/inbox", label: "Inbox", icon: "📥" },
  { href: "/crm", label: "CRM", icon: "✉" },
  { href: "/link", label: "Link", icon: "🔗" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link href="/config" className="font-display text-lg font-bold tracking-tight">
            True Peak <span className="text-accent">AI</span>
          </Link>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname === `/dashboard${item.href}` || pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={`/dashboard${item.href}`}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-surface2 text-foreground"
                      : "text-muted hover:bg-surface2/50 hover:text-foreground"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <ToastProvider>{children}</ToastProvider>
      </main>
    </div>
  );
}
