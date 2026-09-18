"""Deterministic demo provider (PHASE 12).

Rule-based extraction, NOT a language model. It exists so the endpoint, the
validation and the frontend flow can be exercised before an AI key is
configured. It never invents flights, fares, schedules or availability.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

from app.schemas.assistant import AssistantTurnRequest, TravelRequirements

from .base import AssistantInterpretation, AssistantProvider

PLACES: dict[str, tuple[str, str]] = {
    "ahmedabad": ("AMD", "Ahmedabad"),
    "mumbai": ("BOM", "Mumbai"),
    "bombay": ("BOM", "Mumbai"),
    "delhi": ("DEL", "Delhi"),
    "bengaluru": ("BLR", "Bengaluru"),
    "bangalore": ("BLR", "Bengaluru"),
    "hyderabad": ("HYD", "Hyderabad"),
    "chennai": ("MAA", "Chennai"),
    "kolkata": ("CCU", "Kolkata"),
    "pune": ("PNQ", "Pune"),
    "goa": ("GOI", "Goa"),
    "jaipur": ("JAI", "Jaipur"),
    "kochi": ("COK", "Kochi"),
    "dubai": ("DXB", "Dubai"),
    "abu dhabi": ("AUH", "Abu Dhabi"),
    "doha": ("DOH", "Doha"),
    "muscat": ("MCT", "Muscat"),
    "singapore": ("SIN", "Singapore"),
    "bangkok": ("BKK", "Bangkok"),
    "kuala lumpur": ("KUL", "Kuala Lumpur"),
    "bali": ("DPS", "Bali"),
    "maldives": ("MLE", "Maldives"),
    "colombo": ("CMB", "Colombo"),
    "kathmandu": ("KTM", "Kathmandu"),
    "london": ("LHR", "London"),
    "paris": ("CDG", "Paris"),
    "istanbul": ("IST", "Istanbul"),
    "new york": ("JFK", "New York"),
    "toronto": ("YYZ", "Toronto"),
    "sydney": ("SYD", "Sydney"),
}

MONTHS = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
]


def _find_place(text: str) -> tuple[str, str] | None:
    lower = text.lower()
    best: tuple[int, str, str] | None = None
    for alias, (code, label) in PLACES.items():
        at = lower.find(alias)
        if at >= 0 and (best is None or at < best[0]):
            best = (at, code, label)
    if best:
        return best[1], best[2]
    match = re.search(r"\b([A-Z]{3})\b", text)
    if match:
        return match.group(1), match.group(1)
    return None


def _parse_date(text: str, today: date) -> date | None:
    lower = text.lower()

    iso = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", lower)
    if iso:
        try:
            return date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
        except ValueError:
            return None

    dmy = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b", lower)
    if dmy:
        try:
            return date(int(dmy.group(3)), int(dmy.group(2)), int(dmy.group(1)))
        except ValueError:
            return None

    day_month = re.search(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+({'|'.join(MONTHS)})\b", lower)
    month_day = re.search(rf"\b({'|'.join(MONTHS)})\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", lower)
    if day_month or month_day:
        day = int(day_month.group(1) if day_month else month_day.group(2))  # type: ignore[union-attr]
        name = day_month.group(2) if day_month else month_day.group(1)  # type: ignore[union-attr]
        month = MONTHS.index(name) + 1
        for year in (today.year, today.year + 1):
            try:
                candidate = date(year, month, day)
            except ValueError:
                return None
            if candidate >= today:
                return candidate
        return None

    if "day after tomorrow" in lower:
        return today + timedelta(days=2)
    if "tomorrow" in lower:
        return today + timedelta(days=1)
    if "next week" in lower:
        return today + timedelta(days=7)
    if "next month" in lower:
        month = today.month + 1
        year = today.year + (1 if month > 12 else 0)
        month = 1 if month > 12 else month
        day = min(today.day, 28)
        return date(year, month, day)
    in_days = re.search(r"\bin (\d{1,2}) days?\b", lower)
    if in_days:
        return today + timedelta(days=int(in_days.group(1)))
    return None


def _parse_cabin(lower: str) -> str | None:
    if re.search(r"premium\s*economy", lower):
        return "premium_economy"
    if "business" in lower:
        return "business"
    if "first class" in lower:
        return "first"
    if "economy" in lower:
        return "economy"
    return None


def _parse_window(fragment: str) -> str | None:
    if re.search(r"early morning|red[- ]?eye", fragment):
        return "early_morning"
    if "morning" in fragment:
        return "morning"
    if "afternoon" in fragment:
        return "afternoon"
    if "evening" in fragment:
        return "evening"
    if "night" in fragment:
        return "night"
    return None


class DemoAssistantProvider(AssistantProvider):
    id = "demo"

    async def interpret(self, request: AssistantTurnRequest) -> AssistantInterpretation:
        today = date.today()
        message = request.message
        lower = message.lower()
        current = request.requirements
        patch: dict[str, object] = {}
        understood: list[str] = []

        # ---- route -------------------------------------------------------
        from_to = re.search(
            r"\bfrom\s+([a-z\s]{3,30}?)\s+to\s+([a-z\s]{3,30}?)(?=[,.]|\s+(?:on|next|in|for|this|tomorrow|with|by)\b|$)",
            message,
            re.IGNORECASE,
        )
        if from_to:
            origin = _find_place(from_to.group(1))
            destination = _find_place(from_to.group(2))
            if origin:
                patch["origin"], patch["origin_label"] = origin
            if destination:
                patch["destination"], patch["destination_label"] = destination
        else:
            to_only = re.search(
                r"\b(?:to|visit|fly to|going to)\s+([a-z\s]{3,30}?)(?=[,.]|\s+(?:on|next|in|for|this|tomorrow|with|by)\b|$)",
                message,
                re.IGNORECASE,
            )
            from_only = re.search(
                r"\b(?:from|departing from|leaving from)\s+([a-z\s]{3,30}?)(?=[,.]|\s+(?:on|next|in|for|this|tomorrow|with|by)\b|$)",
                message,
                re.IGNORECASE,
            )
            if from_only:
                origin = _find_place(from_only.group(1))
                if origin:
                    patch["origin"], patch["origin_label"] = origin
            if to_only:
                destination = _find_place(to_only.group(1))
                if destination:
                    patch["destination"], patch["destination_label"] = destination
            if not from_only and not to_only:
                single = _find_place(message)
                if single:
                    if current.origin and not current.destination:
                        patch["destination"], patch["destination_label"] = single
                    elif not current.origin:
                        patch["origin"], patch["origin_label"] = single

        if patch.get("origin"):
            understood.append(f"departing from {patch.get('origin_label')}")
        if patch.get("destination"):
            understood.append(f"flying to {patch.get('destination_label')}")

        # ---- dates -------------------------------------------------------
        returning = re.search(r"\b(?:return(?:ing)?|coming back|back on)\b([^.]*)", message, re.IGNORECASE)
        departure_source = message.replace(returning.group(0), " ") if returning else message
        departure = _parse_date(departure_source, today)
        if departure:
            patch["departure_date"] = departure
            understood.append("a departure date")
        if returning:
            back = _parse_date(returning.group(1), today)
            if back:
                patch["return_date"] = back
                patch["trip_type"] = "roundtrip"

        duration = re.search(r"\bfor\s+(\d{1,2})\s*(day|days|night|nights|week|weeks)\b", lower)
        if duration:
            amount = int(duration.group(1))
            nights = amount * 7 if "week" in duration.group(2) else amount
            patch["duration_nights"] = nights
            patch["trip_type"] = "roundtrip"
            base = patch.get("departure_date") or current.departure_date
            if isinstance(base, date):
                patch["return_date"] = base + timedelta(days=nights)
            understood.append(f"a {nights}-night trip")

        if re.search(r"\bone[- ]?way\b", lower):
            patch["trip_type"] = "oneway"
        if re.search(r"\bround[- ]?trip\b|\breturn trip\b", lower):
            patch["trip_type"] = "roundtrip"

        # ---- passengers --------------------------------------------------
        adults = re.search(r"(\d{1,2})\s*(?:adults?|grown[- ]?ups?)\b", lower)
        generic = re.search(r"(\d{1,2})\s*(?:passengers?|travellers?|travelers?|people|persons?|pax)\b", lower)
        children = re.search(r"(\d{1,2})\s*(?:child|children|kids?)\b", lower)
        infants = re.search(r"(\d{1,2})\s*(?:infants?|babies|baby)\b", lower)
        if adults:
            patch["adults"] = int(adults.group(1))
        elif generic:
            patch["adults"] = int(generic.group(1))
        if children:
            patch["children"] = int(children.group(1))
        if infants:
            patch["infants"] = int(infants.group(1))
        if re.search(r"\bsolo\b|\bjust me\b|\balone\b", lower):
            patch["adults"] = 1
        if any(key in patch for key in ("adults", "children", "infants")):
            understood.append("traveller counts")

        # ---- preferences -------------------------------------------------
        cabin = _parse_cabin(lower)
        if cabin:
            patch["cabin_class"] = cabin
            understood.append("a cabin preference")

        arrival = re.search(r"\barriv\w*([^.]*)", lower)
        if arrival:
            window = _parse_window(arrival.group(0))
            if window:
                patch["preferred_arrival_window"] = window
                understood.append("a preferred arrival time")
        departure_fragment = lower.replace(arrival.group(0), " ") if arrival else lower
        window = _parse_window(departure_fragment)
        if window:
            patch["preferred_departure_window"] = window
            understood.append("a preferred departure time")

        if re.search(r"\bnon[- ]?stop\b|\bnonstop\b|\bdirect\b|\bno layover\b", lower):
            patch["non_stop_only"] = True
            understood.append("non-stop only")

        if re.search(r"check[- ]?in baggage|checked baggage|luggage|with baggage|\d{1,2}\s*kg", lower):
            patch["baggage_preference"] = "checked_baggage"
        if re.search(r"hand baggage only|cabin bag(?:gage)? only|no check[- ]?in", lower):
            patch["baggage_preference"] = "cabin_only"
        if patch.get("baggage_preference"):
            understood.append("a baggage preference")

        airline = re.search(
            r"\b(air india|indigo|vistara|emirates|etihad|qatar|spicejet|akasa|lufthansa|singapore airlines|air arabia|flydubai)\b",
            lower,
        )
        if airline:
            existing = list(current.preferred_airlines)
            name = airline.group(1).title()
            if name not in existing:
                patch["preferred_airlines"] = existing + [name]
            understood.append("a preferred airline")

        merged = current.model_copy(update={k: v for k, v in patch.items() if v is not None})
        if merged.trip_type is None:
            merged = merged.model_copy(
                update={"trip_type": "roundtrip" if merged.return_date else "oneway"}
            )

        # Re-validate the merged requirements through the schema so an
        # impossible combination is rejected here, not downstream.
        requirements = TravelRequirements.model_validate(merged.model_dump(by_alias=True))

        return AssistantInterpretation(
            reply="",  # the service composes the reply from gaps + understanding
            requirements=requirements,
            understood=understood,
        )
