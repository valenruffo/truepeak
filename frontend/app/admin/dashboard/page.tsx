"use client";

import { useState, useEffect } from "react";
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
      <div style={{ minHeight: "100vh", background: "#09090b", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
        <div style={{ width: 320, padding: 32, background: "#18181b", borderRadius: 8, border: "1px solid #27272a" }}>
          <h1 style={{ marginBottom: 8, fontSize: 20, fontWeight: 600 }}>Admin Login</h1>
          <p style={{ marginBottom: 16, fontSize: 12, color: "#a1a1aa" }}>Restricted access</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loginLoading && handleLogin()}
            placeholder="Password"
            disabled={loginLoading}
            style={{ width: "100%", padding: "8px 12px", background: "#27272a", border: "1px solid #3f3f46", color: "white", borderRadius: 6, marginBottom: 8, fontSize: 14 }}
          />
          {loginError && <p style={{ color: "#ef4444", fontSize: 12, marginBottom: 8 }}>{loginError}</p>}
          <button onClick={handleLogin} disabled={loginLoading} style={{ width: "100%", padding: "10px", background: loginLoading ? "#065f46" : "#10b981", color: "white", border: "none", borderRadius: 6, cursor: loginLoading ? "wait" : "pointer", fontWeight: 500, fontSize: 14 }}>
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
    <div style={{ minHeight: "100vh", background: "#09090b", color: "white", fontFamily: "system-ui", padding: "24px 32px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Admin Dashboard</h1>
          <p style={{ fontSize: 12, color: "#a1a1aa", margin: "4px 0 0" }}>True Peak · {currentMode.toUpperCase()}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleToggleMode} style={{ padding: "8px 12px", background: "#27272a", border: "1px solid #3f3f46", color: "white", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
            {currentMode === "beta" ? "Switch to PROD" : "Switch to BETA"}
          </button>
          <button onClick={handleLogout} style={{ padding: "8px 12px", background: "#27272a", border: "1px solid #3f3f46", color: "white", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
            Logout
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
        <div style={{ padding: 16, background: "#18181b", borderRadius: 8, border: "1px solid #27272a" }}>
          <p style={{ fontSize: 11, color: "#a1a1aa", margin: 0, textTransform: "uppercase" }}>App Mode</p>
          <p style={{ fontSize: 20, fontWeight: 600, margin: "4px 0 0" }}>{currentMode.toUpperCase()}</p>
        </div>
        <div style={{ padding: 16, background: "#18181b", borderRadius: 8, border: "1px solid #27272a" }}>
          <p style={{ fontSize: 11, color: "#a1a1aa", margin: 0, textTransform: "uppercase" }}>Waitlist</p>
          <p style={{ fontSize: 20, fontWeight: 600, margin: "4px 0 0" }}>{waitlistTotal}</p>
        </div>
        <div style={{ padding: 16, background: "#18181b", borderRadius: 8, border: "1px solid #27272a" }}>
          <p style={{ fontSize: 11, color: "#a1a1aa", margin: 0, textTransform: "uppercase" }}>Users</p>
          <p style={{ fontSize: 20, fontWeight: 600, margin: "4px 0 0" }}>{usersData?.length ?? 0}</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #27272a" }}>
        {(["waitlist", "users", "activity"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "10px 16px",
              background: "transparent",
              border: "none",
              color: activeTab === tab ? "#10b981" : "#a1a1aa",
              borderBottom: activeTab === tab ? "2px solid #10b981" : "2px solid transparent",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: activeTab === tab ? 600 : 400,
              textTransform: "capitalize",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Waitlist tab */}
      {activeTab === "waitlist" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Waitlist ({waitlistTotal})</h2>
            <button onClick={handleExportCSV} disabled={exporting} style={{ padding: "6px 12px", background: "#27272a", border: "1px solid #3f3f46", color: "white", borderRadius: 6, cursor: exporting ? "wait" : "pointer", fontSize: 12 }}>
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
          </div>
          <div style={{ background: "#18181b", borderRadius: 8, border: "1px solid #27272a", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#1f1f23" }}>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 11, color: "#a1a1aa", textTransform: "uppercase" }}>Name</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 11, color: "#a1a1aa", textTransform: "uppercase" }}>Email</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 11, color: "#a1a1aa", textTransform: "uppercase" }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {waitlistData?.entries.map((entry) => (
                  <tr key={entry.id} style={{ borderTop: "1px solid #27272a" }}>
                    <td style={{ padding: 12, fontSize: 13 }}>{entry.name || "—"}</td>
                    <td style={{ padding: 12, fontSize: 13, color: "#a1a1aa" }}>{entry.email}</td>
                    <td style={{ padding: 12, fontSize: 12, color: "#71717a" }}>{new Date(entry.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {(!waitlistData || waitlistData.entries.length === 0) && (
                  <tr><td colSpan={3} style={{ padding: 24, textAlign: "center", color: "#71717a", fontSize: 13 }}>No waitlist entries</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {waitlistTotalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: "6px 12px", background: "#27272a", border: "1px solid #3f3f46", color: "white", borderRadius: 6, cursor: page === 1 ? "not-allowed" : "pointer", opacity: page === 1 ? 0.5 : 1, fontSize: 12 }}>Anterior</button>
              <span style={{ padding: "6px 12px", fontSize: 12, color: "#a1a1aa" }}>Page {page} of {waitlistTotalPages}</span>
              <button onClick={() => setPage((p) => Math.min(waitlistTotalPages, p + 1))} disabled={page === waitlistTotalPages} style={{ padding: "6px 12px", background: "#27272a", border: "1px solid #3f3f46", color: "white", borderRadius: 6, cursor: page === waitlistTotalPages ? "not-allowed" : "pointer", opacity: page === waitlistTotalPages ? 0.5 : 1, fontSize: 12 }}>Siguiente</button>
            </div>
          )}
        </div>
      )}

      {/* Users tab */}
      {activeTab === "users" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, slug..."
              style={{ flex: 1, padding: "8px 12px", background: "#27272a", border: "1px solid #3f3f46", color: "white", borderRadius: 6, fontSize: 13 }}
            />
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={{ padding: "8px 12px", background: "#27272a", border: "1px solid #3f3f46", color: "white", borderRadius: 6, fontSize: 13 }}>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="plan">Plan</option>
              <option value="submissions">Most Submissions</option>
            </select>
          </div>
          <div style={{ background: "#18181b", borderRadius: 8, border: "1px solid #27272a", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#1f1f23" }}>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 11, color: "#a1a1aa", textTransform: "uppercase" }}>Name</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 11, color: "#a1a1aa", textTransform: "uppercase" }}>Email</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 11, color: "#a1a1aa", textTransform: "uppercase" }}>Plan</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 11, color: "#a1a1aa", textTransform: "uppercase" }}>Status</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 11, color: "#a1a1aa", textTransform: "uppercase" }}>Submissions</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 11, color: "#a1a1aa", textTransform: "uppercase" }}>Last Active</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id} style={{ borderTop: "1px solid #27272a" }}>
                    <td style={{ padding: 12, fontSize: 13, fontWeight: 500 }}>{user.name}</td>
                    <td style={{ padding: 12, fontSize: 13, color: "#a1a1aa" }}>{user.email}</td>
                    <td style={{ padding: 12 }}>
                      <select
                        value={user.plan}
                        onChange={(e) => handleUpdateUser(user.id, { plan: e.target.value })}
                        style={{ padding: "4px 8px", background: "#27272a", border: `1px solid ${user.plan === "indie" ? "#3b82f6" : user.plan === "pro" ? "#10b981" : "#3f3f46"}`, color: user.plan === "indie" ? "#93c5fd" : user.plan === "pro" ? "#6ee7b7" : "#d4d4d8", borderRadius: 4, fontSize: 12, cursor: "pointer" }}
                      >
                        <option value="free">Free</option>
                        <option value="indie">Indie</option>
                        <option value="pro">Pro</option>
                      </select>
                    </td>
                    <td style={{ padding: 12 }}>
                      <select
                        value={user.status}
                        onChange={(e) => handleUpdateUser(user.id, { subscription_status: e.target.value })}
                        style={{ padding: "4px 8px", background: "#27272a", border: "1px solid #3f3f46", color: "white", borderRadius: 4, fontSize: 12, cursor: "pointer" }}
                      >
                        <option value="active">Active</option>
                        <option value="frozen">Frozen</option>
                        <option value="canceled">Canceled</option>
                        <option value="suspended">Suspended</option>
                      </select>
                    </td>
                    <td style={{ padding: 12, fontSize: 13, color: "#a1a1aa" }}>{user.total_submissions ?? 0}</td>
                    <td style={{ padding: 12, fontSize: 12, color: "#71717a" }}>{formatRelativeTime(user.last_submission_at)}</td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#71717a", fontSize: 13 }}>No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Activity tab */}
      {activeTab === "activity" && (
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>Recent Activity ({activityTotal})</h2>
          <div style={{ background: "#18181b", borderRadius: 8, border: "1px solid #27272a", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#1f1f23" }}>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 11, color: "#a1a1aa", textTransform: "uppercase" }}>Producer</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 11, color: "#a1a1aa", textTransform: "uppercase" }}>Track</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 11, color: "#a1a1aa", textTransform: "uppercase" }}>Status</th>
                  <th style={{ padding: 12, textAlign: "left", fontSize: 11, color: "#a1a1aa", textTransform: "uppercase" }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {activityData?.entries.map((entry) => (
                  <tr key={entry.id} style={{ borderTop: "1px solid #27272a" }}>
                    <td style={{ padding: 12, fontSize: 13 }}>{entry.producer_name}</td>
                    <td style={{ padding: 12, fontSize: 13, color: "#a1a1aa" }}>{entry.track_title}</td>
                    <td style={{ padding: 12, fontSize: 12 }}>
                      <span style={{ padding: "2px 8px", background: "#27272a", borderRadius: 4, color: "#a1a1aa" }}>{entry.status}</span>
                    </td>
                    <td style={{ padding: 12, fontSize: 12, color: "#71717a" }}>{entry.created_at ? new Date(entry.created_at).toLocaleString() : "—"}</td>
                  </tr>
                ))}
                {(!activityData || activityData.entries.length === 0) && (
                  <tr><td colSpan={4} style={{ padding: 24, textAlign: "center", color: "#71717a", fontSize: 13 }}>No recent activity</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {activityTotalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
              <button onClick={() => setActivityPage((p) => Math.max(1, p - 1))} disabled={activityPage === 1} style={{ padding: "6px 12px", background: "#27272a", border: "1px solid #3f3f46", color: "white", borderRadius: 6, cursor: activityPage === 1 ? "not-allowed" : "pointer", opacity: activityPage === 1 ? 0.5 : 1, fontSize: 12 }}>Anterior</button>
              <span style={{ padding: "6px 12px", fontSize: 12, color: "#a1a1aa" }}>Page {activityPage} of {activityTotalPages}</span>
              <button onClick={() => setActivityPage((p) => Math.min(activityTotalPages, p + 1))} disabled={activityPage === activityTotalPages} style={{ padding: "6px 12px", background: "#27272a", border: "1px solid #3f3f46", color: "white", borderRadius: 6, cursor: activityPage === activityTotalPages ? "not-allowed" : "pointer", opacity: activityPage === activityTotalPages ? 0.5 : 1, fontSize: 12 }}>Siguiente</button>
            </div>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)", padding: "12px 20px", background: toast.type === "success" ? "#064e3b" : "#7f1d1d", border: `1px solid ${toast.type === "success" ? "#10b981" : "#ef4444"}`, color: "white", borderRadius: 8, fontSize: 13, fontWeight: 500, zIndex: 100, boxShadow: "0 10px 25px rgba(0,0,0,0.5)" }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
