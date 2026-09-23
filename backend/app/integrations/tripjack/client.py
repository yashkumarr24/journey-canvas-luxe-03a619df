"""Async HTTP client for TripJack.

Contract (verified against the official TripJack Flights API v2.0 reference,
https://tripjack.com/page/api-doc):

    POST /fms/v1/air-search-all HTTP/1.1
    Host: apitest.tripjack.com
    apikey: YOUR_API_KEY
    Content-Type: application/json

Authentication is a single `apikey` request header — no OAuth, no bearer
token, no signing. The same key covers pre-booking (FMS) and post-booking
(OMS) endpoints.

This module is the ONLY place in the codebase that performs network I/O to
TripJack. It must run on the static-IP FastAPI VPS that TripJack has
whitelisted; requests originating from serverless/edge/browser contexts will
be rejected by TripJack's IP allow-list.
"""

from __future__ import annotations

import asyncio
from typing import Any, Mapping

import httpx

from app.core.logging import get_logger, log_extra, request_id_ctx
from app.integrations.tripjack.config import TripJackConfig
from app.integrations.tripjack.exceptions import (
    TripJackAuthError,
    TripJackBadRequestError,
    TripJackNetworkError,
    TripJackNotConfiguredError,
    TripJackRateLimitError,
    TripJackTimeoutError,
    TripJackUpstreamError,
    summarise_errors,
)

logger = get_logger(__name__)

API_KEY_HEADER = "apikey"

# Documented TripJack error codes that mean "your request is wrong", not
# "we are broken". Retrying these is pointless.
NON_RETRYABLE_PROVIDER_CODES = {
    "400", "404", "407", "408", "411", "412", "802", "805", "806", "810", "816", "819",
    "1000", "1001", "1002", "1003", "1005", "1006", "1071",
}
AUTH_PROVIDER_CODES = {"408", "411", "412", "802"}

RETRY_BACKOFF_SECONDS = (0.4, 1.0)


class TripJackClient:
    """Pooled async client. One instance per process, created at startup."""

    def __init__(self, config: TripJackConfig) -> None:
        self._config = config
        self._client: httpx.AsyncClient | None = None
        self._lock = asyncio.Lock()

    # -- lifecycle --------------------------------------------------------

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is not None:
            return self._client
        async with self._lock:
            if self._client is None:
                timeout = httpx.Timeout(
                    connect=self._config.connect_timeout,
                    read=self._config.read_timeout,
                    write=self._config.write_timeout,
                    pool=self._config.pool_timeout,
                )
                limits = httpx.Limits(
                    max_connections=self._config.max_connections,
                    max_keepalive_connections=max(2, self._config.max_connections // 2),
                    keepalive_expiry=30.0,
                )
                self._client = httpx.AsyncClient(
                    base_url=self._config.base_url,
                    timeout=timeout,
                    limits=limits,
                    http2=False,
                    follow_redirects=False,
                    headers={"Accept": "application/json"},
                )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # -- requests ---------------------------------------------------------

    async def post(
        self,
        path: str,
        payload: Mapping[str, Any],
        *,
        retries: int = 0,
        operation: str = "request",
    ) -> dict[str, Any]:
        """POST JSON to TripJack and return the decoded body.

        `retries` MUST stay 0 for anything transactional. Only idempotent
        read operations (search, fare rule) may pass a small retry budget,
        and even then only network/timeout/5xx failures are retried — never a
        response that TripJack actually produced.
        """
        if not self._config.is_configured:
            raise TripJackNotConfiguredError("TRIPJACK_BASE_URL/TRIPJACK_API_KEY not set")

        # TripJack rejects paths with a trailing slash.
        url = "/" + path.strip("/")
        headers = {
            API_KEY_HEADER: self._config.api_key,
            "Content-Type": "application/json",
            # Correlation id so a browser complaint can be traced end to end.
            # It is a random opaque hex string with no user data in it.
            "X-Request-ID": request_id_ctx.get(),
        }

        attempts = retries + 1
        last_error: Exception | None = None

        for attempt in range(attempts):
            try:
                return await self._attempt(url, payload, headers, operation, attempt)
            except (TripJackTimeoutError, TripJackNetworkError, TripJackUpstreamError) as exc:
                last_error = exc
                if attempt + 1 >= attempts:
                    break
                delay = RETRY_BACKOFF_SECONDS[min(attempt, len(RETRY_BACKOFF_SECONDS) - 1)]
                logger.warning(
                    "tripjack_retry",
                    extra=log_extra(operation=operation, attempt=attempt + 1, delay=delay),
                )
                await asyncio.sleep(delay)

        assert last_error is not None
        raise last_error

    async def get(
        self,
        path: str,
        params: Mapping[str, Any] | None = None,
        *,
        retries: int = 0,
        operation: str = "request",
    ) -> dict[str, Any]:
        """GET for read-only static content. Same auth, error mapping and
        transient-only retry policy as `post`."""
        if not self._config.is_configured:
            raise TripJackNotConfiguredError("TRIPJACK_HOTEL_BASE_URL/TRIPJACK_API_KEY not set")
        url = "/" + path.strip("/")
        headers = {API_KEY_HEADER: self._config.api_key, "X-Request-ID": request_id_ctx.get()}
        last_error: Exception | None = None
        for attempt in range(retries + 1):
            try:
                return await self._attempt(
                    url, {}, headers, operation, attempt, method="GET", params=params
                )
            except (TripJackTimeoutError, TripJackNetworkError, TripJackUpstreamError) as exc:
                last_error = exc
                if attempt >= retries:
                    break
                await asyncio.sleep(RETRY_BACKOFF_SECONDS[min(attempt, len(RETRY_BACKOFF_SECONDS) - 1)])
        assert last_error is not None
        raise last_error

    async def _attempt(
        self,
        url: str,
        payload: Mapping[str, Any],
        headers: dict[str, str],
        operation: str,
        attempt: int,
        method: str = "POST",
        params: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        client = await self._ensure_client()

        try:
            # NOTE: neither `headers` (contains the API key) nor `payload`
            # is ever logged. Only the operation name and outcome are.
            if method == "GET":
                response = await client.get(url, params=params, headers=headers)
            else:
                response = await client.post(url, json=payload, headers=headers)
        except httpx.TimeoutException as exc:
            logger.warning("tripjack_timeout", extra=log_extra(operation=operation, attempt=attempt))
            raise TripJackTimeoutError(f"{operation} timed out") from exc
        except httpx.HTTPError as exc:
            logger.warning(
                "tripjack_network_error",
                extra=log_extra(operation=operation, attempt=attempt, kind=type(exc).__name__),
            )
            raise TripJackNetworkError(f"{operation} network failure") from exc

        return self._interpret(response, operation)

    def _interpret(self, response: httpx.Response, operation: str) -> dict[str, Any]:
        status = response.status_code

        try:
            body = response.json()
        except ValueError:
            body = None

        if not isinstance(body, dict):
            logger.error("tripjack_bad_payload", extra=log_extra(operation=operation, status=status))
            raise TripJackUpstreamError(f"{operation} returned a non-JSON body")

        provider_code, provider_message = (None, "")
        if body.get("errors"):
            provider_code, provider_message = summarise_errors(body["errors"])

        # TripJack signals failure both via HTTP status and via
        # `status.success = false` + `errors[]` on a 200.
        status_block = body.get("status") if isinstance(body.get("status"), dict) else {}
        provider_ok = status_block.get("success") is not False and not body.get("errors")

        if status < 400 and provider_ok:
            logger.info("tripjack_ok", extra=log_extra(operation=operation, status=status))
            return body

        logger.warning(
            "tripjack_error",
            extra=log_extra(
                operation=operation,
                status=status,
                provider_code=provider_code,
                # Provider prose kept out of the response; retained here for
                # support triage. Contains no credentials.
                provider_detail=provider_message[:200],
            ),
        )

        if status == 429:
            raise TripJackRateLimitError(f"{operation} rate limited", provider_code=provider_code)
        if status in (401, 403) or (provider_code in AUTH_PROVIDER_CODES):
            raise TripJackAuthError(
                f"{operation} rejected — check API key and IP whitelist",
                provider_code=provider_code,
            )
        if status >= 500:
            raise TripJackUpstreamError(f"{operation} upstream {status}", provider_code=provider_code)
        if status >= 400 or provider_code in NON_RETRYABLE_PROVIDER_CODES:
            raise TripJackBadRequestError(
                f"{operation} rejected by provider",
                provider_code=provider_code,
            )

        raise TripJackUpstreamError(f"{operation} unusable response", provider_code=provider_code)


_client: TripJackClient | None = None
# Hotels (HMS v3) live on a different host, so they need their own pool. The
# flight client is never reused for hotels and vice versa.
_hotel_client: TripJackClient | None = None


def get_client(config: TripJackConfig) -> TripJackClient:
    """Process-wide singleton so the connection pool is actually reused."""
    global _client
    if _client is None:
        _client = TripJackClient(config)
    return _client


def get_hotel_client(config: TripJackConfig) -> TripJackClient:
    """Separate pooled client bound to the HMS (hotel) base URL."""
    global _hotel_client
    if _hotel_client is None:
        _hotel_client = TripJackClient(config)
    return _hotel_client


async def close_client() -> None:
    global _client, _hotel_client
    if _client is not None:
        await _client.aclose()
        _client = None
    if _hotel_client is not None:
        await _hotel_client.aclose()
        _hotel_client = None
