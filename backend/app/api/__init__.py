"""API router aggregation.

Future routers (flights, hotels, bookings, payments, webhooks) are included
here so main.py never needs to change.
"""

from fastapi import APIRouter

from app.api import health
from app.api.v1 import admin, analytics, flights, review

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(flights.router)
api_router.include_router(review.router)
api_router.include_router(analytics.router)
api_router.include_router(admin.router)

__all__ = ["api_router"]
