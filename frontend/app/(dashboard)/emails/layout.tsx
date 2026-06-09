"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Mail, FileText } from "lucide-react";

const tabs = [
  { href: "/emails", label: "CRM", icon: Mail },
  { href: "/emails/templates", label: "Plantillas", icon: FileText },
];

export default function EmailsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex flex-col h-full">
      {/* Sub-navigation tabs */}
      <div className="flex items-center gap-1 px-6 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || (tab.href === "/emails" && pathname === "/emails");
          const Icon = tab.icon;
          return (
            <button
              key={tab.href}
              onClick={() => router.push(tab.href)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                isActive
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "text-muted hover:bg-white/5 hover:text-primary"
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}
