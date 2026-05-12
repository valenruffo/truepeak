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


def _verify_polar_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    """Verify the Polar webhook signature (HMAC SHA-256)."""
    if not secret:
        # If no secret configured, skip verification (dev mode)
        logger.warning("POLAR_WEBHOOK_SECRET not set — skipping signature verification")
        return True
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


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
    signature = request.headers.get("x-polar-signature", "")

    if not _verify_polar_signature(raw_body, signature, POLAR_WEBHOOK_SECRET):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        import json
        data = json.loads(raw_body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = data.get("type", "")
    logger.info("Polar webhook received: %s", event_type)

    # Extract subscription data from the event
    # Polar v1 webhook structure:
    # {
    #   "type": "subscription.created",
    #   "data": {
    #     "id": "sub_xxx",
    #     "status": "active",
    #     "customer": { "email": "user@example.com" },
    #     "product": { "id": "prod_xxx" },
    #     "price": { "id": "price_xxx" }
    #   }
    # }
    subscription = data.get("data", {})
    customer = subscription.get("customer", {})
    user = subscription.get("user", {})
    
    # Extract email safely from multiple possible fields
    customer_email = (
        subscription.get("customer_email") or 
        subscription.get("user_email") or 
        customer.get("email") or 
        user.get("email") or 
        ""
    )
    
    # Extract product ID
    product = subscription.get("product", {})
    product_id = subscription.get("product_id") or product.get("id") or ""

    if not customer_email:
        logger.warning("Polar webhook: no customer email in payload")
        return {"received": True, "skipped": True, "reason": "no customer email"}

    with Session(engine) as session:
        label = session.exec(select(Label).where(Label.owner_email == customer_email)).first()

        if not label:
            logger.warning("Polar webhook: no label found for email %s", customer_email)
            return {"received": True, "skipped": True, "reason": "label not found"}

        # Handle subscription lifecycle events
        if event_type in ("subscription.created", "subscription.active", "order.created", "order.paid", "checkout.completed", "checkout_session.completed"):
            plan = _map_polar_product_to_plan(product_id)
            if not plan:
                logger.warning("Polar webhook: unknown product_id %s", product_id)
                return {"received": True, "skipped": True, "reason": f"unknown product: {product_id}"}

            label.plan = plan
            _apply_plan_limits(label, plan)
            label.updated_at = datetime.now(timezone.utc)
            session.add(label)
            session.commit()
            logger.info("Label %s (%s) upgraded to %s via webhook", label.slug, customer_email, plan)
            return {"received": True, "action": "upgraded", "plan": plan, "label": label.slug}

        elif event_type == "subscription.updated":
            plan = _map_polar_product_to_plan(product_id)
            if plan:
                label.plan = plan
                _apply_plan_limits(label, plan)
                label.updated_at = datetime.now(timezone.utc)
                session.add(label)
                session.commit()
                logger.info("Label %s (%s) updated to %s via webhook", label.slug, customer_email, plan)
                return {"received": True, "action": "updated", "plan": plan, "label": label.slug}
            return {"received": True, "skipped": True, "reason": "no plan mapping for product"}

        elif event_type in ("subscription.canceled", "subscription.revoked"):
            label.plan = "free"
            _apply_plan_limits(label, "free")
            label.updated_at = datetime.now(timezone.utc)
            session.add(label)
            session.commit()
            logger.info("Label %s (%s) downgraded to free via webhook", label.slug, customer_email)
            return {"received": True, "action": "downgraded", "plan": "free", "label": label.slug}

        else:
            logger.info("Polar webhook: unhandled event type %s", event_type)
            return {"received": True, "skipped": True, "reason": f"unhandled event: {event_type}"}
