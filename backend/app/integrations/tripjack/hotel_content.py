"""TripJack Hotel API v3 STATIC CONTENT endpoints (UAT: apitest-hms.tripjack.com).

Read-only catalogue calls. Transient network/5xx failures are retried a little;
nothing here is transactional. Parsing is defensive: unknown shapes are
skipped, never guessed. The API key lives only in the pooled client headers.
"""

from __future__ import annotations

from typing import Any, Optional

from app.integrations.tripjack.client import TripJackClient

COUNTRIES_PATH = "hms/v3/content/fetch-countries"
REGIONS_PATH = "hms/v3/content/fetch-city-regionIds"
MAPPING_PATH = "hms/v3/content/fetch-hotel-mapping"
CONTENT_PATH = "hms/v3/content/fetch-hotel-content"
MAPPING_SYNC_PATH = "hms/v3/content/fetch-hotel-mapping-sync"
DELETED_MAPPING_PATH = "hms/v3/content/fetch-deleted-hotel-mapping"

REGION_LIMIT = 2000
MAPPING_SIZE = 2000
CONTENT_BATCH = 100
RETRIES = 2
MAX_IMAGES = 30


# ------------------------------ helpers -------------------------------------

def _s(raw: Any, *keys: str) -> Optional[str]:
    if not isinstance(raw, dict):
        return None
    for key in keys:
        value = raw.get(key)
        if isinstance(value, (str, int, float)) and not isinstance(value, bool):
            text = str(value).strip()
            if text:
                return text
        if isinstance(value, dict):
            nested = _s(value, "name", "value")
            if nested:
                return nested
    return None


def _n(raw: Any, *keys: str) -> Optional[float]:
    if not isinstance(raw, dict):
        return None
    for key in keys:
        try:
            if raw.get(key) is not None and not isinstance(raw.get(key), bool):
                return float(raw[key])
        except (TypeError, ValueError):
            continue
    return None


def _rows(body: Any, *keys: str) -> list:
    if isinstance(body, list):
        return body
    if not isinstance(body, dict):
        return []
    for key in keys + ("data", "results", "items"):
        value = body.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            inner = _rows(value, *keys)
            if inner:
                return inner
    return []


def _paging(body: Any) -> tuple[Optional[str], bool]:
    block = body if isinstance(body, dict) else {}
    for scope in (block, block.get("data") if isinstance(block.get("data"), dict) else {}):
        if "hasMore" in scope or "nextCursor" in scope:
            cursor = scope.get("nextCursor")
            return (str(cursor) if cursor else None), bool(scope.get("hasMore")) and bool(cursor)
    return None, False


# ------------------------------ calls ---------------------------------------

async def fetch_countries(client: TripJackClient) -> list[str]:
    body = await client.get(COUNTRIES_PATH, retries=RETRIES, operation="hotel_content_countries")
    names: list[str] = []
    for item in _rows(body, "countries", "countryList"):
        name = item.strip() if isinstance(item, str) else _s(item, "countryName", "name")
        if name and name not in names:
            names.append(name)
    return names


async def fetch_regions_page(
    client: TripJackClient, cursor: Optional[str]
) -> tuple[list[dict], Optional[str], bool]:
    params: dict[str, Any] = {"limit": REGION_LIMIT}
    if cursor:
        params["cursor"] = cursor
    body = await client.get(REGIONS_PATH, params, retries=RETRIES, operation="hotel_content_regions")
    rows = []
    for raw in _rows(body, "regions", "cityRegionIds", "cities"):
        region_id = _s(raw, "cityRegionId", "regionId", "id")
        if not region_id:
            continue
        rows.append({
            "city_region_id": region_id,
            "city_name": _s(raw, "cityName", "city"),
            "region_name": _s(raw, "regionName"),
            "country_name": _s(raw, "countryName", "country"),
            "region_type": _s(raw, "regionType", "type"),
            "full_region_name": _s(raw, "fullRegionName"),
        })
    next_cursor, has_more = _paging(body)
    return rows, next_cursor, has_more


def _mapping_row(raw: Any, fallback_country: Optional[str] = None) -> Optional[dict]:
    hotel_id = _s(raw, "tjHotelId", "hotelId", "id")
    if not hotel_id:
        return None
    return {
        "tj_hotel_id": hotel_id,
        "unica_id": _s(raw, "unicaId"),
        "region_id": _s(raw, "cityRegionId", "regionId"),
        "country_name": _s(raw, "countryName") or fallback_country,
    }


async def fetch_mapping_page(
    client: TripJackClient,
    *,
    page: int,
    country_name: Optional[str] = None,
    region_ids: Optional[list[str]] = None,
    size: int = MAPPING_SIZE,
) -> tuple[list[dict], bool]:
    payload: dict[str, Any] = {"page": page, "size": min(size, MAPPING_SIZE)}
    if country_name:
        payload["countryName"] = country_name
    if region_ids:
        payload["regionIds"] = region_ids
    body = await client.post(MAPPING_PATH, payload, retries=RETRIES, operation="hotel_content_mapping")
    raw_rows = _rows(body, "hotelMappings", "mappings", "hotels")
    rows = [r for r in (_mapping_row(x, country_name) for x in raw_rows) if r]
    block = body if isinstance(body, dict) else {}
    total_pages = block.get("totalPages")
    if isinstance(total_pages, int):
        has_more = page + 1 < total_pages if block.get("page", page) == page else page < total_pages
    else:
        has_more = len(raw_rows) >= payload["size"]
    return rows, has_more


async def fetch_mapping_changes(
    client: TripJackClient, *, change_type: str, last_update_time: str, cursor: Optional[str]
) -> tuple[list[dict], Optional[str], bool]:
    """NEW / UPDATE via mapping-sync, DELETE via deleted-hotel-mapping."""
    path = DELETED_MAPPING_PATH if change_type == "DELETE" else MAPPING_SYNC_PATH
    payload: dict[str, Any] = {"type": change_type, "lastUpdateTime": last_update_time}
    if cursor:
        payload["cursor"] = cursor
    body = await client.post(path, payload, retries=RETRIES, operation=f"hotel_content_{change_type.lower()}")
    rows = [r for r in (_mapping_row(x) for x in _rows(body, "hotelMappings", "mappings", "hotels")) if r]
    next_cursor, has_more = _paging(body)
    return rows, next_cursor, has_more


async def fetch_content(client: TripJackClient, hotel_ids: list[str]) -> list[dict]:
    if not hotel_ids or len(hotel_ids) > CONTENT_BATCH:
        raise ValueError("hotel content batch must contain 1..100 ids")
    body = await client.post(
        CONTENT_PATH, {"hotelIds": hotel_ids}, retries=RETRIES, operation="hotel_content_details"
    )
    return [x for x in _rows(body, "hotels", "hotelContent", "hotelContents") if isinstance(x, dict)]


# ------------------------------ normalisation -------------------------------

def _images(raw: Any) -> list[dict]:
    out: list[dict] = []
    if not isinstance(raw, dict):
        return out
    for key in ("images", "img", "hotelImages"):
        items = raw.get(key)
        if not isinstance(items, list):
            continue
        for item in items:
            url = item if isinstance(item, str) else _s(item, "url", "imageUrl", "link", "l", "m")
            if url and url.startswith("https://") and all(i["url"] != url for i in out):
                out.append({"url": url, "caption": _s(item, "caption", "title", "type")})
            if len(out) >= MAX_IMAGES:
                return out
    return out


def _names(raw: Any, *keys: str) -> list[str]:
    out: list[str] = []
    if not isinstance(raw, dict):
        return out
    for key in keys:
        items = raw.get(key)
        if not isinstance(items, list):
            continue
        for item in items:
            name = item.strip() if isinstance(item, str) else _s(item, "name", "title", "value")
            if name and name not in out:
                out.append(name[:120])
    return out[:80]


def _json(raw: Any, *keys: str) -> Any:
    if not isinstance(raw, dict):
        return None
    for key in keys:
        value = raw.get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def normalise_content(raw: dict) -> Optional[dict]:
    """-> {hotel, images, amenities, rooms} or None when unusable."""
    hotel_id = _s(raw, "tjHotelId", "hotelId", "id")
    if not hotel_id:
        return None
    address = raw.get("address") if isinstance(raw.get("address"), dict) else {}
    geo = next(
        (raw[k] for k in ("geolocation", "geoLocation", "location", "gl") if isinstance(raw.get(k), dict)),
        {},
    )
    active_raw = raw.get("isActive", raw.get("active", raw.get("status")))
    is_active = (
        active_raw if isinstance(active_raw, bool)
        else str(active_raw).strip().lower() not in {"inactive", "false", "0", "deleted"}
        if active_raw is not None else True
    )
    contact = _json(raw, "contact", "contactInfo")
    if isinstance(contact, dict):
        contact = {k: contact[k] for k in ("phone", "email", "website", "fax") if contact.get(k)}

    rooms = []
    for index, room in enumerate(raw.get("rooms") or raw.get("roomInfo") or []):
        if not isinstance(room, dict):
            continue
        rooms.append({
            "tj_hotel_id": hotel_id,
            "room_key": _s(room, "id", "roomId", "code") or f"room-{index}",
            "name": _s(room, "name", "roomName"),
            "description": _s(room, "description"),
            "amenities": _names(room, "amenities", "facilities") or None,
            "images": [i["url"] for i in _images(room)] or None,
        })

    return {
        "hotel": {
            "tj_hotel_id": hotel_id,
            "unica_id": _s(raw, "unicaId"),
            "name": _s(raw, "name", "hotelName"),
            "is_active": bool(is_active),
            "star_rating": _n(raw, "starRating", "rating", "rt"),
            "property_type": _s(raw, "propertyType", "pt", "category"),
            "address": _s(address, "line1", "addressLine1", "adr", "address") or _s(raw, "addressLine"),
            "city": _s(address, "city", "cityName") or _s(raw, "cityName"),
            "state": _s(address, "state", "stateName"),
            "country": _s(address, "country", "countryName") or _s(raw, "countryName"),
            "postal_code": _s(address, "postalCode", "zipCode", "postal"),
            "latitude": _n(geo, "lat", "latitude", "ln"),
            "longitude": _n(geo, "lng", "lon", "longitude", "lt"),
            "descriptions": _json(raw, "descriptions", "description", "des"),
            "policies": _json(raw, "policies", "policy", "hotelPolicies"),
            "contact": contact or None,
            "deleted_at": None,
        },
        "images": [
            {"tj_hotel_id": hotel_id, "position": i, "url": img["url"], "caption": img["caption"]}
            for i, img in enumerate(_images(raw))
        ],
        "amenities": [
            {"tj_hotel_id": hotel_id, "name": name}
            for name in _names(raw, "amenities", "facilities", "hotelFacilities")
        ],
        "rooms": rooms,
    }
