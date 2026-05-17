/**
 * Polar webhook handler — runs on Vercel (HTTPS) and proxies to backend.
 *
 * This is an HTTPS proxy: Polar requires HTTPS for webhooks, but our backend
 * runs on plain HTTP. This handler forwards the raw request to the backend's
 * own /api/webhooks/polar endpoint, which handles signature verification
 * and plan updates directly in the database.
 *
 * As a fallback, it also tries to update the plan via the admin API.
 */
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://164.152.194.196:8000";

const PRODUCT_TO_PLAN: Record<string, string> = {
  "400b734f-4dfd-4376-99e5-2bab977cc1fe": "indie",
  "7272cf53-e552-4d24-acbb-d455999803a1": "pro",
};

async function updatePlanViaAdmin(email: string, plan: string, slug?: string) {
  if (slug) {
    console.log(`[Polar Webhook] Admin fallback: ${BACKEND_URL}/api/labels/admin/${slug}/plan`);
    const res = await fetch(`${BACKEND_URL}/api/labels/admin/${slug}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[Polar Webhook] Admin slug update failed ${res.status}: ${err}`);
    } else {
      console.log(`[Polar Webhook] Admin slug update OK`);
    }
    return;
  }

  console.log(`[Polar Webhook] Admin fallback: ${BACKEND_URL}/api/labels/admin/by-email/plan`);
  const res = await fetch(`${BACKEND_URL}/api/labels/admin/by-email/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, plan }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`[Polar Webhook] Admin email update failed ${res.status}: ${err}`);
  } else {
    console.log(`[Polar Webhook] Admin email update OK`);
  }
}

function extractCustomerAndProduct(data: any): { email: string; productId: string; slug: string } {
  const email =
    data?.customer_email ||
    data?.user_email ||
    data?.customer?.email ||
    data?.user?.email ||
    data?.email ||
    "";

  const productId =
    data?.product_id ||
    data?.product?.id ||
    "";

  const metadata = data?.metadata || {};
  const slug = metadata?.slug || "";

  return { email, productId, slug };
}

export async function POST(request: NextRequest) {
  console.log(`[Polar Webhook] Received webhook at ${new Date().toISOString()}`);

  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // === PRIMARY PATH: Forward raw request to backend's own webhook handler ===
  // The backend has its own /api/webhooks/polar endpoint with signature verification
  // and direct database access — this is the most reliable path.
  try {
    console.log(`[Polar Webhook] Forwarding to backend: ${BACKEND_URL}/api/webhooks/polar`);
    const backendRes = await fetch(`${BACKEND_URL}/api/webhooks/polar`, {
      method: "POST",
      headers: {
        "content-type": headers["content-type"] || "application/json",
        // Forward webhook signature headers
        ...(headers["webhook-id"] && { "webhook-id": headers["webhook-id"] }),
        ...(headers["webhook-timestamp"] && { "webhook-timestamp": headers["webhook-timestamp"] }),
        ...(headers["webhook-signature"] && { "webhook-signature": headers["webhook-signature"] }),
        // Legacy signature header
        ...(headers["x-polar-signature"] && { "x-polar-signature": headers["x-polar-signature"] }),
      },
      body: rawBody,
      signal: AbortSignal.timeout(15000),
    });

    const backendResult = await backendRes.text();
    console.log(`[Polar Webhook] Backend response: ${backendRes.status} ${backendResult}`);

    if (backendRes.ok) {
      return NextResponse.json(
        { status: "ok", source: "backend-direct", result: JSON.parse(backendResult) },
        { status: 200 }
      );
    } else {
      console.error(`[Polar Webhook] Backend returned ${backendRes.status}: ${backendResult}`);
    }
  } catch (err: any) {
    console.error(`[Polar Webhook] Backend forward failed: ${err.message}`);
  }

  // === FALLBACK PATH: Parse payload ourselves and update via admin API ===
  console.log(`[Polar Webhook] Using fallback path (admin API)`);
  try {
    const data = JSON.parse(rawBody);
    const eventType = data?.type || "";
    const payloadData = data?.data || data;
    const { email, productId, slug } = extractCustomerAndProduct(payloadData);

    console.log(`[Polar Webhook] Fallback: type=${eventType}, email=${email}, product=${productId}, slug=${slug}`);

    // Log to backend for debugging (fire-and-forget)
    fetch(`${BACKEND_URL}/api/labels/webhook-debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: eventType,
        email,
        productId,
        slug,
        dataKeys: Object.keys(payloadData || {}),
      }),
    }).catch(() => {});

    // Determine plan from product
    const plan = PRODUCT_TO_PLAN[productId];
    const successEvents = [
      "subscription.created", "subscription.active", "subscription.updated",
      "order.created", "order.paid", "checkout.completed",
    ];
    const cancelEvents = ["subscription.canceled", "subscription.revoked"];

    if (successEvents.includes(eventType) && plan && email) {
      await updatePlanViaAdmin(email, plan, slug || undefined);
    } else if (cancelEvents.includes(eventType) && email) {
      await updatePlanViaAdmin(email, "free", slug || undefined);
    }

    return NextResponse.json({ status: "ok", source: "fallback" }, { status: 200 });
  } catch (err: any) {
    console.error(`[Polar Webhook] Fallback also failed: ${err.message}`);
    return NextResponse.json(
      { status: "error", message: err.message },
      { status: 500 }
    );
  }
}
