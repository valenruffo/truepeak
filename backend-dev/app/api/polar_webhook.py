"""Polar webhook handler — receives payment events and updates label plans.

This is the SILENT machine path: Polar sends a POST to this endpoint
when a subscription is created, updated, or cancelled. The webhook
updates the label's plan in the database independently of the user's
browser redirect (Success URL).

Architecture:
  - Success URL (visual): Shows the user a "Payment successful!" banner
  - Webhook (silent): Updates the DB so the plan is active even if the
    user closes the browser before the redirect completes.
"""

import hashlib
import hmac
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from sqlmodel import Session, select

from app.database import get_session, engine
from app.models import Label

router = APIRouter(prefix="/api", tags=["polar-webhook"])

logger = logging.getLogger(__name__)

# Polar webhook secret — set this in your .env from Polar dashboard
# Polar > Settings > Webhooks > your webhook > Secret
POLAR_WEBHOOK_SECRET = os.getenv("POLAR_WEBHOOK_SECRET", "")


def _verify_polar_signature(raw_body: bytes, headers: dict, secret: str) -> bool:
    """Verify the Polar webhook signature.
    Supports both legacy HMAC (x-polar-signature) and new Standard Webhooks (webhook-signature).
    """
    if not secret:
        logger.warning("POLAR_WEBHOOK_SECRET not set — skipping signature verification")
        return True

    # 1. Try Standard Webhooks (New)
    if "webhook-signature" in headers:
        try:
            from standardwebhooks import Webhook
            # Standard Webhooks library handles the secret format
            wh = Webhook(secret)
            wh.verify(raw_body.decode("utf-8"), headers)
            return True
        except Exception as e:
            logger.error("Standard Webhook verification failed: %s", e)
            return False

    # 2. Try Legacy HMAC (Old)
    signature = headers.get("x-polar-signature", "")
    if signature:
        expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    return False


def _map_polar_product_to_plan(product_id: str) -> str | None:
    """Map a Polar product ID to our internal plan name.

    Replace these IDs with your actual Polar product IDs.
    You can find them in your Polar dashboard under Products.
    """
    PRODUCT_MAP = {
        "400b734f-4dfd-4376-99e5-2bab977cc1fe": "indie",
        "7272cf53-e552-4d24-acbb-d455999803a1": "pro",
    }
    return PRODUCT_MAP.get(product_id)


def _apply_plan_limits(label: Label, plan: str) -> None:
    """Apply plan limits to a label (mirrors the logic in labels.py)."""
    PLAN_LIMITS = {
        "free":  {"max_tracks_month": 10,  "max_emails_month": 0,   "hq_retention_days": 0},
        "indie": {"max_tracks_month": 100, "max_emails_month": 100, "hq_retention_days": 7},
        "pro":   {"max_tracks_month": 1000, "max_emails_month": 500, "hq_retention_days": 14},
    }
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    label.max_tracks_month = limits["max_tracks_month"]
    label.max_emails_month = limits["max_emails_month"]
    label.hq_retention_days = limits["hq_retention_days"]


@router.post("/webhooks/polar")
async def polar_webhook(request: Request):
    """Handle incoming Polar webhook events.

    Polar sends events for:
      - subscription.created  -> activate plan
      -subscription.active    -> activate plan (redundant but safe)
      - subscription.updated  -> update plan if product changed
      - subscription.canceled -> downgrade to free
      - subscription.revoked  -> downgrade to free

    The webhook payload structure depends on the event type.
    We handle the most common subscription events.
    """
    raw_body = await request.body()
    headers = dict(request.headers)

    if not _verify_polar_signature(raw_body, headers, POLAR_WEBHOOK_SECRET):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        import json
        raw_body_str = raw_body.decode("utf-8")
        data = json.loads(raw_body_str)
    except Exception as e:
        logger.error("Failed to parse Polar webhook body: %s", e)
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = data.get("type", "")
    logger.info("Polar webhook received: %s", event_type)

    # Polar payloads wrap the object in a 'data' field
    # For subscription.* events, it's a Subscription object
    # For order.paid events, it's an Order object
    # For checkout.completed events, it's a Checkout object
    payload_data = data.get("data", {})
    
    # 1. Extract Customer Email
    customer_email = (
        payload_data.get("customer_email") or 
        payload_data.get("user_email") or 
        payload_data.get("email") or
        payload_data.get("customer", {}).get("email") or 
        payload_data.get("user", {}).get("email") or 
        ""
    )
    
    # 2. Extract Product ID
    # In some events it's product_id, in others it's nested in product object
    product_id = (
        payload_data.get("product_id") or 
        payload_data.get("product", {}).get("id") or 
        ""
    )
    
    # 3. Extract Metadata (slug)
    metadata = payload_data.get("metadata", {})
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except:
            metadata = {}
    slug = metadata.get("slug")

    # Logging to file for persistent debug
    try:
        with open("/app/data/webhook.log", "a") as f:
            f.write(f"[{datetime.now().isoformat()}] Event: {event_type} | Email: {customer_email} | Slug: {slug} | Product: {product_id}\n")
    except:
        pass

    logger.info(f"Webhook parsed: type={event_type}, email={customer_email}, slug={slug}, product={product_id}")

    if not customer_email and not slug:
        logger.warning("Polar webhook: no customer email or slug in payload")
        return {"received": True, "skipped": True, "reason": "no customer email or slug"}

    with Session(engine) as session:
        label = None
        if slug:
            label = session.exec(select(Label).where(Label.slug == slug)).first()
        if not label and customer_email:
            # Try exact match first
            label = session.exec(select(Label).where(Label.owner_email == customer_email)).first()
            if not label:
                # Try case-insensitive if not found
                label = session.exec(select(Label).where(Label.owner_email.ilike(customer_email))).first()

        if not label:
            logger.warning("Polar webhook: no label found for slug %s or email %s", slug, customer_email)
            return {"received": True, "skipped": True, "reason": "label not found"}

        # Handle subscription lifecycle events
        if event_type in ("subscription.created", "subscription.active", "order.created", "order.paid", "checkout.completed", "checkout_session.completed"):
            plan = _map_polar_product_to_plan(product_id)
            if not plan:
                logger.warning("Polar webhook: unknown product_id %s", product_id)
                return {"received": True, "skipped": True, "reason": f"unknown product: {product_id}"}

            label.plan = plan
            # Use local copy of limits application to avoid circular imports if any
            PLAN_LIMITS = {
                "free":  {"max_tracks_month": 10,  "max_emails_month": 0,   "hq_retention_days": 0},
                "indie": {"max_tracks_month": 100, "max_emails_month": 100, "hq_retention_days": 7},
                "pro":   {"max_tracks_month": 1000, "max_emails_month": 500, "hq_retention_days": 14},
            }
            limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
            label.max_tracks_month = limits["max_tracks_month"]
            label.max_emails_month = limits["max_emails_month"]
            label.hq_retention_days = limits["hq_retention_days"]
            
            label.updated_at = datetime.now(timezone.utc)
            session.add(label)
            session.commit()
            logger.info("Label %s (%s) upgraded to %s via webhook", label.slug, customer_email, plan)
            return {"received": True, "action": "upgraded", "plan": plan, "label": label.slug}

        elif event_type == "subscription.updated":
            plan = _map_polar_product_to_plan(product_id)
            if plan:
                label.plan = plan
                # Apply limits same as above
                PLAN_LIMITS = {
                    "free":  {"max_tracks_month": 10,  "max_emails_month": 0,   "hq_retention_days": 0},
                    "indie": {"max_tracks_month": 100, "max_emails_month": 100, "hq_retention_days": 7},
                    "pro":   {"max_tracks_month": 1000, "max_emails_month": 500, "hq_retention_days": 14},
                }
                limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
                label.max_tracks_month = limits["max_tracks_month"]
                label.max_emails_month = limits["max_emails_month"]
                label.hq_retention_days = limits["hq_retention_days"]

                label.updated_at = datetime.now(timezone.utc)
                session.add(label)
                session.commit()
                logger.info("Label %s (%s) updated to %s via webhook", label.slug, customer_email, plan)
                return {"received": True, "action": "updated", "plan": plan, "label": label.slug}
            return {"received": True, "skipped": True, "reason": "no plan mapping for product"}

        elif event_type in ("subscription.canceled", "subscription.revoked"):
            label.plan = "free"
            # Apply free limits
            label.max_tracks_month = 10
            label.max_emails_month = 0
            label.hq_retention_days = 0
            
            label.updated_at = datetime.now(timezone.utc)
            session.add(label)
            session.commit()
            logger.info("Label %s (%s) downgraded to free via webhook", label.slug, customer_email)
            return {"received": True, "action": "downgraded", "plan": "free", "label": label.slug}

        else:
            logger.info("Polar webhook: unhandled event type %s", event_type)
            return {"received": True, "skipped": True, "reason": f"unhandled event: {event_type}"}
