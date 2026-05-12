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
  if (!secret) {
    console.log("[Polar Webhook] No secret configured, skipping verification");
    return true;
  }

  // Polar may send: "sha256=<hex>" or just "<hex>" or "t=...,s=<hex>"
  let cleanSig = signature;
  if (signature.includes("sha256=")) {
    cleanSig = signature.split("sha256=")[1];
  } else if (signature.includes("s=")) {
    cleanSig = signature.split("s=")[1];
  }
  cleanSig = cleanSig.trim();

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(cleanSig, "hex");
  } catch {
    console.error(`[Polar Webhook] Invalid hex in signature: ${cleanSig.slice(0, 20)}...`);
    return false;
  }

  if (expected.length !== actual.length) {
    console.error(`[Polar Webhook] Signature length mismatch: expected ${expected.length}, got ${actual.length}`);
    return false;
  }

  const result = timingSafeEqual(expected, actual);
  if (!result) {
    console.log(`[Polar Webhook] Signature mismatch. First 8 chars - expected: ${expected.toString("hex").slice(0, 8)}, got: ${cleanSig.slice(0, 8)}`);
  }
  return result;
}

async function updatePlan(email: string, plan: string) {
  console.log(`[Polar Webhook] Calling backend: ${BACKEND_URL}/api/admin/labels/by-email/plan`);
  const res = await fetch(`${BACKEND_URL}/api/admin/labels/by-email/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, plan }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Backend ${res.status}: ${err}`);
  }
  return res.json();
}

function extractCustomerAndProduct(data: any): { email: string; productId: string } {
  // Extract email from any possible Polar field
  const email = 
    data.customer_email || 
    data.user_email || 
    data.customer?.email || 
    data.user?.email || 
    data.email || 
    "";

  // Extract product ID from any possible Polar field
  const productId = 
    data.product_id || 
    data.product?.id || 
    "";

  return { email: email.toLowerCase().trim(), productId };
}

export async function POST(request: NextRequest) {
  console.log(`[Polar Webhook] === INCOMING REQUEST ===`);
  console.log(`[Polar Webhook] URL: ${request.url}`);
  console.log(`[Polar Webhook] Headers: x-polar-signature present: ${!!request.headers.get("x-polar-signature")}`);
  console.log(`[Polar Webhook] Secret configured: ${!!WEBHOOK_SECRET} (prefix: ${WEBHOOK_SECRET ? WEBHOOK_SECRET.slice(0, 12) : "none"})`);
  console.log(`[Polar Webhook] Backend URL: ${BACKEND_URL}`);

  const rawBody = await request.text();
  const signature = request.headers.get("x-polar-signature") || "";

  console.log(`[Polar Webhook] Body length: ${rawBody.length}`);
  console.log(`[Polar Webhook] Signature header: ${signature.slice(0, 20)}...`);

  if (!verifySignature(rawBody, signature, WEBHOOK_SECRET)) {
    console.error(`[Polar Webhook] SIGNATURE VERIFICATION FAILED`);
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
      console.log(`[Polar Webhook] SUCCESS: ${email} → ${plan} (slug: ${result.slug})`);
      return NextResponse.json({ received: true, action: "upgraded", plan, label: result.slug });
    } catch (err: any) {
      console.error(`[Polar Webhook] Backend error:`, err.message);
      return NextResponse.json({ error: "Backend update failed", detail: err.message }, { status: 502 });
    }
  }

  // Order paid events
  if (["order.paid", "order.created"].includes(eventType)) {
    const plan = PRODUCT_TO_PLAN[productId];
    if (!plan) {
      console.log(`[Polar Webhook] Unknown product in order: ${productId}`);
      return NextResponse.json({ received: true, skipped: true, reason: `unknown product: ${productId}` });
    }
    try {
      const result = await updatePlan(email, plan);
      console.log(`[Polar Webhook] Order SUCCESS: ${email} → ${plan}`);
      return NextResponse.json({ received: true, action: "upgraded", plan, label: result.slug });
    } catch (err: any) {
      console.error(`[Polar Webhook] Backend error:`, err.message);
      return NextResponse.json({ error: "Backend update failed", detail: err.message }, { status: 502 });
    }
  }

  // Checkout session completed
  if (["checkout.completed", "checkout_session.completed"].includes(eventType)) {
    const plan = PRODUCT_TO_PLAN[productId];
    if (!plan) {
      console.log(`[Polar Webhook] Unknown product in checkout: ${productId}`);
      return NextResponse.json({ received: true, skipped: true, reason: `unknown product: ${productId}` });
    }
    try {
      const result = await updatePlan(email, plan);
      console.log(`[Polar Webhook] Checkout SUCCESS: ${email} → ${plan}`);
      return NextResponse.json({ received: true, action: "upgraded", plan, label: result.slug });
    } catch (err: any) {
      console.error(`[Polar Webhook] Backend error:`, err.message);
      return NextResponse.json({ error: "Backend update failed", detail: err.message }, { status: 502 });
    }
  }

  // Cancellation events — only downgrade if subscription was actually paid
  if (["subscription.canceled", "subscription.revoked", "subscription.unpaid"].includes(eventType)) {
    const subData = data.data || {};
    const amount = subData.amount ?? 0;
    const discount = subData.discount;
    const isFullDiscount = discount?.basis_points === 10000;

    if (amount === 0 || isFullDiscount) {
      console.log(`[Polar Webhook] Skipping downgrade: amount=${amount}, fullDiscount=${isFullDiscount}`);
      return NextResponse.json({ received: true, skipped: true, reason: "zero-amount subscription, not downgrading" });
    }

    try {
      await updatePlan(email, "free");
      console.log(`[Polar Webhook] Downgrade SUCCESS: ${email} → free`);
      return NextResponse.json({ received: true, action: "downgraded", plan: "free" });
    } catch (err: any) {
      console.error(`[Polar Webhook] Backend error:`, err.message);
      return NextResponse.json({ error: "Backend update failed", detail: err.message }, { status: 502 });
    }
  }

  console.log(`[Polar Webhook] Unhandled event: ${eventType}`);
  return NextResponse.json({ received: true, skipped: true, reason: `unhandled event: ${eventType}` });
}
