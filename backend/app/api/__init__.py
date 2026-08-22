"""API router aggregation.

Future routers (flights, hotels, bookings, payments, webhooks) are included
here so main.py never needs to change.
"""

from fastapi import APIRouter

from app.api import health

api_router = APIRouter()
api_router.include_router(health.router)

__all__ = ["api_router"]
