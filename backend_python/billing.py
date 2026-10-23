"""
LaunchPadre Phase 3 — Stripe Monetization & Billing Framework
Target: Python 3.11+ | FastAPI | Stripe SDK | SQLAlchemy 2.0 Async

Manages subscription lifecycles, checkout session generation with client_reference_id,
and secure webhook verification via stripe.Webhook.construct_event.
"""

from __future__ import annotations

import logging
import os
from typing import Annotated, Any

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession


logger = logging.getLogger("launchpadre.billing")

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "sk_test_launchpadre_mock_secret_key_4092")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "whsec_launchpadre_stripe_webhook_99a8b7c6")
APP_URL = os.getenv("APP_URL", "http://localhost:3000").rstrip("/")

stripe.api_key = STRIPE_SECRET_KEY


class PlanConfig:
    PLANS: dict[str, dict[str, Any]] = {
        "indie_solo": {
            "name": "Indie Solo Tier",
            "price_usd": 12,
            "stripe_price_id": os.getenv("STRIPE_PRICE_INDIE_SOLO", "price_launchpadre_solo_monthly"),
            "description": "Unlimited private repositories, markdown Kanban boards, and Panic Room rollback.",
        },
        "academic_tier": {
            "name": "Academic Researcher Tier",
            "price_usd": 29,
            "stripe_price_id": os.getenv("STRIPE_PRICE_ACADEMIC", "price_launchpadre_academic_monthly"),
            "description": "All Indie Solo features plus automated Zenodo academic DOI minting and long-term archival.",
        },
    }


class CheckoutSessionRequest(BaseModel):
    user_id: int = Field(..., gt=0, description="Internal database user ID")
    plan_id: str = Field(..., description="Plan identifier: 'indie_solo' or 'academic_tier'")
    success_url: str | None = Field(default=None)
    cancel_url: str | None = Field(default=None)


class CheckoutSessionResponse(BaseModel):
    session_id: str
    checkout_url: str
    plan_id: str
    plan_name: str
    amount_usd: int
    user_id: int


class BillingWebhookResponse(BaseModel):
    status: str
    event_type: str
    user_id: int | None = None
    customer_id: str | None = None
    processed: bool


router = APIRouter(prefix="/api/v1/billing", tags=["billing"])


async def get_db_session() -> AsyncSession:  # pragma: no cover
    raise NotImplementedError


@router.post("/checkout-session", response_model=CheckoutSessionResponse, status_code=status.HTTP_200_OK)
async def create_checkout_session(
    payload: CheckoutSessionRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> CheckoutSessionResponse:
    plan_id = payload.plan_id.strip().lower()
    if plan_id not in PlanConfig.PLANS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid plan_id '{payload.plan_id}'. Allowed plans: {list(PlanConfig.PLANS.keys())}",
        )

    plan_meta = PlanConfig.PLANS[plan_id]
    success_url = payload.success_url or f"{APP_URL}/?billing_status=success&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = payload.cancel_url or f"{APP_URL}/?billing_status=cancelled"

    try:
        checkout_session = stripe.checkout.Session.create(
            mode="subscription",
            payment_method_types=["card"],
            client_reference_id=str(payload.user_id),
            line_items=[
                {
                    "price_data": {
                        "currency": "usd",
                        "product_data": {
                            "name": f"LaunchPadre — {plan_meta['name']}",
                            "description": plan_meta["description"],
                        },
                        "unit_amount": plan_meta["price_usd"] * 100,
                        "recurring": {"interval": "month"},
                    },
                    "quantity": 1,
                }
            ],
            metadata={
                "user_id": str(payload.user_id),
                "plan_id": plan_id,
                "platform": "launchpadre",
            },
            success_url=success_url,
            cancel_url=cancel_url,
        )

        logger.info(
            f"Stripe Checkout Session created: {checkout_session.id} for user_id={payload.user_id} ({plan_id})"
        )

        return CheckoutSessionResponse(
            session_id=checkout_session.id,
            checkout_url=checkout_session.url or f"{APP_URL}/checkout-mock?session_id={checkout_session.id}",
            plan_id=plan_id,
            plan_name=plan_meta["name"],
            amount_usd=plan_meta["price_usd"],
            user_id=payload.user_id,
        )
    except stripe.StripeError as exc:
        logger.error(f"Stripe API error: {str(exc)}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Stripe payment gateway error: {str(exc)}",
        ) from exc


@router.post("/webhooks/stripe", response_model=BillingWebhookResponse, status_code=status.HTTP_200_OK)
async def stripe_webhook_handler(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    stripe_signature: Annotated[str | None, Header(alias="Stripe-Signature")] = None,
) -> BillingWebhookResponse:
    if not stripe_signature:
        logger.warning("Rejected Stripe webhook: Missing Stripe-Signature header")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing Stripe-Signature authentication header.",
        )

    raw_body = await request.body()
    try:
        event = stripe.Webhook.construct_event(
            payload=raw_body,
            sig_header=stripe_signature,
            secret=STRIPE_WEBHOOK_SECRET,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload format.") from exc
    except stripe.SignatureVerificationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Signature verification failed.") from exc

    event_type = event["type"]
    event_data = event["data"]["object"]

    if event_type == "checkout.session.completed":
        client_ref_id = event_data.get("client_reference_id")
        customer_id = event_data.get("customer")
        subscription_id = event_data.get("subscription")
        metadata = event_data.get("metadata", {})
        plan_id = metadata.get("plan_id", "indie_solo")

        if not client_ref_id:
            return BillingWebhookResponse(
                status="skipped_no_client_reference_id", event_type=event_type, processed=False
            )

        user_id = int(client_ref_id)
        from backend_python.models import User

        stmt = (
            update(User)
            .where(User.id == user_id)
            .values(
                plan=plan_id,
                is_premium=True,
                stripe_customer_id=customer_id,
                stripe_subscription_id=subscription_id,
            )
        )
        await session.execute(stmt)
        await session.commit()

        logger.info(f"Upgraded user #{user_id} to {plan_id} (Customer: {customer_id})")
        return BillingWebhookResponse(
            status="user_upgraded_to_premium",
            event_type=event_type,
            user_id=user_id,
            customer_id=customer_id,
            processed=True,
        )

    elif event_type == "customer.subscription.deleted":
        customer_id = event_data.get("customer")
        from backend_python.models import User

        stmt = (
            update(User)
            .where(User.stripe_customer_id == customer_id)
            .values(
                plan="free",
                is_premium=False,
                stripe_subscription_id=None,
            )
        )
        await session.execute(stmt)
        await session.commit()

        logger.warning(f"Downgraded account customer_id={customer_id} to free tier")
        return BillingWebhookResponse(
            status="user_downgraded_to_free",
            event_type=event_type,
            customer_id=customer_id,
            processed=True,
        )

    return BillingWebhookResponse(status="event_acknowledged_unhandled", event_type=event_type, processed=False)
