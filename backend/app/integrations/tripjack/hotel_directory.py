"""Destination text -> TripJack hotel ids (`hids`) resolution.

Hotel API v3 removed `cityCode` from the listing request: a search MUST send
hotel ids. TripJack publishes the hotel/city static content separately, so the
mapping is deployment data, not code:

    TRIPJACK_HOTEL_DIRECTORY_PATH=/etc/flynfeel/tripjack-hotels.json

Expected file shape (city key -> hotel ids, plus optional display fields):

    {
      "dubai":  {"city": "Dubai",  "country": "AE", "hids": ["12345", "23456"]},
      "mumbai": {"city": "Mumbai", "country": "IN", "hids": ["34567"]}
    }

Rules:
  * Never invent a hotel id. An unresolvable destination is reported as
    unsupported, and the customer is told we do not cover it yet.
  * The file is read once and cached, with an mtime check so ops can update the
    directory without a restart.
  * A malformed entry is skipped rather than allowed to break search.
"""

from __future__ import annotations

import json
import os
import re
import threading
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from app.core.logging import get_logger, log_extra

logger = get_logger(__name__)

MAX_HIDS_PER_SEARCH = 200
HID_RE = re.compile(r"^[A-Za-z0-9_\-:.]{1,64}$")

_lock = threading.Lock()
_cache: Dict[str, "DirectoryEntry"] = {}
_cache_key: Optional[tuple[str, float]] = None


@dataclass(frozen=True)
class DirectoryEntry:
    key: str
    city: Optional[str]
    country: Optional[str]
    hids: List[str]


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def _load(path: str) -> Dict[str, DirectoryEntry]:
    global _cache, _cache_key
    try:
        stat = os.stat(path)
    except OSError:
        logger.error("hotel_directory_missing")
        return {}

    key = (path, stat.st_mtime)
    with _lock:
        if _cache_key == key and _cache:
            return _cache

        try:
            with open(path, "r", encoding="utf-8") as handle:
                raw = json.load(handle)
        except (OSError, ValueError):
            logger.error("hotel_directory_unreadable")
            return _cache

        entries: Dict[str, DirectoryEntry] = {}
        if isinstance(raw, dict):
            for name, value in raw.items():
                entry = _entry(name, value)
                if entry is None:
                    continue
                entries[entry.key] = entry
                # Also index the human city name and any listed aliases.
                for alias in _aliases(value):
                    entries.setdefault(_normalise(alias), entry)

        _cache = entries
        _cache_key = key
        logger.info("hotel_directory_loaded", extra=log_extra(destinations=len(entries)))
        return entries


def _aliases(value: Any) -> List[str]:
    if not isinstance(value, dict):
        return []
    names = [value.get("city"), value.get("name")]
    extra = value.get("aliases")
    if isinstance(extra, list):
        names.extend(item for item in extra if isinstance(item, str))
    return [name for name in names if isinstance(name, str) and name.strip()]


def _entry(name: Any, value: Any) -> Optional[DirectoryEntry]:
    if not isinstance(name, str) or not name.strip():
        return None
    raw_hids = value.get("hids") if isinstance(value, dict) else value
    if not isinstance(raw_hids, list):
        return None

    hids: List[str] = []
    for item in raw_hids:
        token = str(item).strip() if isinstance(item, (str, int)) else ""
        if token and HID_RE.match(token) and token not in hids:
            hids.append(token)
        if len(hids) >= MAX_HIDS_PER_SEARCH:
            break
    if not hids:
        return None

    city = value.get("city") if isinstance(value, dict) else None
    country = value.get("country") if isinstance(value, dict) else None
    return DirectoryEntry(
        key=_normalise(name),
        city=city if isinstance(city, str) else None,
        country=country if isinstance(country, str) else None,
        hids=hids,
    )


def resolve(destination: str, *, directory_path: str) -> Optional[DirectoryEntry]:
    """Resolve free text to hotel ids, or None when we do not cover it."""
    if not directory_path:
        logger.error("hotel_directory_not_configured")
        return None

    entries = _load(directory_path)
    if not entries:
        return None

    wanted = _normalise(destination)
    if not wanted:
        return None

    exact = entries.get(wanted)
    if exact is not None:
        return exact

    # "dubai marina" -> dubai: accept a prefix match, never a fuzzy guess.
    for key, entry in entries.items():
        if wanted.startswith(key) or key.startswith(wanted):
            return entry
    return None


def reset_cache() -> None:
    """Test/ops hook: force the next resolve() to re-read the file."""
    global _cache, _cache_key
    with _lock:
        _cache = {}
        _cache_key = None
