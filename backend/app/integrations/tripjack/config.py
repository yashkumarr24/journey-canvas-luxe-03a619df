"""TripJack connection settings.

Everything here is environment-driven. The API key is read from the process
environment of the FastAPI VPS only — it is never logged, never serialised
into a response, and never exposed to the frontend.

Staging/UAT and production use DIFFERENT base URLs and DIFFERENT keys
(TripJack docs: "UAT and production use separate keys"). Changing environment
is a configuration change, never a code change.

Flights and Hotels are TWO different API surfaces on TWO different hosts:

  * Flights API v2.0 -> TRIPJACK_BASE_URL        (UAT https://apitest.tripjack.com)
  * Hotel   API v3.0 -> TRIPJACK_HOTEL_BASE_URL  (UAT https://apitest-hms.tripjack.com)

The SAME api key covers both. `hotel_config()` returns the flight config with
the hotel host swapped in, so the flight integration is untouched.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from app.core.config import Settings

# Documented UAT hosts. Kept only as defaults so a misconfigured deployment
# fails towards staging rather than towards production.
DEFAULT_UAT_BASE_URL = "https://apitest.tripjack.com"
DEFAULT_UAT_HOTEL_BASE_URL = "https://apitest-hms.tripjack.com"
PRODUCTION_HOST = "tripjack.com"
# Any UAT host is a subdomain starting with "apitest".
UAT_HOST_PREFIX = "apitest"


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
    hotel_max_pages: int = 3

    @property
    def is_configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    @property
    def host(self) -> str:
        return self.base_url.split("//", 1)[-1].split("/", 1)[0].lower()

    @property
    def targets_production(self) -> bool:
        host = self.host
        if host.startswith(UAT_HOST_PREFIX):
            return False
        return host.endswith(PRODUCTION_HOST)


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
        hotel_max_pages=max(1, min(settings.tripjack_hotel_max_pages, 10)),
    )


def build_hotel_config(settings: Settings) -> TripJackConfig:
    """Hotel API v3 config: same credentials, dedicated HMS host."""
    hotel_base = (
        settings.tripjack_hotel_base_url or DEFAULT_UAT_HOTEL_BASE_URL
    ).rstrip("/")
    return replace(build_config(settings), base_url=hotel_base)
