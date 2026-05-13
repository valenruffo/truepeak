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
  console.log(`[Polar Webhook] Secret configured: ${!!WEBHOOK_SECRET} (prefix: ${WEBHOOK_SECRET ? WEBHOOK_SECRET.slice(0, 12) : "none"})`);
  console.log(`[Polar Webhook] Backend URL: ${BACKEND_URL}`);

  const rawBody = await request.text();
  console.log(`[Polar Webhook] Body length: ${rawBody.length}`);

  let data: any;

  if (WEBHOOK_SECRET) {
    const headers = Object.fromEntries(request.headers.entries());
    console.log(`[Polar Webhook] Headers keys: ${Object.keys(headers).join(", ")}`);
    
    try {
      // Use standardwebhooks to verify signature without strict Polar Zod schemas
      const base64Secret = Buffer.from(WEBHOOK_SECRET, "utf-8").toString("base64");
      const webhook = new Webhook(base64Secret);
      data = webhook.verify(rawBody, headers as Record<string, string>);
      console.log(`[Polar Webhook] SIGNATURE VERIFICATION SUCCESS`);
      
      // Log full payload to backend for inspection
      fetch(`${BACKEND_URL}/api/admin/webhook-debug`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: eventType, data }),
      }).catch(console.error);

    } catch (err: any) {
      console.error(`[Polar Webhook] SIGNATURE VERIFICATION FAILED: ${err.message}`);
      return NextResponse.json({ error: "Invalid signature", detail: err.message }, { status: 401 });
    }
  } else {
    console.log(`[Polar Webhook] No secret configured, skipping verification (Development Mode)`);
    try {
      data = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  }

  const eventType = data.type || "";
  const { email, productId, slug } = extractCustomerAndProduct(data.data || data);

  console.log(`[Polar Webhook] Event: ${eventType} | Email: ${email} | Product: ${productId} | Slug: ${slug}`);

  if (!email && !slug) {
    console.log(`[Polar Webhook] No email or slug found in payload`);
    return NextResponse.json({ received: true, skipped: true, reason: "no email or slug" });
  }

  // Subscription events
  if (["subscription.created", "subscription.active", "subscription.updated"].includes(eventType)) {
    const plan = PRODUCT_TO_PLAN[productId];
    if (!plan) {
      console.log(`[Polar Webhook] Unknown product: ${productId}`);
      return NextResponse.json({ received: true, skipped: true, reason: `unknown product: ${productId}` });
    }
    try {
      const result = await updatePlan(email, plan, slug);
      console.log(`[Polar Webhook] SUCCESS: ${email} (slug: ${slug}) → ${plan} (updated: ${result.slug})`);
      
      // Log to debug endpoint
      fetch(`${BACKEND_URL}/api/admin/webhook-debug`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: eventType, email, plan, slug, result }),
      }).catch(console.error);

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
      const result = await updatePlan(email, plan, slug);
      console.log(`[Polar Webhook] Order SUCCESS: ${email} (slug: ${slug}) → ${plan}`);
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
      const result = await updatePlan(email, plan, slug);
      console.log(`[Polar Webhook] Checkout SUCCESS: ${email} (slug: ${slug}) → ${plan}`);
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
      await updatePlan(email, "free", slug);
      console.log(`[Polar Webhook] Downgrade SUCCESS: ${email} (slug: ${slug}) → free`);
      return NextResponse.json({ received: true, action: "downgraded", plan: "free" });
    } catch (err: any) {
      console.error(`[Polar Webhook] Backend error:`, err.message);
      return NextResponse.json({ error: "Backend update failed", detail: err.message }, { status: 502 });
    }
  }

  console.log(`[Polar Webhook] Unhandled event: ${eventType}`);
  return NextResponse.json({ received: true, skipped: true, reason: `unhandled event: ${eventType}` });
}
