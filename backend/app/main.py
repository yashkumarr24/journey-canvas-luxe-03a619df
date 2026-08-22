"""FastAPI application entrypoint.

Run locally:
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import api_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger, log_extra
from app.core.security import configure_cors
from app.integrations.tripjack.client import close_client as close_tripjack_client
from app.middleware.request_context import RequestContextMiddleware

settings = get_settings()
configure_logging(settings.log_level)
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Never log credential values — only whether they are present.
    logger.info(
        "startup",
        extra=log_extra(
            env=settings.app_env,
            debug=settings.app_debug,
            tripjack_configured=bool(settings.tripjack_base_url and settings.tripjack_api_key),
        ),
    )
    yield
    # Release the pooled TripJack connections cleanly.
    await close_tripjack_client()
    logger.info("shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        # API docs are disabled in production to reduce surface area.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
        lifespan=lifespan,
    )

    app.add_middleware(RequestContextMiddleware)
    configure_cors(app, settings)
    register_exception_handlers(app)
    app.include_router(api_router)

    return app


app = create_app()
