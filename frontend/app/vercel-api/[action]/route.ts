import { NextRequest, NextResponse } from "next/server";

// Fallback to the token provided by the user if env var is missing
const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN || "polar_oat_DbwYw1d85au26rcFoonMyOunonLiFDfPdTtAU0pmvXl";
const POLAR_ORGANIZATION_ID = process.env.POLAR_ORGANIZATION_ID || "2c074a1d-a013-4d40-bc73-82157dcaaa74";
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://164.152.194.196:8000";

const PRODUCT_TO_PLAN: Record<string, string> = {
  "400b734f-4dfd-4376-99e5-2bab977cc1fe": "indie",
  "7272cf53-e552-4d24-acbb-d455999803a1": "pro",
};
const PLAN_TO_PRODUCT: Record<string, string> = {
  "indie": "400b734f-4dfd-4376-99e5-2bab977cc1fe",
  "pro": "7272cf53-e552-4d24-acbb-d455999803a1",
};

// Helper: Authenticate against our backend
async function getSecureUser(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Unauthorized: No token provided");

  const res = await fetch(`${BACKEND_URL}/api/labels/me/secure`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) throw new Error(`Backend Auth Failed: ${res.statusText}`);
  return res.json();
}

// Helper: Update DB plan via internal admin endpoint
async function updateLocalPlan(email: string, slug: string, plan: string) {
  const res = await fetch(`${BACKEND_URL}/api/labels/admin/by-email/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, slug, plan }),
  });
  if (!res.ok) console.error("Failed to update local plan:", await res.text());
}

// Helper: Find Active Subscription by Slug or ID
async function getPolarSubscription(slug: string, subscriptionId?: string) {
  if (subscriptionId) {
    const res = await fetch(
      `https://api.polar.sh/v1/subscriptions/${subscriptionId}`,
      { headers: { Authorization: `Bearer ${POLAR_ACCESS_TOKEN}` } }
    );
    if (res.ok) {
      const sub = await res.json();
      if (sub.status === "active") return sub;
    }
  }

  // Fallback: search by metadata slug
  const res = await fetch(
    `https://api.polar.sh/v1/subscriptions/?organization_id=${POLAR_ORGANIZATION_ID}&active=true&limit=100`,
    { headers: { Authorization: `Bearer ${POLAR_ACCESS_TOKEN}` } }
  );
  if (!res.ok) throw new Error(`Polar Sub Error: ${res.statusText}`);
  const data = await res.json();
  
  if (data.items) {
    const sub = data.items.find((item: any) => 
      item.metadata && item.metadata.slug === slug
    );
    if (sub) return sub;
  }
  return null;
}


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params;
  
  if (action === "billing") {
    try {
      const user = await getSecureUser(req);
      
      const sub = await getPolarSubscription(user.slug, user.polar_subscription_id);
      if (!sub) {
        return NextResponse.json({ plan: user.plan || "free", status: "free" });
      }

      const planName = PRODUCT_TO_PLAN[sub.product_id] || "free";
      const priceObj = sub.price || {};
      
      return NextResponse.json({
        plan: planName,
        status: sub.status,
        next_billing_date: sub.current_period_end,
        amount: priceObj.price_amount,
        currency: priceObj.price_currency,
        subscription_id: sub.id,
      });
    } catch (err: any) {
      console.error("Billing GET error:", err);
      // Fallback
      return NextResponse.json({ plan: "free", status: "active" });
    }
  }

  return NextResponse.json({ error: "Invalid GET action" }, { status: 404 });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params;

  try {
    const user = await getSecureUser(req);

    if (action === "portal") {
      // Create portal session using the customer ID from the active subscription
      // If no subscription exists, we cannot create a portal session easily without a customer
      const sub = await getPolarSubscription(user.slug, user.polar_subscription_id);
      let customerId = user.polar_customer_id || sub?.customer_id;

      if (!customerId) {
        // Fallback: try to find customer by email
        const custRes = await fetch(
          `https://api.polar.sh/v1/customers/?organization_id=${POLAR_ORGANIZATION_ID}&email=${encodeURIComponent(user.email)}`,
          { headers: { Authorization: `Bearer ${POLAR_ACCESS_TOKEN}` } }
        );
        const custData = await custRes.json();
        if (custData.items && custData.items.length > 0) {
          customerId = custData.items[0].id;
        } else {
          // Create customer if it doesn't exist at all
          const createRes = await fetch("https://api.polar.sh/v1/customers/", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({
              organization_id: POLAR_ORGANIZATION_ID,
              email: user.email,
              name: user.name,
            }),
          });
          if (!createRes.ok) throw new Error("Failed to create customer");
          const newCust = await createRes.json();
          customerId = newCust.id;
        }
      }

      // Create session
      const sessRes = await fetch("https://api.polar.sh/v1/customer-sessions/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({ customer_id: customerId }),
      });
      if (!sessRes.ok) throw new Error("Failed to create portal session");
      const sessionData = await sessRes.json();

      let portalUrl = sessionData.customer_portal_url;
      if (!portalUrl) {
        const token = sessionData.token || sessionData.session_token;
        if (token) portalUrl = `https://polar.sh/customer-portal/?token=${token}`;
        else throw new Error("Could not retrieve portal URL");
      }

      return NextResponse.json({ url: portalUrl });
    }

    if (action === "cancel") {
      const sub = await getPolarSubscription(user.slug, user.polar_subscription_id);
      if (!sub) throw new Error("No active subscription found to cancel");

      const delRes = await fetch(`https://api.polar.sh/v1/subscriptions/${sub.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${POLAR_ACCESS_TOKEN}` },
      });
      if (!delRes.ok && delRes.status !== 204) throw new Error("Polar cancellation failed");

      // We let the Polar webhook handle the backend DB update to respect deferred cancellations
      // await updateLocalPlan(user.email, user.slug, "free");
      
      return NextResponse.json({ status: "success", message: "Subscription cancelled successfully." });
    }

    if (action === "update") {
      const body = await req.json();
      const newPlan = body.new_plan;
      const newProductId = PLAN_TO_PRODUCT[newPlan?.toLowerCase()];
      if (!newProductId) throw new Error("Invalid plan");

      const sub = await getPolarSubscription(user.slug, user.polar_subscription_id);
      if (!sub) throw new Error("No active subscription found to update");

      const upRes = await fetch(`https://api.polar.sh/v1/subscriptions/${sub.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          product_id: newProductId,
          proration_behavior: "prorate",
        }),
      });
      if (!upRes.ok) throw new Error("Polar update failed");

      // We let the Polar webhook handle the backend DB update to respect deferred downgrades
      // await updateLocalPlan(user.email, user.slug, newPlan.toLowerCase());

      return NextResponse.json({ status: "success", message: `Subscription updated to ${newPlan} successfully.` });
    }

    return NextResponse.json({ error: "Invalid POST action" }, { status: 404 });
  } catch (err: any) {
    console.error("Polar API error:", err);
    return NextResponse.json({ detail: err.message }, { status: 500 });
  }
}
