/**
 * Polar webhook handler — runs on Vercel (HTTPS) and updates plans via backend API.
 *
 * Handles ALL Polar events: subscription lifecycle + order/checkout events.
 * Logs everything for debugging.
 */
import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";

const WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET || "";
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://164.152.194.196:8000";

const PRODUCT_TO_PLAN: Record<string, string> = {
  "400b734f-4dfd-4376-99e5-2bab977cc1fe": "indie",
  "7272cf53-e552-4d24-acbb-d455999803a1": "pro",
};

async function updatePlan(email: string, plan: string, slug?: string) {
  if (slug) {
    console.log(`[Polar Webhook] Calling backend: ${BACKEND_URL}/api/admin/labels/${slug}/plan`);
    const res = await fetch(`${BACKEND_URL}/api/admin/labels/${slug}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Backend ${res.status}: ${err}`);
    }
    return res.json();
  }

  // Fallback to by-email
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

function extractCustomerAndProduct(data: any): { email: string; productId: string; slug: string } {
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

  // Extract custom metadata added in frontend
  const metadata = data.metadata || {};
  const slug = metadata.slug || "";

  return { email: email.toLowerCase().trim(), productId, slug };
}

export async function POST(request: NextRequest) {
  console.log(`[Polar Webhook] === INCOMING REQUEST ===`);
  console.log(`[Polar Webhook] URL: ${request.url}`);
  console.log(`[Polar Webhook] Secret configured: ${!!WEBHOOK_SECRET}`);
  console.log(`[Polar Webhook] Backend URL: ${BACKEND_URL}`);

  const rawBody = await request.text();
  console.log(`[Polar Webhook] Body length: ${rawBody.length}`);

  let data: any;

  if (WEBHOOK_SECRET) {
    const headers = Object.fromEntries(request.headers.entries());
    console.log(`[Polar Webhook] Headers: ${Object.keys(headers).join(", ")}`);
    
    try {
      // standardwebhooks library expects the secret directly if it's already the correctly formatted string (like whsec_...)
      // The previous version was double-encoding it or using a wrong format.
      const webhook = new Webhook(WEBHOOK_SECRET);
      data = webhook.verify(rawBody, headers as Record<string, string>);
      console.log(`[Polar Webhook] SIGNATURE OK`);
    } catch (err: any) {
      console.error(`[Polar Webhook] SIGNATURE FAILED: ${err.message}`);
      return NextResponse.json({ 
        error: "Invalid signature", 
        detail: err.message,
        hint: "Check if POLAR_WEBHOOK_SECRET matches the one in Polar dashboard"
      }, { status: 401 });
    }
  } else {
    console.log(`[Polar Webhook] No secret configured (dev mode)`);
    try {
      data = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }

  const eventType = data.type || "";
  // data.data is where the actual object lives in Polar webhooks
  const payloadData = data.data || data;
  const { email, productId, slug } = extractCustomerAndProduct(payloadData);

  console.log(`[Polar Webhook] Event: ${eventType} | Email: ${email} | Product: ${productId} | Slug: ${slug}`);

  // Log to backend for debugging
  fetch(`${BACKEND_URL}/api/webhook-debug`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: eventType, email, productId, slug, dataKeys: Object.keys(data.data || data) }),
  }).catch(() => {});

  if (!email && !slug) {
    console.log(`[Polar Webhook] No email or slug found`);
    return NextResponse.json({ received: true, skipped: true, reason: "no email or slug" });
  }

  const isUpgradeEvent = ["subscription.created", "subscription.active", "subscription.updated", "order.paid", "order.created", "checkout.completed", "checkout_session.completed"].includes(eventType);

  if (isUpgradeEvent) {
    const plan = PRODUCT_TO_PLAN[productId];
    if (!plan) {
      console.log(`[Polar Webhook] Unknown product: ${productId}`);
      return NextResponse.json({ received: true, skipped: true, reason: `unknown product: ${productId}` });
    }
    try {
      const result = await updatePlan(email, plan, slug);
      console.log(`[Polar Webhook] UPGRADED: ${email} (slug: ${slug}) → ${plan}`);
      return NextResponse.json({ received: true, action: "upgraded", plan, label: result.slug });
    } catch (err: any) {
      console.error(`[Polar Webhook] Backend error: ${err.message}`);
      return NextResponse.json({ error: "Backend update failed", detail: err.message }, { status: 502 });
    }
  }

  const isCancelEvent = ["subscription.canceled", "subscription.revoked", "subscription.unpaid"].includes(eventType);

  if (isCancelEvent) {
    const subData = data.data || {};
    const amount = subData.amount ?? 0;
    const discount = subData.discount;
    const isFullDiscount = discount?.basis_points === 10000;
    if (amount === 0 || isFullDiscount) {
      console.log(`[Polar Webhook] Skipping downgrade: amount=${amount}, fullDiscount=${isFullDiscount}`);
      return NextResponse.json({ received: true, skipped: true, reason: "zero-amount subscription, not downgrading" });
    }
    try {
      await updatePlan(email, "free", slug);
      console.log(`[Polar Webhook] DOWNGRADED: ${email} → free`);
      return NextResponse.json({ received: true, action: "downgraded", plan: "free" });
    } catch (err: any) {
      console.error(`[Polar Webhook] Backend error: ${err.message}`);
      return NextResponse.json({ error: "Backend update failed", detail: err.message }, { status: 502 });
    }
  }

  console.log(`[Polar Webhook] Unhandled event: ${eventType}`);
  return NextResponse.json({ received: true, skipped: true, reason: `unhandled event: ${eventType}` });
}
