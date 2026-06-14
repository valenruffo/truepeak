"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { motion, AnimatePresence } from "framer-motion";
import { getAppMode, updateAppMode, getWaitlist, exportWaitlistCsv, WaitlistEntry } from "@/lib/api";

export default function AdminDashboard() {
  const [password, setPassword] = useState<string>("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  
  // Dashboard state
  const [page, setPage] = useState(1);
  const perPage = 15;
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [exporting, setExporting] = useState(false);

  // Load password from sessionStorage if exists
  useEffect(() => {
    const savedPassword = sessionStorage.getItem("admin_password");
    if (savedPassword) {
      setPassword(savedPassword);
      setIsLoggedIn(true);
    }
  }, []);

  // Fetch App Mode (public, but admin can toggle it)
  const { data: modeData, mutate: mutateMode } = useSWR("/api/config/app-mode", getAppMode, {
    revalidateOnFocus: true,
  });
  const currentMode = modeData?.mode || "beta";

  // Fetch Waitlist Entries (requires password)
  const { data: waitlistData, error: waitlistError, mutate: mutateWaitlist } = useSWR(
    isLoggedIn && password ? ["/api/admin/waitlist", page, password] : null,
    () => getWaitlist(password, page, perPage),
    {
      revalidateOnFocus: true,
      errorRetryCount: 1,
    }
  );

  // Handle wrong session storage password
  useEffect(() => {
    if (waitlistError && waitlistError.status === 401) {
      sessionStorage.removeItem("admin_password");
      setIsLoggedIn(false);
      setLoginError("Sesión expirada o contraseña incorrecta");
    }
  }, [waitlistError]);

  // Show auto-dismissing toast
  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoginLoading(true);
    setLoginError("");

    try {
      // Validate password by calling the waitlist endpoint
      await getWaitlist(password, 1, 1);
      sessionStorage.setItem("admin_password", password);
      setIsLoggedIn(true);
    } catch (err: any) {
      setLoginError(err.message || "Contraseña incorrecta o error de conexión");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("admin_password");
    setPassword("");
    setIsLoggedIn(false);
  };

  const handleToggleMode = async () => {
    const nextMode = currentMode === "beta" ? "prod" : "beta";
    try {
      await updateAppMode(nextMode, password);
      mutateMode({ mode: nextMode }, false);
      showToast(`Modo cambiado a ${nextMode.toUpperCase()} correctamente.`);
    } catch (err: any) {
      showToast(err.message || "Error al actualizar el modo", "error");
    }
  };

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const blob = await exportWaitlistCsv(password);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showToast("Lista exportada a CSV.");
    } catch (err: any) {
      showToast(err.message || "Error al exportar CSV", "error");
    } finally {
      setExporting(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-6 text-white font-sans">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md p-8 rounded-xl border border-zinc-800 bg-zinc-950/60 backdrop-blur-md shadow-2xl"
        >
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-white mb-1">True Peak</h1>
            <p className="text-sm text-zinc-400">Portal de Administración</p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 mb-2">
                Contraseña de Administrador
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2.5 rounded bg-zinc-900 border border-zinc-800 text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors font-mono text-center"
              />
            </div>

            {loginError && <p className="text-xs text-red-500 text-center">{loginError}</p>}

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold rounded disabled:opacity-50 transition-colors cursor-pointer"
            >
              {loginLoading ? "Verificando..." : "Ingresar"}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  const entries: WaitlistEntry[] = waitlistData?.entries || [];
  const totalEntries = waitlistData?.total || 0;
  const totalPages = Math.ceil(totalEntries / perPage) || 1;

  return (
    <div className="min-h-screen bg-[#09090b] text-white font-sans p-6 md:p-8">
      {/* Toast Alert */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -20, x: "-50%" }}
            className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-lg border text-sm shadow-xl font-medium flex items-center gap-2 ${
              toast.type === "success"
                ? "bg-emerald-950/80 border-emerald-500/30 text-emerald-300"
                : "bg-red-950/80 border-red-500/30 text-red-300"
            }`}
          >
            {toast.type === "success" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            )}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">True Peak</h1>
            <p className="text-xs text-zinc-400 font-mono uppercase tracking-wider">Dashboard de Administración</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 text-xs border border-zinc-800 bg-zinc-950/40 rounded text-zinc-400 hover:text-white hover:border-zinc-700 transition-all cursor-pointer"
          >
            Cerrar Sesión
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid md:grid-cols-3 gap-4">
          {/* Mode Switch Card */}
          <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-950/30 backdrop-blur-md flex flex-col justify-between min-h-[140px]">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">Modo de Aplicación</span>
              <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                {currentMode === "beta" 
                  ? "BETA: Captura emails de waitlist en los 3 planes."
                  : "PROD: Redirige directamente al checkout de Polar."}
              </p>
            </div>
            <div className="flex items-center justify-between mt-4">
              <span className="font-mono text-sm font-semibold uppercase text-emerald-400">
                {currentMode.toUpperCase()}
              </span>
              <button
                onClick={handleToggleMode}
                className="px-4 py-2 text-xs font-semibold rounded bg-zinc-900 border border-zinc-800 hover:border-emerald-500/50 hover:bg-zinc-800 transition-all cursor-pointer text-white flex items-center gap-1.5"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                </svg>
                Cambiar Modo
              </button>
            </div>
          </div>

          {/* Waitlist Count Card */}
          <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-950/30 backdrop-blur-md flex flex-col justify-between min-h-[140px]">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">Emails Registrados</span>
              <h2 className="text-4xl font-bold tracking-tight text-emerald-400 mt-2">{totalEntries}</h2>
            </div>
            <div className="text-xs text-zinc-500">Waitlist total activa</div>
          </div>

          {/* Export Actions Card */}
          <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-950/30 backdrop-blur-md flex flex-col justify-between min-h-[140px]">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">Acciones de Datos</span>
              <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                Descarga un reporte CSV ordenado cronológicamente con todos los contactos de la waitlist.
              </p>
            </div>
            <button
              onClick={handleExportCSV}
              disabled={exporting || totalEntries === 0}
              className="w-full mt-4 py-2 text-xs font-semibold rounded bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {exporting ? (
                "Exportando..."
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                  </svg>
                  Exportar CSV
                </>
              )}
            </button>
          </div>
        </div>

        {/* Waitlist Data Table Card */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 overflow-hidden shadow-lg">
          <div className="p-5 border-b border-zinc-800 bg-zinc-950/40 flex items-center justify-between">
            <h3 className="font-semibold text-sm tracking-tight text-white">Lista de Contactos</h3>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-850">
              Pág. {page} de {totalPages}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-350">
              <thead className="text-xs font-mono uppercase tracking-wider bg-zinc-950/50 border-b border-zinc-800/80 text-zinc-500">
                <tr>
                  <th className="py-3.5 px-6 font-semibold">Email</th>
                  <th className="py-3.5 px-6 font-semibold">Fecha de Registro</th>
                  <th className="py-3.5 px-6 font-semibold">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-850 bg-zinc-950/10">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-12 text-center text-zinc-550 font-medium">
                      No hay registros en la waitlist aún.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-zinc-900/30 transition-colors">
                      <td className="py-4 px-6 font-medium text-white">{entry.email}</td>
                      <td className="py-4 px-6 text-zinc-400">
                        {entry.created_at 
                          ? new Date(entry.created_at).toLocaleString("es-AR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "-"}
                      </td>
                      <td className="py-4 px-6">
                        <span className="text-xs font-mono bg-zinc-900 text-emerald-400/80 px-2 py-0.5 rounded border border-emerald-950">
                          {entry.source}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Table Pagination Footer */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-zinc-800/60 bg-zinc-950/40 flex items-center justify-between">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs font-semibold rounded border border-zinc-800 hover:border-zinc-700 disabled:opacity-30 disabled:hover:border-zinc-800 text-zinc-400 hover:text-white transition-all cursor-pointer"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs font-semibold rounded border border-zinc-800 hover:border-zinc-700 disabled:opacity-30 disabled:hover:border-zinc-800 text-zinc-400 hover:text-white transition-all cursor-pointer"
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
