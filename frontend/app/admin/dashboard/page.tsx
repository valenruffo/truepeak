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

const planBadgeClass = (plan: string) => {
  switch (plan) {
    case "indie": return "bg-blue-500/15 border-blue-500/30 text-blue-300";
    case "pro": return "bg-emerald-500/15 border-emerald-500/30 text-emerald-300";
    default: return "bg-zinc-700/40 border-zinc-600/40 text-zinc-300";
  }
};

const statusBadgeClass = (status: string) => {
  switch (status) {
    case "active": return "bg-emerald-500/15 border-emerald-500/30 text-emerald-300";
    case "frozen": return "bg-yellow-500/15 border-yellow-500/30 text-yellow-300";
    case "canceled":
    case "suspended": return "bg-red-500/15 border-red-500/30 text-red-300";
    default: return "bg-zinc-700/40 border-zinc-600/40 text-zinc-300";
  }
};

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
      <div className="min-h-screen bg-[#09090b] text-white flex items-center justify-center font-body">
        <div className="w-80 p-8 bg-[#18181b] rounded-lg border border-zinc-800">
          <h1 className="text-xl font-semibold mb-2">Admin Login</h1>
          <p className="text-xs text-zinc-400 mb-4">Restricted access</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loginLoading && handleLogin()}
            placeholder="Password"
            disabled={loginLoading}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-white rounded-md mb-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
          />
          {loginError && <p className="text-red-500 text-xs mb-2">{loginError}</p>}
          <button
            onClick={handleLogin}
            disabled={loginLoading}
            className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-800 text-white rounded-md font-medium text-sm transition-colors cursor-pointer disabled:cursor-wait"
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
    <div className="min-h-screen bg-[#09090b] text-white font-body p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
          <p className="text-xs text-zinc-400 mt-1">True Peak · {currentMode.toUpperCase()}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleToggleMode}
            className="px-3 py-2 bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-white rounded-md text-xs font-medium transition-colors cursor-pointer"
          >
            {currentMode === "beta" ? "Switch to PROD" : "Switch to BETA"}
          </button>
          <button
            onClick={handleLogout}
            className="px-3 py-2 bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-white rounded-md text-xs font-medium transition-colors cursor-pointer"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="p-4 bg-[#18181b] rounded-lg border border-zinc-800">
          <p className="text-[11px] text-zinc-400 uppercase mb-1">App Mode</p>
          <p className="text-xl font-semibold">{currentMode.toUpperCase()}</p>
        </div>
        <div className="p-4 bg-[#18181b] rounded-lg border border-zinc-800">
          <p className="text-[11px] text-zinc-400 uppercase mb-1">Waitlist</p>
          <p className="text-xl font-semibold">{waitlistTotal}</p>
        </div>
        <div className="p-4 bg-[#18181b] rounded-lg border border-zinc-800">
          <p className="text-[11px] text-zinc-400 uppercase mb-1">Users</p>
          <p className="text-xl font-semibold">{usersData?.length ?? 0}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-zinc-800">
        {(["waitlist", "users", "activity"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
              activeTab === tab
                ? "text-emerald-400 border-b-2 border-emerald-500"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Waitlist tab */}
      {activeTab === "waitlist" && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-base font-semibold">Waitlist ({waitlistTotal})</h2>
            <button
              onClick={handleExportCSV}
              disabled={exporting}
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-white rounded-md text-xs font-medium transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-50"
            >
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
          </div>
          <div className="bg-[#18181b] rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-[#1f1f23]">
                  <th className="px-3 py-3 text-left text-[11px] text-zinc-400 uppercase">Email</th>
                  <th className="px-3 py-3 text-left text-[11px] text-zinc-400 uppercase">Source</th>
                  <th className="px-3 py-3 text-left text-[11px] text-zinc-400 uppercase">Date</th>
                </tr>
              </thead>
              <tbody>
                {waitlistData?.entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-zinc-800">
                    <td className="px-3 py-3 text-sm">{entry.email}</td>
                    <td className="px-3 py-3 text-xs text-zinc-400">{entry.source || "—"}</td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{new Date(entry.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {(!waitlistData || waitlistData.entries.length === 0) && (
                  <tr><td colSpan={3} className="px-6 py-6 text-center text-zinc-500 text-sm">No waitlist entries</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {waitlistTotalPages > 1 && (
            <div className="flex justify-center gap-2 mt-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-white rounded-md text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="px-3 py-1.5 text-xs text-zinc-400">Page {page} of {waitlistTotalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(waitlistTotalPages, p + 1))}
                disabled={page === waitlistTotalPages}
                className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-white rounded-md text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
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
          <div className="flex gap-2 mb-3 items-center">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, slug..."
              className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 text-white rounded-md text-sm focus:outline-none focus:border-emerald-500 transition-colors"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="px-3 py-2 bg-zinc-800 border border-zinc-700 text-white rounded-md text-sm focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="plan">Plan</option>
              <option value="submissions">Most Submissions</option>
            </select>
          </div>
          <div className="bg-[#18181b] rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-[#1f1f23]">
                  <th className="px-3 py-3 text-left text-[11px] text-zinc-400 uppercase">Name</th>
                  <th className="px-3 py-3 text-left text-[11px] text-zinc-400 uppercase">Email</th>
                  <th className="px-3 py-3 text-left text-[11px] text-zinc-400 uppercase">Plan</th>
                  <th className="px-3 py-3 text-left text-[11px] text-zinc-400 uppercase">Status</th>
                  <th className="px-3 py-3 text-left text-[11px] text-zinc-400 uppercase">Submissions</th>
                  <th className="px-3 py-3 text-left text-[11px] text-zinc-400 uppercase">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="border-t border-zinc-800">
                    <td className="px-3 py-3 text-sm font-medium">{user.name}</td>
                    <td className="px-3 py-3 text-sm text-zinc-400">{user.email}</td>
                    <td className="px-3 py-3">
                      <select
                        value={user.plan}
                        onChange={(e) => handleUpdateUser(user.id, { plan: e.target.value })}
                        className={`px-2 py-1 bg-zinc-800 border rounded text-xs cursor-pointer transition-colors ${
                          user.plan === "indie"
                            ? "border-blue-500/50 text-blue-300"
                            : user.plan === "pro"
                            ? "border-emerald-500/50 text-emerald-300"
                            : "border-zinc-700 text-zinc-300"
                        }`}
                      >
                        <option value="free">Free</option>
                        <option value="indie">Indie</option>
                        <option value="pro">Pro</option>
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={user.status}
                        onChange={(e) => handleUpdateUser(user.id, { subscription_status: e.target.value })}
                        className={`px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs cursor-pointer transition-colors ${statusBadgeClass(user.status)}`}
                      >
                        <option value="active">Active</option>
                        <option value="frozen">Frozen</option>
                        <option value="canceled">Canceled</option>
                        <option value="suspended">Suspended</option>
                      </select>
                    </td>
                    <td className="px-3 py-3 text-sm text-zinc-400">{user.total_submissions ?? 0}</td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{formatRelativeTime(user.last_submission_at)}</td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-6 text-center text-zinc-500 text-sm">No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Activity tab */}
      {activeTab === "activity" && (
        <div>
          <h2 className="text-base font-semibold mb-3">Recent Activity ({activityTotal})</h2>
          <div className="bg-[#18181b] rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-[#1f1f23]">
                  <th className="px-3 py-3 text-left text-[11px] text-zinc-400 uppercase">Producer</th>
                  <th className="px-3 py-3 text-left text-[11px] text-zinc-400 uppercase">Track</th>
                  <th className="px-3 py-3 text-left text-[11px] text-zinc-400 uppercase">Status</th>
                  <th className="px-3 py-3 text-left text-[11px] text-zinc-400 uppercase">Date</th>
                </tr>
              </thead>
              <tbody>
                {activityData?.entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-zinc-800">
                    <td className="px-3 py-3 text-sm">{entry.producer_name}</td>
                    <td className="px-3 py-3 text-sm text-zinc-400">{entry.track_title}</td>
                    <td className="px-3 py-3">
                      <span className="px-2 py-1 bg-zinc-800 rounded text-xs text-zinc-400">{entry.status}</span>
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-500">{entry.created_at ? new Date(entry.created_at).toLocaleString() : "—"}</td>
                  </tr>
                ))}
                {(!activityData || activityData.entries.length === 0) && (
                  <tr><td colSpan={4} className="px-6 py-6 text-center text-zinc-500 text-sm">No recent activity</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {activityTotalPages > 1 && (
            <div className="flex justify-center gap-2 mt-3">
              <button
                onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                disabled={activityPage === 1}
                className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-white rounded-md text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="px-3 py-1.5 text-xs text-zinc-400">Page {activityPage} of {activityTotalPages}</span>
              <button
                onClick={() => setActivityPage((p) => Math.min(activityTotalPages, p + 1))}
                disabled={activityPage === activityTotalPages}
                className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-white rounded-md text-xs font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
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
