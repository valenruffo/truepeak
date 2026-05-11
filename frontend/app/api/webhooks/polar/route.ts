/**
 * Polar webhook handler — runs on Vercel (HTTPS) and updates plans via backend API.
 *
 * Flow:
 *   1. Polar sends POST to https://truepeak.space/api/webhooks/polar
 *   2. This route verifies the signature, extracts email + product ID
 *   3. Calls the backend's /admin/labels/by-email/plan to update the DB
 *
 * Product → Plan mapping must match backend/app/api/polar_webhook.py
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

const WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET || "";
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://164.152.194.196:8000";

const PRODUCT_TO_PLAN: Record<string, string> = {
  "400b734f-4dfd-4376-99e5-2bab977cc1fe": "indie",
  "7272cf53-e552-4d24-acbb-d455999803a1": "pro",
};

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  if (!secret) return true; // Skip in dev
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(signature, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-polar-signature") || "";

  if (!verifySignature(rawBody, signature, WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let data: any;
  try {
    data = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = data.type || "";
  const subscription = data.data || {};
  const customer = subscription.customer || {};
  const product = subscription.product || {};
  const customerEmail = customer.email || "";
  const productId = product.id || "";

  if (!customerEmail) {
    return NextResponse.json({ received: true, skipped: true, reason: "no email" });
  }

  // Handle subscription lifecycle events
  if (["subscription.created", "subscription.active"].includes(eventType)) {
    const plan = PRODUCT_TO_PLAN[productId];
    if (!plan) {
      console.error(`Polar webhook: unknown product ${productId}`);
      return NextResponse.json({ received: true, skipped: true, reason: `unknown product: ${productId}` });
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/labels/by-email/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: customerEmail, plan }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`Backend plan update failed: ${res.status} ${err}`);
        return NextResponse.json({ error: "Backend update failed", detail: err }, { status: 502 });
      }

      const result = await res.json();
      console.log(`Polar webhook: ${customerEmail} → ${plan} (slug: ${result.slug})`);
      return NextResponse.json({ received: true, action: "upgraded", plan, label: result.slug });
    } catch (err) {
      console.error("Backend unreachable:", err);
      return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
    }
  }

  if (eventType === "subscription.updated") {
    const plan = PRODUCT_TO_PLAN[productId];
    if (!plan) {
      return NextResponse.json({ received: true, skipped: true, reason: "unknown product" });
    }
    try {
      await fetch(`${BACKEND_URL}/api/admin/labels/by-email/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: customerEmail, plan }),
      });
      return NextResponse.json({ received: true, action: "updated", plan });
    } catch {
      return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
    }
  }

  if (["subscription.canceled", "subscription.revoked"].includes(eventType)) {
    try {
      await fetch(`${BACKEND_URL}/api/admin/labels/by-email/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: customerEmail, plan: "free" }),
      });
      return NextResponse.json({ received: true, action: "downgraded", plan: "free" });
    } catch {
      return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
    }
  }

  return NextResponse.json({ received: true, skipped: true, reason: `unhandled event: ${eventType}` });
}
