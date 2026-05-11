/**
 * Webhook proxy for Polar payments.
 * Forwards the raw request to the FastAPI backend.
 * This exists because Polar requires HTTPS webhooks,
 * and our backend runs on HTTP behind the VPS.
 */
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://164.152.194.196:8000";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("x-polar-signature", request.headers.get("x-polar-signature") || "");

  try {
    const res = await fetch(`${BACKEND_URL}/api/webhooks/polar`, {
      method: "POST",
      headers,
      body: rawBody,
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("Webhook proxy error:", err);
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }
}
