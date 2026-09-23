"""TripJack HOTEL wire format: paths + request builders + field mapping notes.

IMPORTANT — verification status
-------------------------------
The flight mapping in `schemas.py` is written against the published TripJack
Flights API v2.0 reference. TripJack's Hotel (HMS) reference is issued per
agency account, so the paths and response keys below are declared in ONE place
and treated as configuration, not as facts scattered through the code:

  * `HOTEL_SEARCH_PATH`, `HOTEL_DETAIL_PATH`, `HOTEL_RATE_REVIEW_PATH` MUST be
    confirmed against the HMS reference for this account before the first UAT
    call. If TripJack documents different paths, change them here only.
  * The normalizer in `hotels.py` reads SEVERAL plausible key spellings per
    field via the defensive accessors and leaves anything it cannot find as
    `None`. It never invents a value, never defaults a price, and never
    fabricates an image, rating or policy.
  * Booking / voucher paths are intentionally ABSENT. They are added only once
    the exact request/response contract is confirmed (see PENDING below).

PENDING (not implemented on purpose)
  * hotel booking (hold/confirm) call
  * voucher / invoice retrieval
  * cancellation with the provider
"""

from __future__ import annotations

from typing import Any

# --- paths (single source of truth; verify against the HMS reference) -------
HOTEL_SEARCH_PATH = "hms/v1/hotel-searchquery-list"
HOTEL_DETAIL_PATH = "hms/v1/hotel-searchquery-details"
HOTEL_RATE_REVIEW_PATH = "hms/v1/hotel-price-validate"

DEFAULT_CURRENCY = "INR"
DEFAULT_NATIONALITY = "IN"

# Room/rate refundability flags seen across TripJack responses.
REFUNDABLE_TRUE = {"refundable", "free_cancellation", "true", "1", "yes"}
REFUNDABLE_FALSE = {"non_refundable", "nonrefundable", "false", "0", "no"}


def build_search_payload(
    *,
    destination: str,
    check_in: str,
    check_out: str,
    rooms: list[dict[str, Any]],
    nationality: str | None,
    currency: str | None,
) -> dict[str, Any]:
    """Map OUR normalized hotel search into a TripJack HMS search body.

    `rooms` is a list of {"adults": int, "childAges": [int]} — one entry per
    physical room, exactly as the customer asked for it.
    """
    room_info: list[dict[str, Any]] = []
    for room in rooms:
        entry: dict[str, Any] = {"numberOfAdults": int(room.get("adults") or 1)}
        ages = [int(age) for age in room.get("childAges") or []]
        if ages:
            entry["numberOfChild"] = len(ages)
            entry["childAge"] = ages
        room_info.append(entry)

    search_query: dict[str, Any] = {
        "checkinDate": check_in,
        "checkoutDate": check_out,
        "roomInfo": room_info,
        "searchCriteria": {
            "city": destination,
            "nationality": (nationality or DEFAULT_NATIONALITY).upper(),
            "currency": (currency or DEFAULT_CURRENCY).upper(),
        },
    }
    return {"searchQuery": search_query}


def build_detail_payload(*, provider_hotel_id: str, provider_search_id: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {"id": provider_hotel_id}
    if provider_search_id:
        payload["searchId"] = provider_search_id
    return payload


def build_rate_review_payload(*, provider_rate_id: str, provider_hotel_id: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {"id": provider_rate_id}
    if provider_hotel_id:
        payload["hotelId"] = provider_hotel_id
    return payload


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
