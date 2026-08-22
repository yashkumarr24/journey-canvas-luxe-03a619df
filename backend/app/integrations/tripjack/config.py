"""TripJack connection settings.

Everything here is environment-driven. The API key is read from the process
environment of the FastAPI VPS only — it is never logged, never serialised
into a response, and never exposed to the frontend.

Staging/UAT and production use DIFFERENT base URLs and DIFFERENT keys
(TripJack docs: "UAT and production use separate keys"). Changing environment
is a configuration change, never a code change.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import Settings

# Documented UAT host. Kept only as a default so a misconfigured deployment
# fails towards staging rather than towards production.
DEFAULT_UAT_BASE_URL = "https://apitest.tripjack.com"
PRODUCTION_HOST = "tripjack.com"


@dataclass(frozen=True)
class TripJackConfig:
    base_url: str
    api_key: str
    connect_timeout: float
    read_timeout: float
    write_timeout: float
    pool_timeout: float
    max_connections: int
    search_retries: int

    @property
    def is_configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    @property
    def targets_production(self) -> bool:
        host = self.base_url.split("//", 1)[-1].split("/", 1)[0].lower()
        return host == PRODUCTION_HOST or host == f"www.{PRODUCTION_HOST}"


def build_config(settings: Settings) -> TripJackConfig:
    # Trailing slashes are stripped: TripJack rejects endpoints that end with
    # a slash ("Endpoints must not end with a trailing slash").
    base_url = (settings.tripjack_base_url or DEFAULT_UAT_BASE_URL).rstrip("/")
    return TripJackConfig(
        base_url=base_url,
        api_key=settings.tripjack_api_key,
        connect_timeout=settings.tripjack_connect_timeout,
        read_timeout=settings.tripjack_read_timeout,
        write_timeout=settings.tripjack_write_timeout,
        pool_timeout=settings.tripjack_pool_timeout,
        max_connections=settings.tripjack_max_connections,
        search_retries=settings.tripjack_search_retries,
    )
