"use client";

import { useState, useEffect, useMemo } from "react";
import {
  getAppMode,
  updateAppMode,
  getWaitlist,
  exportWaitlistCsv,
  WaitlistEntry,
  AdminUser,
  getAdminUsers,
  updateUserStatus,
  getRecentActivity,
  RecentActivityEntry,
} from "@/lib/api";

type Tab = "waitlist" | "users" | "activity";
type SortKey = "newest" | "oldest" | "plan" | "submissions";

const PLAN_ORDER: Record<string, number> = { free: 0, indie: 1, pro: 2 };

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  return `${Math.floor(diffDay / 30)} month${Math.floor(diffDay / 30) === 1 ? "" : "s"} ago`;
}

export default function AdminDashboard() {
  const [password, setPassword] = useState<string>("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [page, setPage] = useState(1);
  const perPage = 15;
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("waitlist");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");

  const [modeData, setModeData] = useState<{ mode: string } | null>(null);
  const [waitlistData, setWaitlistData] = useState<{ entries: WaitlistEntry[]; total: number } | null>(null);
  const [usersData, setUsersData] = useState<AdminUser[] | null>(null);
  const [activityData, setActivityData] = useState<{ entries: RecentActivityEntry[]; total: number } | null>(null);
  const [activityPage, setActivityPage] = useState(1);

  // Login
  const handleLogin = async () => {
    setLoginLoading(true);
    setLoginError("");
    try {
      const res = await fetch("/api/admin/users", {
        headers: { "X-Admin-Password": password },
      });
      if (res.ok) {
        sessionStorage.setItem("admin_password", password);
        setIsLoggedIn(true);
        const data = await res.json();
        setUsersData(data);
      } else {
        setLoginError("Wrong password");
      }
    } catch (e) {
      setLoginError("Network error");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("admin_password");
    setPassword("");
    setIsLoggedIn(false);
    setUsersData(null);
    setWaitlistData(null);
    setActivityData(null);
  };

  // Fetch app mode
  useEffect(() => {
    const fetchMode = async () => {
      try {
        const data = await getAppMode();
        setModeData(data);
      } catch (e) { /* ignore */ }
    };
    fetchMode();
  }, []);

  // Fetch waitlist
  useEffect(() => {
    if (!isLoggedIn) return;
    const fetchWaitlist = async () => {
      try {
        const data = await getWaitlist(password, page, perPage);
        setWaitlistData(data);
      } catch (e) { /* ignore */ }
    };
    fetchWaitlist();
  }, [isLoggedIn, password, page]);

  // Fetch users (refreshed every 30s for Realtime fallback)
  useEffect(() => {
    if (!isLoggedIn) return;
    const fetchUsers = async () => {
      try {
        const data = await getAdminUsers(password);
        setUsersData(data);
      } catch (e) { /* ignore */ }
    };
    fetchUsers();
    const interval = setInterval(fetchUsers, 30000);
    return () => clearInterval(interval);
  }, [isLoggedIn, password]);

  // Fetch activity
  useEffect(() => {
    if (!isLoggedIn) return;
    const fetchActivity = async () => {
      try {
        const data = await getRecentActivity(activityPage, 20, password);
        setActivityData(data);
      } catch (e) { /* ignore */ }
    };
    fetchActivity();
  }, [isLoggedIn, password, activityPage]);

  // Show toast helper
  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Mode toggle
  const handleToggleMode = async () => {
    if (!modeData) return;
    const nextMode = modeData.mode === "beta" ? "prod" : "beta";
    try {
      await updateAppMode(nextMode, password);
      setModeData({ mode: nextMode });
      showToast(`Modo cambiado a ${nextMode.toUpperCase()}`);
    } catch (err: any) {
      showToast(err.message || "Error al actualizar el modo", "error");
    }
  };

  // Export CSV
  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const blob = await exportWaitlistCsv(password);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "waitlist.csv";
      a.click();
      URL.revokeObjectURL(url);
      showToast("CSV exportado");
    } catch (err: any) {
      showToast(err.message || "Error al exportar CSV", "error");
    } finally {
      setExporting(false);
    }
  };

  // Update user
  const handleUpdateUser = async (userId: string, update: { plan?: string; subscription_status?: string }) => {
    try {
      if (usersData) {
        const updated = usersData.map((u) => {
          if (u.id === userId) {
            return {
              ...u,
              ...(update.plan ? { plan: update.plan } : {}),
              ...(update.subscription_status ? { status: update.subscription_status } : {}),
            };
          }
          return u;
        });
        setUsersData(updated);
      }
      const result = await updateUserStatus(userId, update, password);
      showToast(result?.supabase_sync_ok === false ? "Etiqueta actualizada, pero Supabase falló" : "Usuario actualizado");
    } catch (err: any) {
      showToast(err.message || "Error al actualizar", "error");
    }
  };

  // Filtered + sorted users
  const filteredUsers = useMemo(() => {
    if (!usersData) return [];
    let filtered = usersData;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.slug.toLowerCase().includes(q)
      );
    }
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "oldest": return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "newest": return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case "plan": return (PLAN_ORDER[a.plan] ?? 99) - (PLAN_ORDER[b.plan] ?? 99);
        case "submissions": return (b.total_submissions ?? 0) - (a.total_submissions ?? 0);
        default: return 0;
      }
    });
  }, [usersData, search, sortKey]);

  // ===================== LOGIN SCREEN =====================
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-main)" }}>
        <div className="rounded border p-8 w-80" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
          <div className="text-xs font-mono uppercase tracking-wider text-muted mb-2">Admin Access</div>
          <h1 className="font-display font-semibold text-2xl mb-6">Login</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loginLoading && handleLogin()}
            placeholder="Password"
            disabled={loginLoading}
            className="w-full px-3 py-2 rounded border text-sm mb-3 focus:outline-none focus:border-emerald-500 transition-colors"
            style={{ background: "var(--bg-input)", borderColor: "var(--border)", color: "var(--text-primary)" }}
          />
          {loginError && <p className="text-xs text-red-500 mb-3">{loginError}</p>}
          <button
            onClick={handleLogin}
            disabled={loginLoading}
            className="w-full py-2.5 rounded font-medium text-sm transition-colors cursor-pointer disabled:cursor-wait"
            style={{
              background: loginLoading ? "rgba(16,185,129,0.3)" : "#10b981",
              color: "white",
            }}
          >
            {loginLoading ? "Logging in..." : "Login"}
          </button>
        </div>
      </div>
    );
  }

  const currentMode = modeData?.mode || "beta";
  const waitlistTotal = waitlistData?.total ?? 0;
  const waitlistTotalPages = Math.max(1, Math.ceil(waitlistTotal / perPage));
  const activityTotal = activityData?.total ?? 0;
  const activityTotalPages = Math.max(1, Math.ceil(activityTotal / 20));

  return (
    <div className="max-w-6xl mx-auto px-6 py-12" style={{ background: "var(--bg-main)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="text-xs font-mono uppercase tracking-wider text-muted mb-1">Admin</div>
          <h1 className="font-display font-semibold text-2xl">Dashboard</h1>
          <p className="text-xs text-muted mt-1">True Peak · {currentMode.toUpperCase()}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleToggleMode}
            className="px-3 py-2 rounded border text-xs font-medium transition-colors cursor-pointer"
            style={{ borderColor: "var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)" }}
          >
            {currentMode === "beta" ? "Switch to PROD" : "Switch to BETA"}
          </button>
          <button
            onClick={handleLogout}
            className="px-3 py-2 rounded border text-xs font-medium transition-colors cursor-pointer"
            style={{ borderColor: "var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)" }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="rounded border p-6" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
          <div className="text-xs font-mono uppercase tracking-wider text-muted mb-2">App Mode</div>
          <p className="font-display font-semibold text-2xl">{currentMode.toUpperCase()}</p>
        </div>
        <div className="rounded border p-6" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
          <div className="text-xs font-mono uppercase tracking-wider text-muted mb-2">Waitlist</div>
          <p className="font-display font-semibold text-2xl">{waitlistTotal}</p>
        </div>
        <div className="rounded border p-6" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
          <div className="text-xs font-mono uppercase tracking-wider text-muted mb-2">Users</div>
          <p className="font-display font-semibold text-2xl">{usersData?.length ?? 0}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 mb-6 border-b" style={{ borderColor: "var(--border)" }}>
        {(["waitlist", "users", "activity"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 text-sm font-medium transition-colors cursor-pointer ${
              activeTab === tab
                ? "text-emerald-500 border-b-2 border-emerald-500"
                : "text-muted hover:text-primary"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Waitlist tab */}
      {activeTab === "waitlist" && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-display font-semibold text-lg">Waitlist ({waitlistTotal})</h2>
            <button
              onClick={handleExportCSV}
              disabled={exporting}
              className="px-3 py-1.5 rounded border text-xs font-medium transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-50"
              style={{ borderColor: "var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)" }}
            >
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
          </div>
          <div className="rounded border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <table className="w-full">
              <thead>
                <tr style={{ background: "var(--bg-hover)" }}>
                  <th className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted">Date</th>
                </tr>
              </thead>
              <tbody>
                {waitlistData?.entries.map((entry) => (
                  <tr key={entry.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--text-primary)" }}>{entry.email}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>{entry.source || "—"}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>{new Date(entry.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {(!waitlistData || waitlistData.entries.length === 0) && (
                  <tr><td colSpan={3} className="px-6 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No waitlist entries</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {waitlistTotalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded border text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: "var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)" }}
              >
                Anterior
              </button>
              <span className="px-3 py-1.5 text-xs" style={{ color: "var(--text-muted)" }}>Page {page} of {waitlistTotalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(waitlistTotalPages, p + 1))}
                disabled={page === waitlistTotalPages}
                className="px-3 py-1.5 rounded border text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: "var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)" }}
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      )}

      {/* Users tab */}
      {activeTab === "users" && (
        <div>
          <div className="flex gap-3 mb-4 items-center">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, slug..."
              className="flex-1 px-3 py-2 rounded border text-sm focus:outline-none focus:border-emerald-500 transition-colors"
              style={{ background: "var(--bg-input)", borderColor: "var(--border)", color: "var(--text-primary)" }}
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="px-3 py-2 rounded border text-sm focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
              style={{ background: "var(--bg-input)", borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="plan">Plan</option>
              <option value="submissions">Most Submissions</option>
            </select>
          </div>
          <div className="rounded border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <table className="w-full">
              <thead>
                <tr style={{ background: "var(--bg-hover)" }}>
                  <th className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted">Plan</th>
                  <th className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted">Submissions</th>
                  <th className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: "var(--text-primary)" }}>{user.name}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>{user.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className="px-2.5 py-1 rounded text-xs font-semibold uppercase tracking-wider"
                        style={{
                          background: user.plan === "pro" ? "rgba(16,185,129,0.12)" : user.plan === "indie" ? "rgba(59,130,246,0.12)" : "rgba(161,161,170,0.1)",
                          color: user.plan === "pro" || user.plan === "indie" ? (user.plan === "pro" ? "#10b981" : "#3b82f6") : "var(--text-secondary)",
                        }}
                      >
                        {user.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="px-2.5 py-1 rounded text-xs font-medium"
                        style={{
                          background: user.status === "active" ? "rgba(16,185,129,0.1)" : user.status === "frozen" ? "rgba(234,179,8,0.1)" : "rgba(239,68,68,0.1)",
                          color: user.status === "active" ? "#10b981" : user.status === "frozen" ? "#eab308" : "#ef4444",
                        }}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>{user.total_submissions ?? 0}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>{formatRelativeTime(user.last_submission_at)}</td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Activity tab */}
      {activeTab === "activity" && (
        <div>
          <h2 className="font-display font-semibold text-lg mb-4">Recent Activity ({activityTotal})</h2>
          <div className="rounded border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <table className="w-full">
              <thead>
                <tr style={{ background: "var(--bg-hover)" }}>
                  <th className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted">Producer</th>
                  <th className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted">Track</th>
                  <th className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-mono uppercase tracking-wider text-muted">Date</th>
                </tr>
              </thead>
              <tbody>
                {activityData?.entries.map((entry) => (
                  <tr key={entry.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--text-primary)" }}>{entry.producer_name}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--text-muted)" }}>{entry.track_title}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded text-xs" style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}>{entry.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>{entry.created_at ? new Date(entry.created_at).toLocaleString() : "—"}</td>
                  </tr>
                ))}
                {(!activityData || activityData.entries.length === 0) && (
                  <tr><td colSpan={4} className="px-6 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No recent activity</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {activityTotalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <button
                onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                disabled={activityPage === 1}
                className="px-3 py-1.5 rounded border text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: "var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)" }}
              >
                Anterior
              </button>
              <span className="px-3 py-1.5 text-xs" style={{ color: "var(--text-muted)" }}>Page {activityPage} of {activityTotalPages}</span>
              <button
                onClick={() => setActivityPage((p) => Math.min(activityTotalPages, p + 1))}
                disabled={activityPage === activityTotalPages}
                className="px-3 py-1.5 rounded border text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: "var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)" }}
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-lg border text-sm font-medium shadow-xl z-50 ${
            toast.type === "success"
              ? "bg-emerald-950/80 border-emerald-500/30 text-emerald-300"
              : "bg-red-950/80 border-red-500/30 text-red-300"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
