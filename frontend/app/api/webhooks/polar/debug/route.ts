/**
 * Debug endpoint — test webhook connectivity and backend reachability.
 * GET: test backend connectivity
 * POST: same as webhook handler but logs everything
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

const WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET || "";
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://164.152.194.196:8000";

export async function GET() {
  const results: Record<string, any> = {};

  // Test 1: Check env vars
  results.env = {
    WEBHOOK_SECRET_CONFIGURED: !!WEBHOOK_SECRET,
    WEBHOOK_SECRET_PREFIX: WEBHOOK_SECRET ? WEBHOOK_SECRET.slice(0, 12) + "..." : "not set",
    BACKEND_URL,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    VERCEL_URL: process.env.VERCEL_URL,
  };

  // Test 2: Backend connectivity
  try {
    const start = Date.now();
    const res = await fetch(`${BACKEND_URL}/api/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    results.backend = {
      reachable: true,
      status: res.status,
      responseTime: `${Date.now() - start}ms`,
    };
  } catch (err: any) {
    results.backend = {
      reachable: false,
      error: err.message,
    };
  }

  // Test 3: Backend admin endpoint
  try {
    const start = Date.now();
    const res = await fetch(`${BACKEND_URL}/api/admin/labels/by-email/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@truepeak.space", plan: "free" }),
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    results.adminEndpoint = {
      reachable: res.ok,
      status: res.status,
      responseTime: `${Date.now() - start}ms`,
      body: text.slice(0, 200),
    };
  } catch (err: any) {
    results.adminEndpoint = {
      reachable: false,
      error: err.message,
    };
  }

  return NextResponse.json(results);
}
