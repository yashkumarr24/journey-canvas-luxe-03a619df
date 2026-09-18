"""Admin analytics aggregation (PHASE 10).

Mirrors src/lib/analytics/admin-analytics.ts so the dashboard sees identical
shapes whether the numbers were computed in the browser (local test mode) or
here. Aggregation is deliberately simple and read-only.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

IDLE_AFTER = timedelta(minutes=30)

FLIGHT_FUNNEL = [
    ("search", "Search", "flight_search"),
    ("results", "Results", "flight_results_viewed"),
    ("selection", "Selection", "flight_selected"),
    ("review", "Review", "flight_review_started"),
    ("travellers", "Traveller details", "flight_traveller_details_completed"),
    ("checkout", "Checkout", "flight_checkout_started"),
    ("payment", "Payment", "flight_payment_started"),
    ("booking", "Booking", "flight_booking_completed"),
]

HOTEL_FUNNEL = [
    ("search", "Search", "hotel_search"),
    ("results", "Results", "hotel_results_viewed"),
    ("selection", "Hotel / room selection", "hotel_room_selected"),
    ("review", "Review", "hotel_review_started"),
    ("guests", "Guest details", "hotel_guest_details_completed"),
    ("checkout", "Checkout", "hotel_checkout_started"),
    ("payment", "Payment", "hotel_payment_started"),
    ("booking", "Booking", "hotel_booking_completed"),
]


def _parse(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _in_range(value: Any, start: Optional[datetime], end: Optional[datetime]) -> bool:
    moment = _parse(value)
    if moment is None:
        return False
    if start and moment < start:
        return False
    if end and moment > end:
        return False
    return True


def _count(events: Iterable[Dict[str, Any]], name: str) -> int:
    return sum(1 for event in events if event.get("event_name") == name)


def _sessions_of(events: Iterable[Dict[str, Any]], names: Iterable[str]) -> set:
    wanted = set(names)
    return {
        event.get("session_id")
        for event in events
        if event.get("event_name") in wanted and event.get("session_id")
    }


def overview(
    sessions: List[Dict[str, Any]],
    events: List[Dict[str, Any]],
    *,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
) -> Dict[str, Any]:
    scoped = [e for e in events if _in_range(e.get("occurred_at"), start, end)]
    now = datetime.now(timezone.utc)

    searched = _sessions_of(scoped, {"flight_search", "hotel_search"})
    booked = _sessions_of(scoped, {"flight_booking_completed", "hotel_booking_completed"})
    active = 0
    for session in sessions:
        last = _parse(session.get("last_activity_at"))
        if session.get("status") != "ended" and last and now - last < IDLE_AFTER:
            active += 1

    abandoned = max(0, len(searched) - len(booked))
    return {
        "active_sessions": active,
        "total_sessions": len({e.get("session_id") for e in scoped if e.get("session_id")}),
        "authenticated_users": len({e.get("user_id") for e in scoped if e.get("user_id")}),
        "guest_sessions": len(
            {e.get("session_id") for e in scoped if not e.get("user_id")}
        ),
        "flight_searches": _count(scoped, "flight_search"),
        "hotel_searches": _count(scoped, "hotel_search"),
        "checkouts_started": _count(scoped, "flight_checkout_started")
        + _count(scoped, "hotel_checkout_started"),
        "payments_started": _count(scoped, "flight_payment_started")
        + _count(scoped, "hotel_payment_started"),
        "bookings_completed": _count(scoped, "flight_booking_completed")
        + _count(scoped, "hotel_booking_completed"),
        "bookings_failed": _count(scoped, "flight_booking_failed")
        + _count(scoped, "hotel_booking_failed"),
        "abandoned_sessions": abandoned,
        "conversion_rate": 0.0
        if not searched
        else round(len(booked) / len(searched) * 100, 1),
        "total_events": len(scoped),
    }


def activity(
    sessions: List[Dict[str, Any]],
    events: List[Dict[str, Any]],
    limit: int = 30,
) -> List[Dict[str, Any]]:
    last_event: Dict[str, str] = {}
    for event in events:
        session_id = event.get("session_id")
        if session_id:
            last_event[session_id] = str(event.get("event_name") or "")

    ordered = sorted(
        sessions,
        key=lambda s: _parse(s.get("last_activity_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )[:limit]

    return [
        {
            "session_id": session.get("session_id"),
            "identity": "User" if session.get("user_id") else "Guest",
            "current_page": session.get("current_page"),
            "last_event": last_event.get(str(session.get("session_id"))),
            "device": session.get("device_category"),
            "last_activity_at": session.get("last_activity_at"),
        }
        for session in ordered
    ]


def funnel(
    events: List[Dict[str, Any]],
    vertical: str,
    *,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    steps = FLIGHT_FUNNEL if vertical == "flight" else HOTEL_FUNNEL
    scoped = [e for e in events if _in_range(e.get("occurred_at"), start, end)]

    rows: List[Dict[str, Any]] = []
    first = 0
    previous = 0
    for index, (key, label, event_name) in enumerate(steps):
        matched = [e for e in scoped if e.get("event_name") == event_name]
        unique_sessions = len({e.get("session_id") for e in matched if e.get("session_id")})
        if index == 0:
            first = unique_sessions
            previous = unique_sessions
        rows.append(
            {
                "key": key,
                "label": label,
                "event_count": len(matched),
                "unique_sessions": unique_sessions,
                "unique_users": len({e.get("user_id") for e in matched if e.get("user_id")}),
                "reached_pct": 0.0 if not first else round(unique_sessions / first * 100, 1),
                "dropped_sessions": 0 if index == 0 else max(0, previous - unique_sessions),
            }
        )
        previous = unique_sessions
    return rows
