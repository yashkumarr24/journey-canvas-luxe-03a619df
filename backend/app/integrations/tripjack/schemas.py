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
) -> dict[str, Any]:
    """Map OUR normalized search into the documented TripJack request body."""
    route_infos: list[dict[str, Any]] = [
        {
            "fromCityOrAirport": {"code": origin},
            "toCityOrAirport": {"code": destination},
            "travelDate": departure_date,
        }
    ]
    if return_date:
        route_infos.append(
            {
                "fromCityOrAirport": {"code": destination},
                "toCityOrAirport": {"code": origin},
                "travelDate": return_date,
            }
        )

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
    if direct_only:
        search_query["searchModifiers"] = {"isDirectFlight": True}

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
