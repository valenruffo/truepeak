/**
 * Polar webhook handler — runs on Vercel (HTTPS) and updates plans via backend API.
 *
 * Handles ALL Polar events: subscription lifecycle + order/checkout events.
 * Logs everything for debugging.
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
  if (!secret) return true;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(signature, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

async function updatePlan(email: string, plan: string) {
  const res = await fetch(`${BACKEND_URL}/api/admin/labels/by-email/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, plan }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Backend ${res.status}: ${err}`);
  }
  return res.json();
}

function extractCustomerAndProduct(data: any): { email: string; productId: string } {
  // Standard subscription structure
  if (data.customer?.email) {
    return { email: data.customer.email, productId: data.product?.id || "" };
  }
  // Order structure
  if (data.customer_email) {
    return { email: data.customer_email, productId: data.product_id || "" };
  }
  // Checkout session structure
  if (data.customer?.email) {
    return { email: data.customer.email, productId: data.product?.id || "" };
  }
  return { email: "", productId: "" };
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
  const { email, productId } = extractCustomerAndProduct(data.data || data);

  console.log(`[Polar Webhook] Event: ${eventType} | Email: ${email} | Product: ${productId}`);

  if (!email) {
    console.log(`[Polar Webhook] No email found in payload`);
    return NextResponse.json({ received: true, skipped: true, reason: "no email" });
  }

  // Subscription events
  if (["subscription.created", "subscription.active", "subscription.updated"].includes(eventType)) {
    const plan = PRODUCT_TO_PLAN[productId];
    if (!plan) {
      console.log(`[Polar Webhook] Unknown product: ${productId}`);
      return NextResponse.json({ received: true, skipped: true, reason: `unknown product: ${productId}` });
    }
    try {
      const result = await updatePlan(email, plan);
      console.log(`[Polar Webhook] ${email} → ${plan} (slug: ${result.slug})`);
      return NextResponse.json({ received: true, action: "upgraded", plan, label: result.slug });
    } catch (err) {
      console.error(`[Polar Webhook] Backend error:`, err);
      return NextResponse.json({ error: "Backend update failed" }, { status: 502 });
    }
  }

  // Order paid events (happens with 100% discount coupons)
  if (["order.paid", "order.created"].includes(eventType)) {
    const plan = PRODUCT_TO_PLAN[productId];
    if (!plan) {
      console.log(`[Polar Webhook] Unknown product in order: ${productId}`);
      return NextResponse.json({ received: true, skipped: true, reason: `unknown product: ${productId}` });
    }
    try {
      const result = await updatePlan(email, plan);
      console.log(`[Polar Webhook] Order ${email} → ${plan} (slug: ${result.slug})`);
      return NextResponse.json({ received: true, action: "upgraded", plan, label: result.slug });
    } catch (err) {
      console.error(`[Polar Webhook] Backend error:`, err);
      return NextResponse.json({ error: "Backend update failed" }, { status: 502 });
    }
  }

  // Checkout session completed
  if (eventType === "checkout_session.completed") {
    const plan = PRODUCT_TO_PLAN[productId];
    if (!plan) {
      console.log(`[Polar Webhook] Unknown product in checkout: ${productId}`);
      return NextResponse.json({ received: true, skipped: true, reason: `unknown product: ${productId}` });
    }
    try {
      const result = await updatePlan(email, plan);
      console.log(`[Polar Webhook] Checkout ${email} → ${plan} (slug: ${result.slug})`);
      return NextResponse.json({ received: true, action: "upgraded", plan, label: result.slug });
    } catch (err) {
      console.error(`[Polar Webhook] Backend error:`, err);
      return NextResponse.json({ error: "Backend update failed" }, { status: 502 });
    }
  }

  // Cancellation events — only downgrade if subscription was actually paid
  if (["subscription.canceled", "subscription.revoked", "subscription.unpaid"].includes(eventType)) {
    const subData = data.data || {};
    const amount = subData.amount ?? 0;
    const discount = subData.discount;
    const isFullDiscount = discount?.basis_points === 10000;

    // Skip downgrade for zero-amount subscriptions (100% discount test coupons)
    if (amount === 0 || isFullDiscount) {
      console.log(`[Polar Webhook] Skipping downgrade: amount=${amount}, fullDiscount=${isFullDiscount}`);
      return NextResponse.json({ received: true, skipped: true, reason: "zero-amount subscription, not downgrading" });
    }

    try {
      await updatePlan(email, "free");
      console.log(`[Polar Webhook] ${email} → free (paid subscription revoked)`);
      return NextResponse.json({ received: true, action: "downgraded", plan: "free" });
    } catch (err) {
      console.error(`[Polar Webhook] Backend error:`, err);
      return NextResponse.json({ error: "Backend update failed" }, { status: 502 });
    }
  }

  console.log(`[Polar Webhook] Unhandled event: ${eventType}`);
  return NextResponse.json({ received: true, skipped: true, reason: `unhandled event: ${eventType}` });
}
