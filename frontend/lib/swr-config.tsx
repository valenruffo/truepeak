"use client";

/**
 * SWR configuration for the True Peak dashboard.
 *
 * Centralizes data fetching with:
 * - Authenticated fetcher (reads JWT from Supabase session or localStorage)
 * - Stale-while-revalidate caching
 * - Request deduplication (5s window)
 * - Reconnect revalidation
 *
 * Wrap any client tree with <SWRProvider> to inherit these settings.
 */

import { ReactNode } from "react";
import { SWRConfig } from "swr";
import { supabase } from "@/lib/supabase";

/**
 * Authenticated fetcher. Reads the freshest JWT available and injects
 * it as `Authorization: Bearer <token>`. Reads Supabase session first
 * (for token refresh scenarios) and falls back to localStorage.
 */
export const fetcher = async (url: string) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Prefer the live Supabase session so we always get a refreshed token.
  if (typeof window !== "undefined") {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token || localStorage.getItem("token");
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        // Mirror to localStorage so other code paths (non-SWR) stay in sync.
        localStorage.setItem("token", token);
      }
    } catch {
      const token = localStorage.getItem("token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const res = await fetch(url, {
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    const err = new Error(
      `[SWR] ${res.status} ${res.statusText} on ${url}`
    ) as Error & { status?: number; info?: unknown };
    err.status = res.status;
    try {
      err.info = await res.json();
    } catch {
      err.info = null;
    }
    throw err;
  }

  return res.json();
};

/**
 * Default SWR config used across the dashboard.
 *
 * - revalidateOnFocus: false — prevents redundant refetches when the user
 *   alt-tabs back to the dashboard (typical A&R workflow).
 * - dedupingInterval: 5000 — collapses identical concurrent requests for 5s.
 * - revalidateOnReconnect: true — refreshes on network return (useful when
 *   producers upload a demo and the label reconnects).
 * - refreshInterval: 0 — no polling. We trigger refreshes explicitly via
 *   `mutate()` after mutations to keep the cache authoritative.
 * - shouldRetryOnError: true, errorRetryCount: 2 — handles transient
 *   network blips gracefully.
 */
export const swrConfig = {
  fetcher,
  revalidateOnFocus: false,
  dedupingInterval: 5000,
  revalidateOnReconnect: true,
  refreshInterval: 0,
  shouldRetryOnError: true,
  errorRetryCount: 2,
};

export function SWRProvider({ children }: { children: ReactNode }) {
  return <SWRConfig value={swrConfig}>{children}</SWRConfig>;
}
