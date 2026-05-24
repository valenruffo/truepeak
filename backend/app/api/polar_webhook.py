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

from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from sqlmodel import Session, select
from datetime import timedelta

from app.database import get_session, engine
from app.models import Label, Submission
from app.services.r2 import delete_file_from_r2

router = APIRouter(prefix="/api", tags=["polar-webhook"])

logger = logging.getLogger(__name__)

# Polar webhook secret — set this in your .env from Polar dashboard
# Polar > Settings > Webhooks > your webhook > Secret
POLAR_WEBHOOK_SECRET = os.getenv("POLAR_WEBHOOK_SECRET", "")


def _verify_polar_signature(raw_body: bytes, headers: dict, secret: str) -> bool:
    """Verify the Polar webhook signature.
    Supports both legacy HMAC (x-polar-signature) and new Standard Webhooks (webhook-signature).
    """
    logger.warning("--- WEBHOOK SIGNATURE VERIFICATION ---")
    logger.warning("Headers keys: %s", list(headers.keys()))
    logger.warning("webhook-id: %s", headers.get("webhook-id"))
    logger.warning("webhook-timestamp: %s", headers.get("webhook-timestamp"))
    logger.warning("webhook-signature: %s", headers.get("webhook-signature"))
    logger.warning("Body length: %d", len(raw_body))
    logger.warning("Body full: %s", raw_body.decode("utf-8", errors="ignore"))
    logger.warning("Secret starts with polar_whs_: %s", secret.startswith("polar_whs_"))

    if not secret:
        logger.warning("POLAR_WEBHOOK_SECRET not set — skipping signature verification")
        return True

    # 1. Try Standard Webhooks (New)
    if "webhook-signature" in headers:
        try:
            import base64
            from standardwebhooks import Webhook
            
            # Polar uses standardwebhooks but passes the entire secret string (including the polar_whs_ prefix)
            # as the raw HMAC key. Standardwebhooks always base64-decodes the secret passed to it,
            # so to pass the raw string as the key we must base64-encode it first.
            base64_secret = base64.b64encode(secret.encode()).decode()
            wh = Webhook(base64_secret)
            
            wh.verify(raw_body.decode("utf-8"), headers)
            logger.warning("Standard Webhook verification SUCCEEDED")
            return True
        except Exception as e:
            logger.error("Standard Webhook verification failed: %s", e)
            return False

    # 2. Try Legacy HMAC (Old)
    signature = headers.get("x-polar-signature", "")
    if signature:
        expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
        result = hmac.compare_digest(expected, signature)
        logger.warning("Legacy HMAC verification result: %s", result)
        return result

    logger.warning("No webhook signature headers found in request")
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


async def _enforce_retention_limits_bg(label_id: str, new_retention_days: int) -> None:
    """Background task to delete R2 originals that exceed the new retention limit."""
    if new_retention_days < 0:
        return
        
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=new_retention_days)
    
    with Session(engine) as session:
        submissions = session.exec(
            select(Submission).where(
                Submission.label_id == label_id,
                Submission.original_path.isnot(None),
                Submission.created_at < cutoff_date
            )
        ).all()
        
        for sub in submissions:
            if sub.original_path:
                try:
                    # original_path in DB is just the filename/key like "originals/UUID.wav"
                    await delete_file_from_r2(sub.original_path)
                    sub.original_path = None
                    session.add(sub)
                except Exception as e:
                    logger.error(f"Failed to retroactively delete R2 file {sub.original_path}: {e}")
        
        session.commit()
        logger.info(f"Enforced retention limits for label {label_id}. Deleted {len(submissions)} HQ files.")


@router.post("/webhooks/polar")
async def polar_webhook(request: Request, bg_tasks: BackgroundTasks):
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
            
            if customer_id := payload_data.get("customer_id"):
                label.polar_customer_id = customer_id
            if subscription_id := payload_data.get("subscription_id"):
                label.polar_subscription_id = subscription_id
            
            label.updated_at = datetime.now(timezone.utc)
            session.add(label)
            session.commit()
            logger.info("Label %s (%s) upgraded to %s via webhook", label.slug, customer_email, plan)
            return {"received": True, "action": "upgraded", "plan": plan, "label": label.slug}

        elif event_type == "subscription.updated":
            plan = _map_polar_product_to_plan(product_id)
            if plan:
                PLAN_LEVELS = {"free": 0, "indie": 1, "pro": 2}
                current_level = PLAN_LEVELS.get(label.plan, 0)
                new_level = PLAN_LEVELS.get(plan, 0)

                # 1. Downgrade logic: If downgrading, wait until current_period_end
                if new_level < current_level:
                    current_period_end_str = payload_data.get("current_period_end")
                    if current_period_end_str:
                        try:
                            current_period_end = datetime.fromisoformat(current_period_end_str.replace("Z", "+00:00"))
                            if current_period_end > datetime.now(timezone.utc):
                                logger.info("Downgrade from %s to %s deferred until %s", label.plan, plan, current_period_end)
                                return {"received": True, "action": "downgrade_deferred", "plan": label.plan, "until": current_period_end_str}
                        except ValueError:
                            pass
                
                # 2. Upgrade or completed downgrade logic: Apply immediately
                label.plan = plan
                # Apply limits same as above
                PLAN_LIMITS_MAP = {
                    "free":  {"max_tracks_month": 10,  "max_emails_month": 0,   "hq_retention_days": 0},
                    "indie": {"max_tracks_month": 100, "max_emails_month": 100, "hq_retention_days": 7},
                    "pro":   {"max_tracks_month": 1000, "max_emails_month": 500, "hq_retention_days": 14},
                }
                limits = PLAN_LIMITS_MAP.get(plan, PLAN_LIMITS_MAP["free"])
                label.max_tracks_month = limits["max_tracks_month"]
                label.max_emails_month = limits["max_emails_month"]
                label.hq_retention_days = limits["hq_retention_days"]

                if customer_id := payload_data.get("customer_id"):
                    label.polar_customer_id = customer_id
                if subscription_id := payload_data.get("subscription_id"):
                    label.polar_subscription_id = subscription_id

                # Trigger retroactive deletion if it was a completed downgrade
                if new_level < current_level:
                    bg_tasks.add_task(_enforce_retention_limits_bg, str(label.id), limits["hq_retention_days"])

                label.updated_at = datetime.now(timezone.utc)
                session.add(label)
                session.commit()
                logger.info("Label %s (%s) updated to %s via webhook", label.slug, customer_email, plan)
                return {"received": True, "action": "updated", "plan": plan, "label": label.slug}
            return {"received": True, "skipped": True, "reason": "no plan mapping for product"}

        elif event_type in ("subscription.canceled", "subscription.revoked"):
            # Check if period still active to prevent premature cancellation
            current_period_end_str = payload_data.get("current_period_end")
            if current_period_end_str:
                try:
                    current_period_end = datetime.fromisoformat(current_period_end_str.replace("Z", "+00:00"))
                    if current_period_end > datetime.now(timezone.utc):
                        logger.info("Cancellation deferred until %s", current_period_end)
                        return {"received": True, "action": "cancellation_deferred", "until": current_period_end_str}
                except ValueError:
                    pass

            label.plan = "free"
            # Apply free limits
            label.max_tracks_month = 10
            label.max_emails_month = 0
            label.hq_retention_days = 0
            
            # Set frozen state
            label.subscription_status = "frozen"
            label.frozen_at = datetime.now(timezone.utc)
            
            # Retroactively delete all HQ files (limit 0)
            bg_tasks.add_task(_enforce_retention_limits_bg, str(label.id), 0)
            
            label.updated_at = datetime.now(timezone.utc)
            session.add(label)
            session.commit()
            logger.info("Label %s (%s) downgraded to free and frozen via webhook", label.slug, customer_email)
            return {"received": True, "action": "downgraded_and_frozen", "plan": "free", "label": label.slug}

        else:
            logger.info("Polar webhook: unhandled event type %s", event_type)
            return {"received": True, "skipped": True, "reason": f"unhandled event: {event_type}"}
