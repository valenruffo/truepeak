import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN || "polar_oat_DbwYw1d85au26rcFoonMyOunonLiFDfPdTtAU0pmvXl";
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://164.152.194.196:8000";

// Map Product ID to Plan Tier
const PRODUCT_TO_PLAN: Record<string, string> = {
  "400b734f-4dfd-4376-99e5-2bab977cc1fe": "indie",
  "7272cf53-e552-4d24-acbb-d455999803a1": "pro",
};

export async function POST(req: Request) {
  try {
    // 1. Get user session to know who is linking this checkout
    const cookieStore = await cookies();
    const token = cookieStore.get("token")?.value || req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const authRes = await fetch(`${BACKEND_URL}/api/labels/me/secure`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!authRes.ok) return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    const user = await authRes.json();

    // 2. Parse body
    const body = await req.json();
    const { checkout_id } = body;
    if (!checkout_id) return NextResponse.json({ error: "Missing checkout_id" }, { status: 400 });

    // 3. Fetch checkout from Polar
    const checkoutRes = await fetch(`https://api.polar.sh/v1/checkouts/custom/${checkout_id}`, {
      headers: { Authorization: `Bearer ${POLAR_ACCESS_TOKEN}` }
    });
    if (!checkoutRes.ok) throw new Error("Failed to fetch Polar checkout");
    const checkoutData = await checkoutRes.json();

    const customerId = checkoutData.customer_id;
    let subscriptionId = checkoutData.subscription_id || checkoutData.subscription?.id;
    const productId = checkoutData.product_id;

    // If subscription_id is missing from checkout, query subscriptions for this customer
    if (!subscriptionId && customerId) {
      const subsRes = await fetch(`https://api.polar.sh/v1/subscriptions/?customer_id=${customerId}&active=true`, {
        headers: { Authorization: `Bearer ${POLAR_ACCESS_TOKEN}` }
      });
      if (subsRes.ok) {
        const subsData = await subsRes.json();
        // Find the subscription that matches this checkout_id or just the first active one
        const activeSub = subsData.items?.find((s: any) => s.checkout_id === checkout_id) || subsData.items?.[0];
        if (activeSub) {
          subscriptionId = activeSub.id;
        }
      }
    }
    
    // We only update if this checkout actually generated a subscription
    if (!subscriptionId || !customerId) {
      return NextResponse.json({ success: true, message: "Checkout has no subscription yet", data: checkoutData });
    }

    const planName = PRODUCT_TO_PLAN[productId] || "free";

    // 4. Send this mapping back to the backend to save in the SQLite DB
    const updateRes = await fetch(`${BACKEND_URL}/api/labels/admin/by-email/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email,
        slug: user.slug,
        plan: planName,
        polar_customer_id: customerId,
        polar_subscription_id: subscriptionId,
      }),
    });

    if (!updateRes.ok) {
      const err = await updateRes.text();
      console.error("Backend sync failed:", err);
      throw new Error("Failed to sync backend");
    }

    return NextResponse.json({ success: true, plan: planName, customerId, subscriptionId });

  } catch (error: any) {
    console.error("Vercel Sync Error:", error);
    return NextResponse.json({ error: error.message || "Sync failed" }, { status: 500 });
  }
}
