"""TripJack wire-format helpers (request building + defensive field access).

Field names follow the official TripJack Flights API v2.0 reference. TripJack
uses terse keys; the mapping below is documented so nothing here looks like a
guess:

  searchQuery.cabinClass            ECONOMY | PREMIUM_ECONOMY | BUSINESS | FIRST
  searchQuery.paxInfo.ADULT/CHILD/INFANT
  searchQuery.routeInfos[]          fromCityOrAirport.code, toCityOrAirport.code, travelDate
  searchQuery.searchModifiers       isDirectFlight, isConnectingFlight, pfts
  searchQuery.preferredAirline[]    { code }

  searchResult.tripInfos            ONWARD | RETURN | COMBO (or indexed keys)
  tripInfos[key][].sI[]             segment info
     sI[].fD.aI.code / fD.fN / fD.eT   airline code / flight number / equipment
     sI[].dt / at                      departure / arrival "YYYY-MM-DDTHH:MM"
     sI[].da / aa                      departure / arrival airport objects
     sI[].duration / stops / sN
  tripInfos[key][].totalPriceList[]
     id                                priceId (valid 15 minutes)
     fareIdentifier                    PUBLISHED | SPECIAL_RETURN | TJ_FLEX
     fd[PaxType].fC.BF/TAF/TF          base / taxes / total fare
     fd[PaxType].rT                    0 non-refundable, 1 refundable, 2 partial
     fd[PaxType].bI.iB / bI.cB         check-in / cabin baggage
     fd[PaxType].sR                    seats remaining
     fd[PaxType].cc                    cabin class

Anything not listed in the official reference is NOT read here.
"""

from __future__ import annotations

from typing import Any, Mapping

SEARCH_PATH = "fms/v1/air-search-all"

# Our normalized cabin class -> TripJack cabinClass (documented values).
CABIN_CLASS_TO_TRIPJACK = {
    "economy": "ECONOMY",
    "premium_economy": "PREMIUM_ECONOMY",
    "business": "BUSINESS",
    "first": "FIRST",
}
CABIN_CLASS_FROM_TRIPJACK = {v: k for k, v in CABIN_CLASS_TO_TRIPJACK.items()}

# Response keys documented for each journey type.
ONWARD_KEY = "ONWARD"
RETURN_KEY = "RETURN"
COMBO_KEY = "COMBO"

# TripJack quotes in INR for Indian agency accounts; the search response does
# not carry a currency field, so the value is configured, never invented.
DEFAULT_CURRENCY = "INR"


def _route_info(origin: str, destination: str, travel_date: str) -> dict[str, Any]:
    return {
        "fromCityOrAirport": {"code": origin},
        "toCityOrAirport": {"code": destination},
        "travelDate": travel_date,
    }


def build_search_payload(
    *,
    origin: str,
    destination: str,
    departure_date: str,
    return_date: str | None,
    cabin_class: str,
    adults: int,
    children: int,
    infants: int,
    direct_only: bool = False,
    connecting_only: bool = False,
    pfts: list[str] | None = None,
    preferred_airlines: list[str] | None = None,
    legs: list[tuple[str, str, str]] | None = None,
) -> dict[str, Any]:
    """Map OUR normalized search into the documented TripJack request body.

    `legs` is a list of (origin, destination, travelDate) triples for
    multi-city searches (2-6 entries); when present it replaces the
    origin/destination/return_date route construction.
    """
    if legs:
        route_infos = [_route_info(leg_from, leg_to, leg_date) for leg_from, leg_to, leg_date in legs]
    else:
        route_infos = [_route_info(origin, destination, departure_date)]
        if return_date:
            route_infos.append(_route_info(destination, origin, return_date))

    pax_info: dict[str, int] = {"ADULT": adults}
    # CHILD / INFANT are optional; omit rather than send zeros.
    if children:
        pax_info["CHILD"] = children
    if infants:
        pax_info["INFANT"] = infants

    search_query: dict[str, Any] = {
        "cabinClass": CABIN_CLASS_TO_TRIPJACK.get(cabin_class, "ECONOMY"),
        "paxInfo": pax_info,
        "routeInfos": route_infos,
    }

    # searchModifiers: only documented keys, only when actually set.
    search_modifiers: dict[str, Any] = {}
    if direct_only:
        search_modifiers["isDirectFlight"] = True
    if connecting_only:
        search_modifiers["isConnectingFlight"] = True
    if pfts:
        search_modifiers["pfts"] = list(pfts)
    if search_modifiers:
        search_query["searchModifiers"] = search_modifiers

    if preferred_airlines:
        search_query["preferredAirline"] = [{"code": code} for code in preferred_airlines]

    return {"searchQuery": search_query}


# --------------------------------------------------------------------------
# Defensive accessors. Optional provider fields stay optional — a missing
# value becomes None and is dropped from our response, never fabricated.
# --------------------------------------------------------------------------


def get_map(source: Any, *keys: str) -> dict[str, Any]:
    """First key present whose value is a mapping, else {}."""
    if not isinstance(source, Mapping):
        return {}
    for key in keys:
        value = source.get(key)
        if isinstance(value, Mapping):
            return dict(value)
    return {}


def get_list(source: Any, *keys: str) -> list[Any]:
    if not isinstance(source, Mapping):
        return []
    for key in keys:
        value = source.get(key)
        if isinstance(value, list):
            return value
    return []


def get_str(source: Any, *keys: str) -> str | None:
    if not isinstance(source, Mapping):
        return None
    for key in keys:
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def get_int(source: Any, *keys: str) -> int | None:
    if not isinstance(source, Mapping):
        return None
    for key in keys:
        value = source.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            return value
        if isinstance(value, float) and value.is_integer():
            return int(value)
    return None


def get_number(source: Any, *keys: str) -> float | None:
    if not isinstance(source, Mapping):
        return None
    for key in keys:
        value = source.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            return float(value)
    return None
