"""TripJack HOTEL API v3.0 wire format: paths, request builders, field keys.

Reference: https://tripjack.com/page/api-doc  (Hotels API v3.0, host
apitest-hms.tripjack.com for UAT). v3 differences this module encodes:

  * `apikey` header auth (same key as Flights v2) — handled by the client.
  * `correlationId` is REQUIRED on every request: a client-generated tracing id.
    We reuse the per-request id from `request_id_ctx`, so a customer complaint
    can be traced from our logs to TripJack's. It carries no user data.
  * Listing takes `hids` (hotel ids). `cityCode` was removed, so free-text
    destinations MUST be resolved to hotel ids first (`hotel_directory.py`).
  * `pageSize` was removed; page size is fixed server-side and continuation is
    driven by the `searchId` returned with the first page.
  * Listing returns FIVE rate plan types per hotel (cheapest, free
    cancellation, GST inclusive, PAN not required, breakfast inclusive) instead
    of only the cheapest.
  * `mf` / `mft` (management fee + its tax) appear on every pricing object and
    are part of the payable total.
  * `optionType` is a four-code system: SRSM / SRCM / CRSM / CRCM.
  * Cancellation policy is EMBEDDED in every option; the separate
    cancel-policy endpoint is gone.

Identity chain carried through our own session store:
    searchId -> optionId -> reviewHash   (-> bookingId, booking phase, PENDING)

PENDING (not implemented on purpose — booking phase)
  * /oms/v3/hotel/book, /confirm-book, /booking-details,
    /cancel-booking/{bookingId}
"""

from __future__ import annotations

from typing import Any

from app.core.logging import request_id_ctx

# --- v3 paths (single source of truth) --------------------------------------
HOTEL_LISTING_PATH = "hms/v3/hotel/listing"
HOTEL_PRICING_PATH = "hms/v3/hotel/pricing"
HOTEL_REVIEW_PATH = "hms/v3/hotel/review"

# Booking-phase paths, declared for documentation only. NOT called anywhere.
PENDING_BOOKING_PATHS = (
    "oms/v3/hotel/book",
    "oms/v3/hotel/confirm-book",
    "oms/v3/hotel/booking-details",
    "oms/v3/hotel/cancel-booking/{bookingId}",
)

DEFAULT_CURRENCY = "INR"
DEFAULT_NATIONALITY = "IN"

# v3 rate plan types, in the order we present them.
RATE_PLAN_TYPES: dict[str, str] = {
    "CHEAPEST": "Cheapest",
    "FREE_CANCELLATION": "Free cancellation",
    "GST_INCLUSIVE": "GST inclusive",
    "PAN_NOT_REQUIRED": "PAN not required",
    "BREAKFAST_INCLUSIVE": "Breakfast included",
}

# v3 optionType: (same|cross) room x (same|cross) mealplan.
OPTION_TYPES: dict[str, str] = {
    "SRSM": "Same room, same meal plan",
    "SRCM": "Same room, different meal plans",
    "CRSM": "Different rooms, same meal plan",
    "CRCM": "Different rooms, different meal plans",
}

REFUNDABLE_TRUE = {"refundable", "free_cancellation", "true", "1", "yes"}
REFUNDABLE_FALSE = {"non_refundable", "nonrefundable", "false", "0", "no"}


def correlation_id() -> str:
    """Per-request tracing id required by v3. Opaque, no user data."""
    value = request_id_ctx.get()
    return value if value and value != "-" else "fnf-untraced"


def normalise_rate_plan(raw: Any) -> str | None:
    """Map a provider rate-plan marker onto one of the five v3 types."""
    if not isinstance(raw, str):
        return None
    token = raw.strip().upper().replace(" ", "_").replace("-", "_")
    if token in RATE_PLAN_TYPES:
        return token
    aliases = {
        "FREECANCELLATION": "FREE_CANCELLATION",
        "FREE_CANCEL": "FREE_CANCELLATION",
        "GSTINCLUSIVE": "GST_INCLUSIVE",
        "PANNOTREQUIRED": "PAN_NOT_REQUIRED",
        "NO_PAN": "PAN_NOT_REQUIRED",
        "BREAKFASTINCLUSIVE": "BREAKFAST_INCLUSIVE",
        "BREAKFAST": "BREAKFAST_INCLUSIVE",
    }
    return aliases.get(token)


def _room_info(rooms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One entry per physical room, exactly as the customer asked for it."""
    room_info: list[dict[str, Any]] = []
    for room in rooms:
        entry: dict[str, Any] = {"numberOfAdults": int(room.get("adults") or 1)}
        ages = [int(age) for age in room.get("childAges") or []]
        if ages:
            entry["numberOfChild"] = len(ages)
            entry["childAge"] = ages
        room_info.append(entry)
    return room_info


# v3 listing accepts at most 100 hids per request (documented; UAT accepted 100).
MAX_LISTING_HIDS = 100

# v3 `nationality` is a TripJack countryId (Nationalities endpoint), not ISO.
# Only India is confirmed (UAT succeeded with "106"). Other ISO codes are
# passed through unchanged until their countryIds are confirmed.
TRIPJACK_NATIONALITY_IDS: dict[str, str] = {"IN": "106"}


def tripjack_nationality(value: str | None) -> str:
    code = (value or DEFAULT_NATIONALITY).strip().upper()
    if code.isdigit():
        return code
    return TRIPJACK_NATIONALITY_IDS.get(code, code)


def _hid(value: Any) -> Any:
    text = str(value).strip()
    return int(text) if text.isdigit() else text


def _v3_rooms(rooms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for room in rooms:
        entry: dict[str, Any] = {"adults": int(room.get("adults") or 1)}
        ages = [int(age) for age in room.get("childAges") or []]
        if ages:
            entry["children"] = len(ages)
            entry["childAge"] = ages
        out.append(entry)
    return out


def build_listing_payload(
    *,
    hids: list[str],
    check_in: str,
    check_out: str,
    rooms: list[dict[str, Any]],
    nationality: str | None,
    currency: str | None,
) -> dict[str, Any]:
    """/hms/v3/hotel/listing — FLAT body, confirmed against live UAT.

    No searchQuery / roomInfo / searchCriteria wrappers. At most
    MAX_LISTING_HIDS ids; callers batch larger lists.
    """
    if len(hids) > MAX_LISTING_HIDS:
        raise ValueError("too_many_hids")
    return {
        "checkIn": check_in,
        "checkOut": check_out,
        "rooms": _v3_rooms(rooms),
        "currency": (currency or DEFAULT_CURRENCY).upper(),
        "correlationId": correlation_id(),
        "nationality": tripjack_nationality(nationality),
        "hids": [_hid(h) for h in hids],
    }


def build_listing_continuation_payload(
    *, search_id: str, next_token: str | None
) -> dict[str, Any]:
    """Legacy continuation shape. NOT used: the confirmed v3 listing response
    has no searchId / nextPageToken / hasMore. Kept only for the diagnostic."""
    payload: dict[str, Any] = {
        "correlationId": correlation_id(),
        "searchId": search_id,
    }
    if next_token:
        payload["nextPageToken"] = next_token
    return payload


PRICING_TIMEOUT_MS = 13000


def build_pricing_payload(
    *,
    listing_correlation_id: str,
    hid: str,
    check_in: str,
    check_out: str,
    rooms: list[dict[str, Any]],
    nationality: str | None,
    currency: str | None,
    timeout_ms: int | None = PRICING_TIMEOUT_MS,
) -> dict[str, Any]:
    """/hms/v3/hotel/pricing — FLAT body, confirmed against live UAT.

    correlationId MUST be the originating listing's; dates, rooms (same count
    and order), currency and nationality must match the listing. `hid` is sent
    as a string.
    """
    if not listing_correlation_id:
        raise ValueError("missing_listing_correlation_id")
    payload: dict[str, Any] = {
        "checkIn": check_in,
        "checkOut": check_out,
        "correlationId": listing_correlation_id,
        "currency": (currency or DEFAULT_CURRENCY).upper(),
        "hid": str(hid).strip(),
        "nationality": tripjack_nationality(nationality),
        "rooms": _v3_rooms(rooms),
    }
    if timeout_ms:
        payload["timeoutMs"] = int(timeout_ms)
    return payload


def build_review_payload(
    *, listing_correlation_id: str, hid: str, option_id: str, review_hash: str
) -> dict[str, Any]:
    """/hms/v3/hotel/review — confirmed on TripJack UAT (HTTP 200).

    Exactly four fields: the listing's correlationId (reused, never new), the
    optionId chosen from detail, the detail reviewHash and the hotel id as a
    string. Dates/rooms/currency/nationality are NOT part of the contract.
    """
    if not listing_correlation_id:
        raise ValueError("missing_correlation_id")
    if not hid:
        raise ValueError("missing_hid")
    if not option_id:
        raise ValueError("missing_option_id")
    if not review_hash:
        raise ValueError("missing_review_hash")
    return {
        "correlationId": listing_correlation_id,
        "optionId": str(option_id),
        "reviewHash": review_hash,
        "hid": str(hid),
    }


def refundable_flag(raw: Any) -> bool | None:
    """Interpret a refundability marker without guessing when it is absent."""
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return bool(raw)
    if isinstance(raw, str):
        token = raw.strip().lower().replace(" ", "_").replace("-", "_")
        if token in REFUNDABLE_TRUE:
            return True
        if token in REFUNDABLE_FALSE:
            return False
    return None
