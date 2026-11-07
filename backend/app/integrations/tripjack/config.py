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

Hotels use TRIPJACK_HOTEL_API_KEY (HMS and OMS); Flights keep TRIPJACK_API_KEY,
so Hotels can run on production while Flights stay on UAT.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from app.core.config import Settings

# Documented UAT hosts. Kept only as defaults so a misconfigured deployment
# fails towards staging rather than towards production.
DEFAULT_UAT_BASE_URL = "https://apitest.tripjack.com"
DEFAULT_UAT_HOTEL_BASE_URL = "https://apitest-hms.tripjack.com"
# Hotel Book / Booking Details / Confirm / Cancel live on a THIRD host.
DEFAULT_UAT_HOTEL_BOOKER_URL = "https://apitest-hotel-booker.tripjack.com"
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
    hotel_listing_concurrency: int = 3
    hotel_listing_starts_per_second: float = 2

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
        hotel_listing_concurrency=settings.hotel_listing_concurrency,
        hotel_listing_starts_per_second=settings.hotel_listing_starts_per_second,
    )


# TripJack-CONFIRMED Hotel production hosts, by surface. Deliberately empty
# until TripJack's written confirmation is recorded here in a reviewed change:
# any non-UAT Hotel host not listed is rejected (fail closed), so a guessed or
# typo'd address can never receive the production Hotel key.
CONFIRMED_HOTEL_PRODUCTION_HOSTS: dict[str, frozenset[str]] = {
    "hms": frozenset(),
    "oms": frozenset(),
}

HOTEL_ENV_UAT = "uat"
HOTEL_ENV_PRODUCTION = "production"
HOTEL_ENV_INVALID = "invalid"


def _host_of(url: str) -> str:
    return url.split("//", 1)[-1].split("/", 1)[0].lower()


def _classify(url: str, surface: str) -> str:
    if not url.lower().startswith("https://"):
        return HOTEL_ENV_INVALID
    host = _host_of(url)
    if host.startswith(UAT_HOST_PREFIX) and host.endswith("." + PRODUCTION_HOST):
        return HOTEL_ENV_UAT
    if host in CONFIRMED_HOTEL_PRODUCTION_HOSTS.get(surface, frozenset()):
        return HOTEL_ENV_PRODUCTION
    return HOTEL_ENV_INVALID


def _hotel_urls(settings: Settings) -> tuple[str, str]:
    hms = (getattr(settings, "tripjack_hotel_base_url", "") or DEFAULT_UAT_HOTEL_BASE_URL).rstrip("/")
    oms = (getattr(settings, "tripjack_hotel_booker_url", "") or DEFAULT_UAT_HOTEL_BOOKER_URL).rstrip("/")
    return hms, oms


def hotel_environment(settings: Settings) -> str:
    """One environment for BOTH Hotel hosts. Mixed UAT/production, unconfirmed
    or non-HTTPS hosts are "invalid" and leave Hotels unconfigured."""
    hms, oms = _hotel_urls(settings)
    a, b = _classify(hms, "hms"), _classify(oms, "oms")
    return a if a == b and a != HOTEL_ENV_INVALID else HOTEL_ENV_INVALID


def _hotel_api_key(settings: Settings) -> str:
    """Production Hotel hosts get ONLY TRIPJACK_HOTEL_API_KEY; UAT Hotel hosts
    get ONLY the existing UAT key, so the production key never reaches UAT and
    the UAT key never reaches production. Invalid/mixed -> no key."""
    env = hotel_environment(settings)
    if env == HOTEL_ENV_PRODUCTION:
        return getattr(settings, "tripjack_hotel_api_key", "") or ""
    if env == HOTEL_ENV_UAT:
        return getattr(settings, "tripjack_api_key", "") or ""
    return ""


def build_hotel_config(settings: Settings) -> TripJackConfig:
    """Hotel API v3 config: dedicated HMS host, environment-matched key."""
    hms, _ = _hotel_urls(settings)
    return replace(build_config(settings), base_url=hms, api_key=_hotel_api_key(settings))


def build_hotel_booker_config(settings: Settings) -> TripJackConfig:
    """Hotel booking (OMS v3) config: dedicated booker host, environment-matched key."""
    _, oms = _hotel_urls(settings)
    return replace(build_config(settings), base_url=oms, api_key=_hotel_api_key(settings))
