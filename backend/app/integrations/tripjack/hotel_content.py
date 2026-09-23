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
# Parsers follow the VPS-verified UAT response wrappers exactly:
#   fetch-countries            -> hotelCountries[]
#   fetch-city-regionIds       -> hotelCityRegionIds[], nextCursor, hasMore
#   fetch-hotel-mapping        -> hotels[], pageable{pageNumber,totalPages,...}
#   mapping-sync / deleted     -> hotels[], nextCursor, hasMore
#   fetch-hotel-content        -> hotels[]


def _str(value: Any) -> Optional[str]:
    if isinstance(value, (str, int, float)) and not isinstance(value, bool):
        text = str(value).strip()
        return text or None
    return None


def _list(body: Any, key: str) -> list:
    value = body.get(key) if isinstance(body, dict) else None
    return value if isinstance(value, list) else []


def _cursor_paging(body: Any) -> tuple[Optional[str], bool]:
    block = body if isinstance(body, dict) else {}
    cursor = _str(block.get("nextCursor"))
    return cursor, block.get("hasMore") is True and cursor is not None


def _page_paging(body: Any, requested_page: int) -> bool:
    """pageable.pageNumber / pageable.totalPages -> more pages remain?"""
    pageable = body.get("pageable") if isinstance(body, dict) else None
    if not isinstance(pageable, dict):
        return False
    number = pageable.get("pageNumber")
    total = pageable.get("totalPages")
    if not isinstance(total, int) or isinstance(total, bool):
        return False
    current = number if isinstance(number, int) and not isinstance(number, bool) else requested_page
    return current + 1 < total


# ------------------------------ calls ---------------------------------------

async def fetch_countries(client: TripJackClient) -> list[str]:
    body = await client.get(COUNTRIES_PATH, retries=RETRIES, operation="hotel_content_countries")
    names: list[str] = []
    for item in _list(body, "hotelCountries"):
        name = item.strip() if isinstance(item, str) else None
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
    for raw in _list(body, "hotelCityRegionIds"):
        if not isinstance(raw, dict):
            continue
        region_id = _str(raw.get("cityRegionId"))
        if not region_id:
            continue
        rows.append({
            "city_region_id": region_id,
            "city_name": _str(raw.get("cityName")),
            "region_name": _str(raw.get("regionName")),
            "country_name": _str(raw.get("countryName")),
            "region_type": _str(raw.get("regionType")),
            "full_region_name": _str(raw.get("fullRegionName")),
        })
    next_cursor, has_more = _cursor_paging(body)
    return rows, next_cursor, has_more


def _mapping_rows(
    body: Any,
    country_name: Optional[str] = None,
    region_id: Optional[str] = None,
) -> list[dict]:
    """hotels[] -> {tjHotelId, unicaId}. Only verified keys are written, so an
    upsert never blanks columns the response does not carry (e.g. region_id)."""
    out: dict[str, dict] = {}
    for raw in _list(body, "hotels"):
        if not isinstance(raw, dict):
            continue
        hotel_id = _str(raw.get("tjHotelId"))
        if not hotel_id:
            continue
        row: dict[str, Any] = {"tj_hotel_id": hotel_id, "unica_id": _str(raw.get("unicaId"))}
        if country_name:
            row["country_name"] = country_name
        if region_id:
            row["region_id"] = region_id
        out[hotel_id] = row
    return list(out.values())


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
    authoritative_region = region_ids[0] if region_ids and len(region_ids) == 1 else None
    return _mapping_rows(body, country_name, authoritative_region), _page_paging(body, page)


async def fetch_mapping_changes(
    client: TripJackClient, *, change_type: str, last_update_time: str, cursor: Optional[str]
) -> tuple[list[dict], Optional[str], bool]:
    """NEW / UPDATE via mapping-sync, DELETE via deleted-hotel-mapping.

    Verified request: {"type", "lastUpdateTime" (ISO-8601 OffsetDateTime)}.
    Subsequent pages use TripJack's opaque cursor and response nextCursor.
    """
    if change_type not in ("NEW", "UPDATE", "DELETE"):
        raise ValueError("change_type must be NEW, UPDATE or DELETE")
    path = DELETED_MAPPING_PATH if change_type == "DELETE" else MAPPING_SYNC_PATH
    payload: dict[str, Any] = {"type": change_type, "lastUpdateTime": last_update_time}
    if cursor:
        payload["cursor"] = cursor
    body = await client.post(path, payload, retries=RETRIES, operation=f"hotel_content_{change_type.lower()}")
    rows = _mapping_rows(body)
    next_cursor, has_more = _cursor_paging(body)
    return rows, next_cursor, has_more


async def fetch_content(client: TripJackClient, hotel_ids: list[str]) -> list[dict]:
    if not hotel_ids or len(hotel_ids) > CONTENT_BATCH:
        raise ValueError("hotel content batch must contain 1..100 ids")
    body = await client.post(
        CONTENT_PATH, {"hotelIds": hotel_ids}, retries=RETRIES, operation="hotel_content_details"
    )
    return [x for x in _list(body, "hotels") if isinstance(x, dict)]


# ------------------------------ normalisation -------------------------------

IMAGE_SIZES = ("XXL", "XL", "L", "M")  # verified: images[].links.XXL.href


def _images(raw: Any) -> list[dict]:
    """Verified shape: images[] -> {links: {XXL: {href}}, is_hero_image, caption}.
    Hero image first; https only; deduped; capped."""
    items = raw.get("images") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        return []
    found: list[tuple[bool, dict]] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        links = item.get("links") if isinstance(item.get("links"), dict) else {}
        url = None
        for size in IMAGE_SIZES:
            link = links.get(size)
            href = link.get("href") if isinstance(link, dict) else None
            if isinstance(href, str) and href.startswith("https://"):
                url = href.strip()
                break
        if not url or url in seen:
            continue
        seen.add(url)
        caption = item.get("caption")
        found.append((
            item.get("is_hero_image") is True,
            {"url": url, "caption": caption.strip()[:200] if isinstance(caption, str) and caption.strip() else None},
        ))
    found.sort(key=lambda pair: not pair[0])  # stable: hero first
    return [img for _, img in found[:MAX_IMAGES]]


def _amenities(raw: Any) -> list[str]:
    """Verified shape: amenities is an indexed object {key: {id, name}}."""
    block = raw.get("amenities") if isinstance(raw, dict) else None
    values = block.values() if isinstance(block, dict) else block if isinstance(block, list) else []
    out: list[str] = []
    for item in values:
        name = item.get("name") if isinstance(item, dict) else None
        if isinstance(name, str) and name.strip() and name.strip()[:120] not in out:
            out.append(name.strip()[:120])
    return out[:80]


def _named(value: Any) -> Optional[str]:
    """{id, name} object -> name."""
    if isinstance(value, dict) and isinstance(value.get("name"), str) and value["name"].strip():
        return value["name"].strip()
    return None


def _num(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _text(value: Any) -> Optional[str]:
    if isinstance(value, (str, int, float)) and not isinstance(value, bool):
        text = str(value).strip()
        return text or None
    return _named(value)


def normalise_content(raw: dict) -> Optional[dict]:
    """Verified TripJack v3 fetch-hotel-content hotel -> {hotel, images, amenities, rooms}."""
    hotel_id = _text(raw.get("tjHotelId")) if isinstance(raw, dict) else None
    if not hotel_id:
        return None
    locale = raw.get("locale") if isinstance(raw.get("locale"), dict) else {}
    address = locale.get("address") if isinstance(locale.get("address"), dict) else {}
    coords = locale.get("coordinates") if isinstance(locale.get("coordinates"), dict) else {}
    phones = [p.strip() for p in (locale.get("phone") or []) if isinstance(p, str) and p.strip()]
    chain = _named(raw.get("chain"))
    contact = {k: v for k, v in (("phone", phones or None), ("chain", chain)) if v} or None

    line = " ".join(
        t for t in (_text(address.get("line_1")), _text(address.get("line_2"))) if t
    ) or _text(address.get("line1")) or _text(address.get("address"))

    policies = raw.get("policies")
    descriptions = raw.get("descriptions")

    return {
        "hotel": {
            "tj_hotel_id": hotel_id,
            "unica_id": _text(raw.get("unicaId")),
            "name": _text(raw.get("name")),
            "is_active": raw.get("is_active") is not False,
            "star_rating": _num(raw.get("star_rating")),
            "property_type": _named(raw.get("property_type")),
            "address": line,
            "city": _text(address.get("city")),
            "state": _text(address.get("state_province_name")) or _text(address.get("state")),
            "country": _text(address.get("country")) or _text(address.get("country_code")),
            "postal_code": _text(address.get("postal_code")),
            "latitude": _num(coords.get("lat")),
            "longitude": _num(coords.get("long")),
            "descriptions": descriptions if descriptions not in (None, "", [], {}) else None,
            "policies": policies if policies not in (None, "", [], {}) else None,
            "contact": contact,
            "deleted_at": None,
        },
        "images": [
            {"tj_hotel_id": hotel_id, "position": i, "url": img["url"], "caption": img["caption"]}
            for i, img in enumerate(_images(raw))
        ],
        "amenities": [{"tj_hotel_id": hotel_id, "name": n} for n in _amenities(raw)],
        # Room content was not part of the verified sample; rooms stay empty
        # until a real room payload is confirmed (live Pricing supplies rooms).
        "rooms": [],
    }
