"""Flight search use case.

Responsibilities:
  * throttle abusive traffic before any provider quota is spent
  * call the TripJack adapter
  * translate provider failures into safe, correctly-statused app errors
  * persist the normalized search + fare references (best effort)

Route handlers stay thin; TripJack types never appear above this layer.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Request, status

from app.core.auth import AuthContext
from app.core.config import Settings
from app.core.errors import AppError
from app.core.logging import get_logger, log_extra
from app.core.rate_limit import client_identity, flight_search_limiter
from app.integrations.tripjack import flights as tripjack_flights
from app.integrations.tripjack.client import get_client
from app.integrations.tripjack.config import build_config
from app.integrations.tripjack.exceptions import (
    TripJackAuthError,
    TripJackBadRequestError,
    TripJackNetworkError,
    TripJackNotConfiguredError,
    TripJackRateLimitError,
    TripJackTimeoutError,
    TripJackUpstreamError,
)
from app.repositories.searches import SearchRepository
from app.schemas.flights import FlightSearchRequest, FlightSearchResponse

logger = get_logger(__name__)


# -- user-safe application errors -------------------------------------------


class ProviderUnavailableError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "PROVIDER_UNAVAILABLE"
    message = "Flight search is temporarily unavailable. Please try again."


class ProviderTimeoutError(AppError):
    status_code = status.HTTP_504_GATEWAY_TIMEOUT
    code = "PROVIDER_TIMEOUT"
    message = "The flight search is taking longer than expected. Please try again."


class ProviderRejectedError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "SEARCH_REJECTED"
    message = "We couldn't search with those details. Please review your search and try again."


class SearchNotConfiguredError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "SEARCH_NOT_CONFIGURED"
    message = "Flight search is being configured. Please check back shortly."


class TooManySearchesError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "RATE_LIMITED"
    message = "Too many searches in a short time. Please wait a moment and try again."


async def search_flights(
    *,
    request: Request,
    payload: FlightSearchRequest,
    auth: AuthContext,
    settings: Settings,
) -> FlightSearchResponse:
    flight_search_limiter.check(client_identity(request, auth.user_id))

    config = build_config(settings)
    if not config.is_configured:
        logger.error("tripjack_not_configured")
        raise SearchNotConfiguredError()

    if settings.is_production is False and config.targets_production:
        # Guard rail: a non-production deployment must never bill live inventory.
        logger.error("tripjack_production_url_in_non_production")
        raise SearchNotConfiguredError()

    client = get_client(config)

    logger.info(
        "flight_search_started",
        extra=log_extra(
            origin=payload.origin,
            destination=payload.destination,
            trip_type=payload.trip_type,
            authenticated=auth.is_authenticated,
        ),
    )

    try:
        response = await tripjack_flights.search_flights(client, config, payload)
    except TripJackTimeoutError:
        raise ProviderTimeoutError() from None
    except (TripJackNetworkError, TripJackUpstreamError, TripJackRateLimitError):
        # A provider throttle is our problem, not the customer's — surfacing
        # 429 here would wrongly blame them for our quota.
        raise ProviderUnavailableError() from None
    except TripJackAuthError:
        # Credential/IP-whitelist problem. The customer must never see that.
        logger.error("tripjack_auth_failure")
        raise ProviderUnavailableError() from None
    except TripJackBadRequestError as exc:
        raise ProviderRejectedError(exc.safe_message) if exc.safe_message else ProviderRejectedError()
    except TripJackNotConfiguredError:
        raise SearchNotConfiguredError() from None

    await _persist(payload, response, auth=auth, settings=settings)

    logger.info("flight_search_completed", extra=log_extra(result_count=len(response.results)))
    return response


async def _persist(
    payload: FlightSearchRequest,
    response: FlightSearchResponse,
    *,
    auth: AuthContext,
    settings: Settings,
) -> None:
    repository = SearchRepository(settings)
    if not repository.enabled:
        return

    currency = response.currency or "INR"
    search_id = await repository.record_search(payload, user_id=auth.user_id, currency=currency)
    if not search_id:
        return

    # Expose our own search id, not a provider token, as the session handle.
    response.search_id = search_id

    expires_at = _parse_expiry(response.expires_at)
    await repository.record_result_refs(search_id, response.results, expires_at=expires_at)


def _parse_expiry(raw: str | None) -> datetime:
    if raw:
        try:
            return datetime.fromisoformat(raw)
        except ValueError:
            pass
    return datetime.now(timezone.utc)
