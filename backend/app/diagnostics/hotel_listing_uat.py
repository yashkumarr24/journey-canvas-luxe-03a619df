"""Safe, sequential TripJack Hotel V3 Listing UAT diagnostics (operator CLI).

Run on the VPS (whitelisted IP), from `backend/`:

    python -m app.diagnostics.hotel_listing_uat select  --destination Goa
    python -m app.diagnostics.hotel_listing_uat listing --destination Goa --count 5 [--follow-page]
    python -m app.diagnostics.hotel_listing_uat probe-limit --destination Goa --sizes 5,25,50,100,200
    python -m app.diagnostics.hotel_listing_uat endpoint --destination Goa
    python -m app.diagnostics.hotel_listing_uat detail --destination Goa [--hotel-id ID]
    python -m app.diagnostics.hotel_listing_uat review --destination Goa [--hotel-id ID] [--option-id ID]

    python -m app.diagnostics.hotel_listing_uat book --destination Goa          # DRY RUN (no Book call)
    python -m app.diagnostics.hotel_listing_uat book --destination Goa --execute-uat-hold \
        --confirm CREATE-UAT-HOLD --contact-email ops@... --contact-phone 9xxxxxxxxx [--cancel-after]

`book` is a DRY RUN by default: search -> detail -> review, then it only BUILDS
the documented Book body and prints its field names/types. With the explicit
flags it sends a HOLD booking (never paymentInfos, never an instant booking)
to the UAT booker host — this DOES create a real UAT hold booking.

The `review` mode is READ-ONLY re-pricing: search -> detail -> review. It never
calls Book, never makes a payment and never writes review/booking records.

Guarantees:
  * Uses the existing hotel config/client (same host, `apikey` header, timeouts).
  * Never prints the API key, headers or the raw provider body. Only STRUCTURE
    (keys, types, list lengths), hotel ids, and numeric price-field values.
  * Nothing is written to the database or logs except the normal search
    session created by the `endpoint` mode (same as a real customer search).
  * Requests are strictly sequential with a pause between probe sizes and the
    probe stops at the first rejection. Refuses a production TripJack host.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from datetime import date, timedelta
from typing import Any

from app.core.config import get_settings
from app.integrations.tripjack import hotels as tj_hotels
from app.integrations.tripjack.client import API_KEY_HEADER, get_hotel_client
from app.integrations.tripjack.config import build_hotel_config
from app.integrations.tripjack.hotel_wire import (
    HOTEL_LISTING_PATH,
    HOTEL_PRICING_PATH,
    HOTEL_REVIEW_PATH,
    build_listing_continuation_payload,
    build_pricing_payload,
    build_review_payload,
    correlation_id,
)
from app.repositories.hotel_catalogue import HotelCatalogueRepository, _in

PRICE_KEY = re.compile(r"^(tp|TF|BF|TAF|OT|mf|mft|total.*|price.*|.*fare.*|amount|tax.*|net.*)$", re.I)
PAGE_KEY = re.compile(r"(page|next|token|offset|more|cursor|searchid|total|count)", re.I)
ID_KEYS = ("id", "hotelId", "hid", "tjHotelId", "code")
OPTION_KEYS = ("ops", "options", "ratePlans", "rates", "roomRates", "rooms", "ris")
PROBE_PAUSE_SECONDS = 3.0


# --------------------------- sanitising helpers -----------------------------


def shape(value: Any, depth: int = 0, max_depth: int = 6) -> Any:
    """Structure only: keys, value TYPES and list lengths. No values."""
    if depth >= max_depth:
        return "…"
    if isinstance(value, dict):
        return {k: shape(v, depth + 1, max_depth) for k, v in value.items()}
    if isinstance(value, list):
        return {"__list_len__": len(value), "__item__": shape(value[0], depth + 1, max_depth) if value else None}
    return type(value).__name__


def price_fields(value: Any, path: str = "", out: dict | None = None, limit: int = 40) -> dict[str, Any]:
    """Numeric values of price-like keys only (safe to show; not secret)."""
    out = {} if out is None else out
    if len(out) >= limit:
        return out
    if isinstance(value, dict):
        for k, v in value.items():
            p = f"{path}.{k}" if path else k
            if PRICE_KEY.match(k) and isinstance(v, (int, float)) and not isinstance(v, bool):
                out[p] = v
            else:
                price_fields(v, p, out, limit)
    elif isinstance(value, list) and value:
        price_fields(value[0], path + "[0]", out, limit)
    return out


def find_lists(body: dict) -> dict[str, int]:
    """Every list of dicts (path -> length), to locate the hotel list key."""
    found: dict[str, int] = {}

    def walk(v: Any, p: str, d: int) -> None:
        if d > 3:
            return
        if isinstance(v, dict):
            for k, x in v.items():
                walk(x, f"{p}.{k}" if p else k, d + 1)
        elif isinstance(v, list) and v and isinstance(v[0], dict):
            found[p] = len(v)

    walk(body, "", 0)
    return found


def pagination_fields(body: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for scope, block in (("", body), ("searchResult.", body.get("searchResult") or {})):
        if isinstance(block, dict):
            for k, v in block.items():
                if PAGE_KEY.search(k) and not isinstance(v, (dict, list)):
                    # ids/tokens are opaque handles, show only presence + length
                    out[scope + k] = f"{type(v).__name__}(len={len(str(v))})" if isinstance(v, str) else repr(v)
    return out


def raw_ids(items: list) -> list[str]:
    ids = []
    for it in items:
        if isinstance(it, dict):
            for k in ID_KEYS:
                if it.get(k) not in (None, ""):
                    ids.append(str(it[k]))
                    break
    return ids


# ------------------------------- core ---------------------------------------


def _config():
    settings = get_settings()
    config = build_hotel_config(settings)
    if not config.is_configured:
        raise SystemExit("TripJack hotel config missing (TRIPJACK_API_KEY / host).")
    if config.targets_production:
        raise SystemExit("Refusing: hotel host is a PRODUCTION TripJack host. UAT only.")
    return settings, config


async def _raw_post(config, payload: dict, path: str = HOTEL_LISTING_PATH) -> tuple[int, Any, float]:
    """Same client/host/headers/timeouts as production, but returns the status
    and decoded body even on errors so the structure can be inspected."""
    client = get_hotel_client(config)
    http = await client._ensure_client()  # noqa: SLF001 - diagnostic reuse of the pool
    headers = {API_KEY_HEADER: config.api_key, "Content-Type": "application/json"}
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    resp = await http.post("/" + path, json=payload, headers=headers)
    elapsed = round(loop.time() - t0, 2)
    try:
        body = resp.json()
    except ValueError:
        body = None
    return resp.status_code, body, elapsed


async def select_ids(destination: str, count: int) -> tuple[list[str], dict]:
    settings = get_settings()
    repo = HotelCatalogueRepository(settings)
    if not repo.enabled:
        raise SystemExit("Supabase service config missing; cannot read the catalogue.")
    db = repo._db  # noqa: SLF001
    ids = await repo.resolve_hids(destination)
    stats: dict[str, Any] = {"destination": destination, "selected_ids": len(ids)}
    term = re.sub(r"[^A-Za-z0-9 _\-.'&]", "", destination).strip()
    regions = await db.select("hotel_regions", columns="city_region_id",
                              filters={"or": f"(city_name.ilike.{term}*,region_name.ilike.{term}*)"}, limit=50)
    stats["matching_regions"] = len(regions)
    if not ids:
        return [], stats
    maps: list[dict] = []
    hotel_rows: list[dict] = []
    for i in range(0, len(ids), 50):  # keep URLs short
        chunk = ids[i:i + 50]
        maps += await db.select("hotel_mappings", columns="tj_hotel_id,content_synced_at,content_unavailable_at,content_error_at",
                                filters={"tj_hotel_id": _in(chunk)}, limit=len(chunk))
        hotel_rows += await db.select("hotels", columns="tj_hotel_id,is_active",
                                      filters={"tj_hotel_id": _in(chunk)}, limit=len(chunk))
    synced = {m["tj_hotel_id"] for m in maps if m.get("content_synced_at")}
    unavailable = {m["tj_hotel_id"] for m in maps if m.get("content_unavailable_at")}
    has_row = {h["tj_hotel_id"] for h in hotel_rows}
    stats.update(
        with_synced_content=len(synced),
        content_unavailable=len(unavailable),
        content_error=sum(1 for m in maps if m.get("content_error_at")),
        no_hotel_row=len([i for i in ids if i not in has_row]),
    )
    # Controlled list for the probe: synced-content hotels first.
    ordered = [i for i in ids if i in synced] + [i for i in ids if i not in synced]
    return ordered[:count], stats


def parser_report(body: dict, requested: list[str], currency: str) -> dict:
    page = tj_hotels.normalize_listing_response(body, currency=currency)
    items = tj_hotels._raw_hotel_list(body)  # noqa: SLF001
    returned = raw_ids(items)
    parsed = page.results
    first = items[0] if items and isinstance(items[0], dict) else {}
    opts = next((first.get(k) for k in OPTION_KEYS if isinstance(first.get(k), list) and first.get(k)), None)

    def filled(attr: str) -> int:
        return sum(1 for r in parsed if getattr(r, attr) not in (None, [], ""))

    return {
        "parser_found_hotel_list": bool(items),
        "raw_hotel_items": len(items),
        "raw_ids_returned": returned[:20],
        "returned_not_requested": [i for i in returned if i not in requested][:10],
        "requested_not_returned": len([i for i in requested if i not in returned]),
        "parsed_hotels": len(parsed),
        "dropped_by_parser": len(items) - len(parsed),
        "first_result_fields": sorted(first.keys()),
        "first_option_fields": sorted(opts[0].keys()) if opts and isinstance(opts[0], dict) else None,
        "detected_price_fields_first_result": price_fields(first),
        "parsed_fill_counts": {a: filled(a) for a in ("name", "star_rating", "location", "images", "amenities", "rate", "rate_plans")},
        "parsed_rate_plan_types": sorted({p.type for r in parsed for p in (r.rate_plans or [])}),
        "parsed_first_total": parsed[0].rate.total_price.amount if parsed and parsed[0].rate else None,
        "pagination_parsed": {"search_id_present": bool(page.search_id),
                              "next_token_present": bool(page.next_token), "has_more": page.has_more},
    }


def dates(days_ahead: int, nights: int) -> tuple[str, str]:
    ci = date.today() + timedelta(days=days_ahead)
    return ci.isoformat(), (ci + timedelta(days=nights)).isoformat()


UAT_NATIONALITY_INDIA = "106"  # TripJack countryId for India (Nationalities endpoint)
UAT_MAX_HIDS = 100  # documented max hids per listing request


def _hid(value: str) -> int | str:
    s = str(value).strip()
    return int(s) if s.isdigit() else s


def build_uat_listing_payload(
    *,
    hids: list[str],
    check_in: str,
    check_out: str,
    rooms: list[dict[str, Any]],
    nationality: str = UAT_NATIONALITY_INDIA,
    currency: str = "INR",
    timeout_ms: int | None = None,
) -> dict[str, Any]:
    """Diagnostic-only listing payload per the official TripJack Hotel API v3
    reference (tripjack.com/page/api-doc, POST /hms/v3/hotel/listing).

    The v3 body is FLAT — no `searchQuery`, `roomInfo` or `searchCriteria`
    wrappers (those belong to the older v1/v2 search shape still used by
    production hotel_wire.py). errCode 6521 persisted because TripJack reads
    checkIn/checkOut/currency from the top level only.

    Documented fields: checkIn, checkOut, rooms[{adults, children, childAge}],
    currency, correlationId, nationality (TripJack countryId, e.g. "106"),
    hids (integer[], max 100), optional timeoutMs.
    Do not merge into hotel_wire.py until production is deliberately migrated.
    """
    room_list: list[dict[str, Any]] = []
    for room in rooms:
        entry: dict[str, Any] = {"adults": int(room.get("adults") or 1)}
        ages = [int(a) for a in room.get("childAges") or []]
        if ages:
            entry["children"] = len(ages)
            entry["childAge"] = ages
        room_list.append(entry)
    payload: dict[str, Any] = {
        "checkIn": check_in,
        "checkOut": check_out,
        "rooms": room_list,
        "currency": currency.upper(),
        "correlationId": correlation_id(),
        "nationality": str(nationality),
        "hids": [_hid(h) for h in hids],
    }
    if timeout_ms:
        payload["timeoutMs"] = int(timeout_ms)
    return payload


async def run_listing(args) -> None:
    _, config = _config()
    if args.hids_file:
        with open(args.hids_file) as fh:
            ids = [s.strip() for s in fh.read().split(",") if s.strip()]
        print(f"using {len(ids)} ids from {args.hids_file}")
    elif args.hids:
        ids = [s.strip() for s in args.hids.split(",") if s.strip()]
    else:
        ids = (await select_ids(args.destination, args.count))[0]
    if not ids:
        raise SystemExit("No hotel ids to test.")
    ci, co = dates(args.days_ahead, args.nights)
    payload = build_uat_listing_payload(hids=ids, check_in=ci, check_out=co,
                                        rooms=[{"adults": args.adults, "childAges": []}], currency="INR")
    print("REQUEST (keys only):", json.dumps(shape(payload), indent=1))
    print("requested_hids:", len(ids), "check_in:", ci, "check_out:", co)
    status, body, elapsed = await _raw_post(config, payload)
    _print_response(status, body, elapsed)
    if isinstance(body, dict):
        print("PARSER:", json.dumps(parser_report(body, ids, "INR"), indent=1, default=str))
        if args.follow_page:
            page = tj_hotels.normalize_listing_response(body, currency="INR")
            if not page.search_id:
                print("follow-page: no searchId detected; nothing to continue.")
                return
            cont = build_listing_continuation_payload(search_id=page.search_id, next_token=page.next_token)
            print("CONTINUATION REQUEST (keys only):", shape(cont))
            s2, b2, e2 = await _raw_post(config, cont)
            _print_response(s2, b2, e2)


def _print_response(status: int, body: Any, elapsed: float) -> None:
    print("HTTP status:", status, "elapsed_s:", elapsed)
    if not isinstance(body, dict):
        print("body: non-JSON or not an object")
        return
    print("top_level_keys:", sorted(body.keys()))
    print("status_block:", body.get("status") if isinstance(body.get("status"), dict) else None)
    if body.get("errors"):
        errs = body["errors"] if isinstance(body["errors"], list) else [body["errors"]]
        print("errors:", [{k: (str(v)[:160]) for k, v in e.items() if k in ("errCode", "code", "message", "details")}
                          for e in errs if isinstance(e, dict)][:5])
    print("lists_of_objects:", find_lists(body))
    print("pagination_fields:", pagination_fields(body))
    print("RESPONSE SHAPE:", json.dumps(shape(body), indent=1)[:6000])


def _type_value(v: Any) -> dict[str, Any]:
    """Type + value only for numeric price fields; never strings/objects."""
    if isinstance(v, bool) or v is None:
        return {"type": type(v).__name__, "value": v}
    if isinstance(v, (int, float)):
        return {"type": type(v).__name__, "value": v}
    return {"type": type(v).__name__, "value": None}


def probe_summary(body: Any, requested: list[str]) -> dict[str, Any]:
    """Sanitised per-probe summary: IDs, key names and price numbers only."""
    items = [h for h in (tj_hotels._raw_hotel_list(body) if isinstance(body, dict) else [])  # noqa: SLF001
             if isinstance(h, dict)]
    returned: list[str] = []
    for h in items:
        for k in ("tjHotelId",) + ID_KEYS:
            if h.get(k) not in (None, ""):
                returned.append(str(h[k]))
                break
    first = items[0] if items else {}
    options = first.get("options") if isinstance(first.get("options"), list) else []
    opt = options[0] if options and isinstance(options[0], dict) else {}
    pricing = opt.get("pricing") if isinstance(opt.get("pricing"), dict) else {}
    req = {str(x) for x in requested}
    return {
        "requested_count": len(requested),
        "returned_count": len(items),
        "returned_hids": returned,
        "returned_not_requested": [r for r in returned if r not in req],
        "first_hotel_keys": sorted(first.keys()),
        "first_hotel_options_count": len(options),
        "first_option_keys": sorted(opt.keys()),
        "first_option_pricing_keys": sorted(pricing.keys()),
        "first_option_price_fields": {k: _type_value(pricing[k]) if k in pricing else "absent"
                                      for k in ("totalPrice", "mf", "mft")},
    }


async def run_probe(args) -> None:
    _, config = _config()
    sizes = sorted(int(s) for s in args.sizes.split(","))
    ids, _ = await select_ids(args.destination, max(sizes))
    ci, co = dates(args.days_ahead, args.nights)
    print("probe check_in:", ci, "check_out:", co)
    last_ok: list[str] = []
    for n in sizes:
        if n > len(ids):
            print(f"size {n}: only {len(ids)} ids available; stopping.")
            break
        payload = build_uat_listing_payload(hids=ids[:n], check_in=ci, check_out=co,
                                            rooms=[{"adults": args.adults, "childAges": []}], currency="INR")
        status, body, elapsed = await _raw_post(config, payload)
        ok = status < 400 and isinstance(body, dict) and not body.get("errors") and \
            (body.get("status") or {}).get("success") is not False
        items = tj_hotels._raw_hotel_list(body) if isinstance(body, dict) else []  # noqa: SLF001
        errs = body.get("errors") if isinstance(body, dict) else None
        print(f"size {n}: http={status} ok={ok} hotels={len(items)} elapsed_s={elapsed} "
              f"errors={json.dumps(errs, default=str)[:300] if errs else None}")
        if not ok:
            print("stopping at first rejection.")
            break
        print(f"size {n} SUMMARY:", json.dumps(probe_summary(body, ids[:n]), indent=1, default=str))
        last_ok = ids[:n]
        await asyncio.sleep(PROBE_PAUSE_SECONDS)
    if args.save_ids and last_ok:
        with open(args.save_ids, "w") as fh:
            fh.write(",".join(last_ok))
        print(f"saved {len(last_ok)} requested ids of the largest successful probe to {args.save_ids}")


async def run_select(args) -> None:
    ids, stats = await select_ids(args.destination, 200)
    print(json.dumps(stats, indent=1))


async def run_endpoint(args) -> None:
    import httpx
    from app.main import create_app

    settings, config = _config()
    ci, co = dates(args.days_ahead, args.nights)
    body = {"destination": args.destination, "checkIn": ci, "checkOut": co, "rooms": [{"adults": args.adults}]}
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://diag") as c:
        r = await c.post("/api/v1/hotels/search", json=body)
    text = r.text
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    print("HTTP status:", r.status_code)
    print("top_level_keys:", sorted(data.keys()) if isinstance(data, dict) else None)
    if r.status_code >= 400:
        print("error body:", text[:400])
    results = data.get("results") or []
    print("results:", len(results))
    if results:
        print("first_result_fields:", sorted(results[0].keys()))
        print("first_result_rate:", results[0].get("rate"))
    leaks = {
        "api_key_in_body": bool(config.api_key) and config.api_key in text,
        "service_role_in_body": bool(settings.supabase_service_role_key) and settings.supabase_service_role_key in text,
        "raw_provider_keys_in_body": [k for k in ("searchResult", "his", "ops", "tp", "correlationId") if f'"{k}"' in text],
    }
    print("leak_checks:", leaks)
    print("session_search_id_present:", bool(data.get("searchId")), "expires_at:", data.get("expiresAt"))


# ------------------------------ detail (pricing) ----------------------------


def build_uat_pricing_payload(
    *,
    listing_correlation_id: str,
    hid: str,
    check_in: str,
    check_out: str,
    rooms: list[dict[str, Any]],
    currency: str,
    nationality: str = UAT_NATIONALITY_INDIA,
    timeout_ms: int | None = 13000,
) -> dict[str, Any]:
    """Documented /hms/v3/hotel/pricing body (FLAT). correlationId MUST be the
    listing's; dates/rooms/currency must match the listing. Diagnostic only."""
    payload = build_uat_listing_payload(
        hids=[], check_in=check_in, check_out=check_out, rooms=rooms,
        nationality=nationality, currency=currency, timeout_ms=timeout_ms,
    )
    payload.pop("hids")
    payload["correlationId"] = listing_correlation_id
    payload["hid"] = str(hid)
    return payload


def detail_summary(body: Any, requested_hid: str) -> dict[str, Any]:
    """Sanitised pricing reply: keys, counts, ids, price TYPES/numbers only.
    Never hotel/room names, option ids, reviewHash values or booking notes."""
    if not isinstance(body, dict):
        return {"json_object": False}
    options = [o for o in body.get("options") or [] if isinstance(o, dict)] \
        if isinstance(body.get("options"), list) else []
    first = options[0] if options else {}
    pricing = first.get("pricing") if isinstance(first.get("pricing"), dict) else {}
    rinfo = [r for r in first.get("roomInfo") or [] if isinstance(r, dict)] \
        if isinstance(first.get("roomInfo"), list) else []
    canc = first.get("cancellation") if isinstance(first.get("cancellation"), dict) else {}
    returned = next((str(body[k]) for k in ("tjHotelId", "hotelId", "hid") if body.get(k) not in (None, "")), None)
    arith = None
    if all(isinstance(pricing.get(k), (int, float)) for k in ("totalPrice", "basePrice", "taxes", "mf", "mft")):
        arith = round(pricing["basePrice"] + pricing["taxes"] + pricing["mf"] + pricing["mft"] - pricing["totalPrice"], 2)
    status = body.get("status") if isinstance(body.get("status"), dict) else {}
    return {
        "top_level_keys": sorted(body.keys()),
        "status_success": status.get("success"),
        "requested_hid": str(requested_hid),
        "returned_hid": returned,
        "hid_matches": returned == str(requested_hid) if returned else None,
        "correlation_id_present": bool(body.get("correlationId")),
        "review_hash_present": bool(body.get("reviewHash")),
        "options_count": len(options),
        "option_types": sorted({str(o.get("optionType")) for o in options if o.get("optionType")}),
        "options_with_option_id": sum(1 for o in options if o.get("optionId")),
        "options_with_pricing": sum(1 for o in options if isinstance(o.get("pricing"), dict)),
        "first_option_keys": sorted(first.keys()),
        "first_option_roominfo_count": len(rinfo),
        "first_option_roominfo_keys": sorted(rinfo[0].keys()) if rinfo else [],
        "first_option_meal_basis_type": type(first.get("mealBasis")).__name__ if first else None,
        "first_option_inclusions_count": len(first.get("inclusions") or []) if isinstance(first.get("inclusions"), list) else None,
        "first_option_pricing_keys": sorted(pricing.keys()),
        "first_option_price_fields": {k: _type_value(pricing[k]) if k in pricing else "absent"
                                      for k in ("totalPrice", "basePrice", "discount", "taxes", "mf", "mft", "strikethrough")},
        "base_plus_taxes_mf_mft_minus_total": arith,
        "first_option_cancellation_keys": sorted(canc.keys()),
        "first_option_penalties_count": len(canc.get("penalties") or []) if isinstance(canc.get("penalties"), list) else None,
        "first_option_compliance_keys": sorted(first["compliance"].keys()) if isinstance(first.get("compliance"), dict) else [],
        "first_option_commercial_keys": sorted(first["commercial"].keys()) if isinstance(first.get("commercial"), dict) else [],
    }


def compare_with_production(documented: dict[str, Any], hid: str, search_id: str) -> dict[str, Any]:
    """Key-level diff between what production would send and the docs."""
    prod = build_pricing_payload(
        listing_correlation_id=search_id, hid=hid,
        check_in=documented["checkIn"], check_out=documented["checkOut"],
        rooms=[{"adults": r.get("adults"), "childAges": r.get("childAge") or []} for r in documented["rooms"]],
        nationality=documented.get("nationality"), currency=documented.get("currency"),
    )
    return {
        "production_keys": sorted(prod.keys()),
        "documented_keys": sorted(documented.keys()),
        "missing_in_production": sorted(set(documented) - set(prod)),
        "extra_in_production": sorted(set(prod) - set(documented)),
        "production_reuses_listing_correlation_id": prod.get("correlationId") == documented.get("correlationId"),
        "payloads_identical": prod == documented,
    }


def _rooms_from_session(session) -> list[dict[str, Any]]:
    return [{"adults": r.adults, "childAges": list(r.child_ages)} for r in session.rooms]


async def _session_via_search(args, settings):
    """Run a normal /api/v1/hotels/search in-process and load its saved session."""
    import httpx
    from app.main import create_app
    from app.services import hotel_sessions as sessions

    ci, co = dates(args.days_ahead, args.nights)
    body = {"destination": args.destination, "checkIn": ci, "checkOut": co, "rooms": [{"adults": args.adults}]}
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://diag") as c:
        r = await c.post("/api/v1/hotels/search", json=body)
    print("search HTTP status:", r.status_code)
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    token = data.get("searchId") if isinstance(data, dict) else None
    if r.status_code >= 400 or not token:
        raise SystemExit("Search did not produce a session; cannot test detail.")
    print("search results:", len(data.get("results") or []))
    session = await sessions.get_search_session(settings=settings, search_id=token)
    if session is None:
        raise SystemExit("Saved search session could not be loaded.")
    return session


def pick_hotel(session, wanted: str = "") -> str | None:
    if wanted:
        return wanted if wanted in session.results else None
    priced = [hid for hid, r in session.results.items() if getattr(r, "rate", None)]
    return (priced or list(session.results))[0] if session.results else None


async def run_detail(args) -> None:
    settings, config = _config()
    if args.search_id:
        from app.services import hotel_sessions as sessions
        session = await sessions.get_search_session(settings=settings, search_id=args.search_id)
        if session is None:
            raise SystemExit("Search session not found or expired.")
    else:
        session = await _session_via_search(args, settings)
    if not session.provider_search_id:
        raise SystemExit("Session has no listing correlationId; cannot drive pricing.")
    hid = pick_hotel(session, args.hotel_id)
    if not hid:
        raise SystemExit("No hotel id from this search session (or --hotel-id not in it).")
    payload = build_uat_pricing_payload(
        listing_correlation_id=session.provider_search_id, hid=hid,
        check_in=session.check_in, check_out=session.check_out,
        rooms=_rooms_from_session(session), currency=session.currency,
    )
    print("session: results=", len(session.results), "check_in:", session.check_in,
          "check_out:", session.check_out, "rooms:", len(session.rooms), "currency:", session.currency)
    print("REQUEST (keys only):", json.dumps(shape(payload), indent=1))
    print("PRODUCTION vs DOCS:", json.dumps(compare_with_production(payload, hid, session.provider_search_id), indent=1))
    status, body, elapsed = await _raw_post(config, payload, HOTEL_PRICING_PATH)
    print("HTTP status:", status, "elapsed_s:", elapsed)
    if isinstance(body, dict) and body.get("errors"):
        errs = body["errors"] if isinstance(body["errors"], list) else [body["errors"]]
        print("errors:", [{k: str(v)[:160] for k, v in e.items() if k in ("errCode", "code", "message")}
                          for e in errs if isinstance(e, dict)][:5])
    print("DETAIL SUMMARY:", json.dumps(detail_summary(body, hid), indent=1, default=str))


# ------------------------------ review (re-price) ---------------------------
#
# Documented /hms/v3/hotel/review body (TripJack v3 docs, "Review API"):
#   {"correlationId": <listing correlationId>, "optionId": <from detail>,
#    "reviewHash": <from detail>, "hid": <hotel id string>}
# Dates/rooms/currency/nationality are NOT part of the documented review body;
# TripJack ties them to the correlationId from listing/detail. The optional
# "with-context" variant adds them only to test whether UAT demands them.
# Reply: correlationId, tjHotelId, hotelName, bookingId, option{...}, onholdAllowed,
# status{success}; errors use {"status":{"success":false},"error":{code,message,requestId}}.

REVIEW_PROVIDER_ONLY_FIELDS = (
    "correlationId", "reviewHash", "bookingId", "optionId", "commercial",
    "compliance.gstType", "pricing.gstClaimableAmount", "error.requestId", "onholdAllowed",
)


def build_uat_review_payload(
    *,
    listing_correlation_id: str,
    hid: str,
    option_id: str,
    review_hash: str,
    variant: str = "documented",
    check_in: str = "",
    check_out: str = "",
    rooms: list[dict[str, Any]] | None = None,
    currency: str = "INR",
    nationality: str = UAT_NATIONALITY_INDIA,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "correlationId": listing_correlation_id,
        "optionId": str(option_id),
        "reviewHash": review_hash,
        "hid": str(hid),
    }
    if variant == "with-context":
        ctx = build_uat_pricing_payload(
            listing_correlation_id=listing_correlation_id, hid=hid, check_in=check_in,
            check_out=check_out, rooms=rooms or [], currency=currency,
            nationality=nationality, timeout_ms=None,
        )
        for k in ("checkIn", "checkOut", "rooms", "currency", "nationality"):
            payload[k] = ctx[k]
    return payload


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def select_detail_option(body: Any, wanted: str = "") -> dict[str, Any] | None:
    """Pick the requested option (or the cheapest priced one) from a detail reply."""
    if not isinstance(body, dict) or not isinstance(body.get("options"), list):
        return None
    opts = [o for o in body["options"] if isinstance(o, dict) and o.get("optionId")
            and isinstance(o.get("pricing"), dict) and _num(o["pricing"].get("totalPrice")) is not None]
    if wanted:
        return next((o for o in opts if str(o["optionId"]) == wanted), None)
    return min(opts, key=lambda o: _num(o["pricing"]["totalPrice"])) if opts else None


def _error_summary(body: Any) -> list[dict[str, str]]:
    if not isinstance(body, dict):
        return []
    raw = body.get("errors") or body.get("error")
    errs = raw if isinstance(raw, list) else [raw] if raw else []
    return [{k: str(v)[:160] for k, v in e.items() if k in ("errCode", "code", "message")}
            for e in errs if isinstance(e, dict)][:5]


def review_summary(body: Any, requested_hid: str, detail_option: dict[str, Any] | None) -> dict[str, Any]:
    """Sanitised review reply. Never names, option ids, reviewHash, bookingId,
    correlation ids, booking notes, headers or keys."""
    if not isinstance(body, dict):
        return {"json_object": False}
    opt = body.get("option") if isinstance(body.get("option"), dict) else {}
    if not opt and isinstance(body.get("options"), list) and body["options"] and isinstance(body["options"][0], dict):
        opt = body["options"][0]
    pricing = opt.get("pricing") if isinstance(opt.get("pricing"), dict) else {}
    rinfo = [r for r in opt.get("roomInfo") or [] if isinstance(r, dict)] if isinstance(opt.get("roomInfo"), list) else []
    canc = opt.get("cancellation") if isinstance(opt.get("cancellation"), dict) else {}
    status = body.get("status") if isinstance(body.get("status"), dict) else {}
    returned = next((str(body[k]) for k in ("tjHotelId", "hotelId", "hid") if body.get(k) not in (None, "")), None)
    arith = None
    if all(_num(pricing.get(k)) is not None for k in ("totalPrice", "basePrice", "taxes", "mf", "mft")):
        arith = round(pricing["basePrice"] + pricing["taxes"] + pricing["mf"] + pricing["mft"] - pricing["totalPrice"], 2)
    d_total = _num(((detail_option or {}).get("pricing") or {}).get("totalPrice"))
    r_total = _num(pricing.get("totalPrice"))
    penalties = canc.get("penalties") if isinstance(canc.get("penalties"), list) else []
    return {
        "top_level_keys": sorted(body.keys()),
        "status_success": status.get("success"),
        "errors": _error_summary(body),
        "requested_hid": str(requested_hid),
        "returned_hid": returned,
        "hid_matches": returned == str(requested_hid) if returned else None,
        "correlation_id_present": bool(body.get("correlationId")),
        "review_hash_present": bool(body.get("reviewHash") or opt.get("reviewHash")),
        "booking_id_present": bool(body.get("bookingId")),
        "onhold_allowed_type": type(body["onholdAllowed"]).__name__ if "onholdAllowed" in body else "absent",
        "option_container": "option" if isinstance(body.get("option"), dict) else ("options[]" if opt else "absent"),
        "option_keys": sorted(opt.keys()),
        "option_id_matches_selected": (str(opt.get("optionId")) == str(detail_option.get("optionId"))
                                       if opt.get("optionId") and detail_option else None),
        "option_type": opt.get("optionType"),
        "option_type_matches_selected": (opt.get("optionType") == detail_option.get("optionType")
                                         if opt.get("optionType") and detail_option and detail_option.get("optionType") else None),
        "roominfo_count_matches_selected": (len(rinfo) == len(detail_option.get("roomInfo") or [])
                                            if detail_option and isinstance(detail_option.get("roomInfo"), list) else None),
        "roominfo_count": len(rinfo),
        "roominfo_keys": sorted(rinfo[0].keys()) if rinfo else [],
        "meal_basis_type": type(opt.get("mealBasis")).__name__ if opt else None,
        "inclusions_count": len(opt["inclusions"]) if isinstance(opt.get("inclusions"), list) else None,
        "booking_notes_present": bool(opt.get("bookingNotes")),
        "pricing_keys": sorted(pricing.keys()),
        "price_fields": {k: _type_value(pricing[k]) if k in pricing else "absent"
                         for k in ("totalPrice", "basePrice", "discount", "taxes", "mf", "mft",
                                   "gstClaimableAmount", "strikethrough", "currency")},
        "base_plus_taxes_mf_mft_minus_total": arith,
        "detail_total_price": d_total,
        "review_total_price": r_total,
        "review_total_matches_detail": (round(r_total - d_total, 2) == 0) if None not in (r_total, d_total) else None,
        "review_minus_detail_total": round(r_total - d_total, 2) if None not in (r_total, d_total) else None,
        "cancellation_keys": sorted(canc.keys()),
        "cancellation_is_refundable": canc.get("isRefundable"),
        "cancellation_penalties_count": len(penalties),
        "cancellation_penalty_keys": sorted(penalties[0].keys()) if penalties and isinstance(penalties[0], dict) else [],
        "cancellation_penalty_amounts": [_num(p.get("amount")) for p in penalties if isinstance(p, dict)][:10],
        "deadline_present": bool(canc.get("deadlineDateTime") or opt.get("deadlineDateTime")),
        "compliance_keys": sorted(opt["compliance"].keys()) if isinstance(opt.get("compliance"), dict) else [],
        "commercial_keys": sorted(opt["commercial"].keys()) if isinstance(opt.get("commercial"), dict) else [],
        "provider_only_fields_never_to_browser": list(REVIEW_PROVIDER_ONLY_FIELDS),
    }


def compare_review_with_production(documented: dict[str, Any], hid: str, option_id: str, search_id: str) -> dict[str, Any]:
    prod = build_review_payload(listing_correlation_id=search_id, hid=hid, option_id=option_id,
                                review_hash=documented.get("reviewHash") or "")
    return {
        "production_keys": sorted(prod.keys()),
        "documented_keys": sorted(documented.keys()),
        "missing_in_production": sorted(set(documented) - set(prod)),
        "extra_in_production": sorted(set(prod) - set(documented)),
        "production_reuses_listing_correlation_id": prod.get("correlationId") == documented.get("correlationId"),
        "payloads_identical": prod == documented,
    }


async def run_review(args) -> None:
    """READ-ONLY: search session -> detail -> review. Never books or pays."""
    settings, config = _config()
    if args.search_id:
        from app.services import hotel_sessions as sessions
        session = await sessions.get_search_session(settings=settings, search_id=args.search_id)
        if session is None:
            raise SystemExit("Search session not found or expired.")
    else:
        session = await _session_via_search(args, settings)
    if not session.provider_search_id:
        raise SystemExit("Session has no listing correlationId; cannot drive review.")
    hid = pick_hotel(session, args.hotel_id)
    if not hid:
        raise SystemExit("No hotel id from this search session (or --hotel-id not in it).")
    rooms = _rooms_from_session(session)
    detail_payload = build_uat_pricing_payload(
        listing_correlation_id=session.provider_search_id, hid=hid, check_in=session.check_in,
        check_out=session.check_out, rooms=rooms, currency=session.currency,
    )
    print("session: results=", len(session.results), "check_in:", session.check_in,
          "check_out:", session.check_out, "rooms:", len(session.rooms), "currency:", session.currency)
    status, detail, elapsed = await _raw_post(config, detail_payload, HOTEL_PRICING_PATH)
    print("DETAIL HTTP status:", status, "elapsed_s:", elapsed)
    if status >= 400 or not isinstance(detail, dict):
        print("detail errors:", _error_summary(detail))
        raise SystemExit("Detail call failed; cannot review.")
    option = select_detail_option(detail, getattr(args, "option_id", ""))
    review_hash = detail.get("reviewHash")
    print("detail options:", len(detail.get("options") or []), "option_selected:", bool(option),
          "review_hash_present:", bool(review_hash))
    if not option:
        raise SystemExit("No priced option in detail (or --option-id not found).")
    if not review_hash:
        raise SystemExit("Detail returned no reviewHash; review requires it.")
    variant = getattr(args, "review_variant", "documented") or "documented"
    payload = build_uat_review_payload(
        listing_correlation_id=session.provider_search_id, hid=hid, option_id=str(option["optionId"]),
        review_hash=str(review_hash), variant=variant, check_in=session.check_in,
        check_out=session.check_out, rooms=rooms, currency=session.currency,
    )
    print("REVIEW variant:", variant)
    print("REVIEW REQUEST (keys/types only):", json.dumps(shape(payload), indent=1))
    print("PRODUCTION vs DOCS:", json.dumps(
        compare_review_with_production(payload, hid, str(option["optionId"]), session.provider_search_id), indent=1))
    await asyncio.sleep(1.0)
    status, body, elapsed = await _raw_post(config, payload, HOTEL_REVIEW_PATH)
    print("REVIEW HTTP status:", status, "elapsed_s:", elapsed)
    print("REVIEW SUMMARY:", json.dumps(review_summary(body, hid, option), indent=1, default=str))
    print("NOTE: no booking was created and no payment was made.")


# ------------------------------- book (UAT hold) ----------------------------
#
# Documented (TripJack v3 docs "Book API"), NOT yet confirmed live:
#   POST https://apitest-hotel-booker.tripjack.com/oms/v3/hotel/book   (separate host!)
#   {"bookingId": <Review bookingId>, "type": "HOTEL",
#    "roomTravellerInfo": [{"travellerInfo": [{"ti","pt","fN","lN", "pan"?, "pNum"?}]}],  # one per room, search order
#    "deliveryInfo": {"emails": [..], "contacts": [..], "code": ["+91"]},
#    "gstInfo"?: {"gstNumber", "registeredName"},     # when detail/review gives reseller/passthrough GST
#    "paymentInfos"?: [{"amount": <review totalPrice>}]}  # present = INSTANT (charges wallet); absent = HOLD
# Reply: {"bookingId", "status": {"success"}, "metaInfo"} — async; poll
#   /oms/v3/hotel/booking-details {"bookingId"} every 5s up to 180s for order.status
#   (SUCCESS / ON_HOLD terminal ok; ABORTED / FAILED terminal fail).
# Hold is auto-cancelled at cancellation.deadlineDateTime unless confirmed via
# /oms/v3/hotel/confirm-book. Cancel: POST /oms/v3/hotel/cancel-booking/{bookingId}.

UAT_BOOKER_BASE_URL = "https://apitest-hotel-booker.tripjack.com"
HOTEL_BOOK_PATH = "oms/v3/hotel/book"
HOTEL_BOOKING_DETAILS_PATH = "oms/v3/hotel/booking-details"
HOTEL_CANCEL_BOOKING_PATH = "oms/v3/hotel/cancel-booking"
BOOK_CONFIRM_PHRASE = "CREATE-UAT-HOLD"
BOOKING_TERMINAL = {"SUCCESS", "ON_HOLD", "ABORTED", "FAILED", "CANCELLED"}
BOOK_PROVIDER_ONLY_FIELDS = ("bookingId", "hotelConfirmationNumber", "metaInfo", "order.markup",
                             "gstInfo", "deliveryInfo", "travellerInfo", "pan", "pNum")
_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _test_name(i: int) -> str:
    # Synthetic, alphabetic, unique per guest (lead pax must be unique across rooms).
    return "Uat" + _LETTERS[i // 26 % 26].lower() + _LETTERS[i % 26].lower()


def build_uat_book_payload(
    *,
    booking_id: str,
    rooms: list[dict[str, Any]],
    email: str,
    phone: str,
    dial_code: str = "+91",
    pan: str = "",
    passport: str = "",
    gst_info: dict[str, str] | None = None,
    pans: list[str] | None = None,
) -> dict[str, Any]:
    """Documented HOLD body. paymentInfos is NEVER included: this diagnostic
    must not create an instant (wallet-charged) booking.

    `pan` is a per-traveller field in the TripJack Book contract. Pass `pans`
    (one value per traveller, in search room/guest order) to give each
    traveller their own PAN; a single `pan` is applied to every traveller.
    `pans` must match the total traveller count exactly."""
    if not booking_id:
        raise ValueError("missing_booking_id")
    total_travellers = sum(
        int(r.get("adults") or 0) + len(r.get("childAges") or r.get("childAge") or [])
        for r in rooms
    )
    if pans is not None and len(pans) != total_travellers:
        raise ValueError("pans_count_mismatch")
    room_info = []
    n = 0
    for r in rooms:
        travellers = []
        for _ in range(int(r.get("adults") or 0)):
            travellers.append({"ti": "Mr", "pt": "ADULT", "fN": _test_name(n), "lN": "Diagnostic"})
            n += 1
        for _ in (r.get("childAges") or r.get("childAge") or []):
            travellers.append({"ti": "Master", "pt": "CHILD", "fN": _test_name(n), "lN": "Diagnostic"})
            n += 1
        first_guest = n - len(travellers)
        for gi, t in enumerate(travellers):
            own_pan = pans[first_guest + gi] if pans else pan
            if own_pan:
                t["pan"] = own_pan
            if passport:
                t["pNum"] = passport
        room_info.append({"travellerInfo": travellers})
    payload: dict[str, Any] = {
        "bookingId": booking_id,
        "roomTravellerInfo": room_info,
        "deliveryInfo": {"emails": [email], "contacts": [phone], "code": [dial_code]},
        "type": "HOTEL",
    }
    if gst_info:
        payload["gstInfo"] = dict(gst_info)
    assert "paymentInfos" not in payload
    return payload


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z ]{1,49}$")
_DIAL_RE = re.compile(r"^\+[0-9]{1,4}$")
ADULT_TITLES = {"Mr", "Mrs", "Ms"}
CHILD_TITLES = {"Master", "Miss"}


def validate_book_payload(
    payload: dict[str, Any],
    rooms: list[dict[str, Any]],
    *,
    pan_required: bool | None = None,
    passport_required: bool | None = None,
) -> list[str]:
    """Local pre-flight checks against the documented Book contract. Returns
    failure CODES only (never the offending values)."""
    fails: list[str] = []
    if not isinstance(payload.get("bookingId"), str) or not payload["bookingId"].strip():
        fails.append("bookingId: missing or not a non-empty string")
    if payload.get("type") != "HOTEL":
        fails.append("type: must be 'HOTEL'")
    if "paymentInfos" in payload:
        fails.append("paymentInfos: must be absent for a HOLD")
    d = payload.get("deliveryInfo")
    if not isinstance(d, dict):
        fails.append("deliveryInfo: missing")
    else:
        emails, contacts, codes = d.get("emails"), d.get("contacts"), d.get("code")
        if not (isinstance(emails, list) and emails and all(isinstance(e, str) and _EMAIL_RE.match(e) for e in emails)):
            fails.append("deliveryInfo.emails: must be a non-empty list of valid email addresses")
        elif any(e.lower().endswith((".invalid", "example.com", "example.invalid")) for e in emails):
            fails.append("deliveryInfo.emails: placeholder address; pass --contact-email")
        if not (isinstance(contacts, list) and contacts and all(isinstance(c, str) and c.isdigit() for c in contacts)):
            fails.append("deliveryInfo.contacts: must be a non-empty list of digit-only phone numbers")
        if not (isinstance(codes, list) and codes and all(isinstance(c, str) and _DIAL_RE.match(c) for c in codes)):
            fails.append("deliveryInfo.code: must be a list of dial codes like '+91'")
        if isinstance(contacts, list) and isinstance(codes, list):
            if len(contacts) != len(codes):
                fails.append("deliveryInfo: contacts and code must have the same length")
            for c, k in zip(contacts, codes):
                if k == "+91" and isinstance(c, str) and not (len(c) == 10 and c[:1] in "6789"):
                    fails.append("deliveryInfo.contacts: Indian (+91) number must be 10 digits starting 6-9, without +91/0")
                    break
    rti = payload.get("roomTravellerInfo")
    if not isinstance(rti, list) or not rti:
        fails.append("roomTravellerInfo: missing or empty")
        return fails
    if len(rti) != len(rooms):
        fails.append("roomTravellerInfo: room count differs from the search rooms")
    leads = []
    for ri, (block, room) in enumerate(zip(rti, rooms)):
        tis = block.get("travellerInfo") if isinstance(block, dict) else None
        if not isinstance(tis, list) or not tis:
            fails.append(f"room[{ri}].travellerInfo: missing or empty")
            continue
        adults = int(room.get("adults") or 0)
        children = len(room.get("childAges") or room.get("childAge") or [])
        pts = [t.get("pt") for t in tis if isinstance(t, dict)]
        if pts.count("ADULT") != adults or pts.count("CHILD") != children or len(pts) != len(tis):
            fails.append(f"room[{ri}].travellerInfo: ADULT/CHILD counts differ from the search occupancy")
        for gi, t in enumerate(tis):
            if not isinstance(t, dict):
                continue
            where = f"room[{ri}].guest[{gi}]"
            titles = ADULT_TITLES if t.get("pt") == "ADULT" else CHILD_TITLES
            if t.get("ti") not in titles:
                fails.append(f"{where}.ti: title not valid for {t.get('pt')}")
            for k in ("fN", "lN"):
                if not (isinstance(t.get(k), str) and _NAME_RE.match(t[k])):
                    fails.append(f"{where}.{k}: must be 2-50 letters/spaces")
            if pan_required and not (isinstance(t.get("pan"), str) and _PAN_RE.match(t["pan"])):
                fails.append(f"{where}.pan: required by Review and must match AAAAA9999A")
            elif "pan" in t and not (isinstance(t["pan"], str) and _PAN_RE.match(t["pan"])):
                fails.append(f"{where}.pan: present but not in AAAAA9999A format")
            if passport_required and not (isinstance(t.get("pNum"), str) and t["pNum"].strip()):
                fails.append(f"{where}.pNum: required by Review")
        lead = tis[0]
        if isinstance(lead, dict):
            leads.append((str(lead.get("fN", "")).lower(), str(lead.get("lN", "")).lower()))
    if len(set(leads)) != len(leads):
        fails.append("roomTravellerInfo: lead guest name must be unique across rooms")
    return fails


def book_created(status: int, body: Any) -> bool:
    """A booking exists only on 2xx + status.success true + a bookingId."""
    if not (200 <= status < 300) or not isinstance(body, dict):
        return False
    st = body.get("status") if isinstance(body.get("status"), dict) else {}
    return st.get("success") is True and bool(body.get("bookingId")) and not body.get("errors") and not body.get("error")


def book_requirements(review_body: Any) -> dict[str, Any]:
    """What the Book call will need, derived from the Review reply only."""
    opt = review_body.get("option") if isinstance(review_body, dict) and isinstance(review_body.get("option"), dict) else {}
    comp = opt.get("compliance") if isinstance(opt.get("compliance"), dict) else {}
    canc = opt.get("cancellation") if isinstance(opt.get("cancellation"), dict) else {}
    pricing = opt.get("pricing") if isinstance(opt.get("pricing"), dict) else {}
    gst_type = comp.get("gstType")
    return {
        "booking_id_present": bool(isinstance(review_body, dict) and review_body.get("bookingId")),
        "pan_required": comp.get("panRequired"),
        "passport_required": comp.get("passportRequired"),
        "gst_type": gst_type,
        "gst_info_needed": gst_type in ("PASSTHROUGH", "RESELLER"),
        "onhold_allowed": str(review_body.get("onholdAllowed")).lower() == "true" if isinstance(review_body, dict) and "onholdAllowed" in review_body else None,
        "hold_deadline_present": bool(canc.get("deadlineDateTime")),
        "is_refundable": canc.get("isRefundable"),
        "review_total_price": _num(pricing.get("totalPrice")),
        "instant_booking_would_send_amount": _num(pricing.get("totalPrice")),
    }


def book_summary(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        return {"json_object": False}
    status = body.get("status") if isinstance(body.get("status"), dict) else {}
    return {
        "top_level_keys": sorted(body.keys()),
        "status_success": status.get("success"),
        "booking_id_present": bool(body.get("bookingId")),
        "meta_info_keys": sorted(body["metaInfo"].keys()) if isinstance(body.get("metaInfo"), dict) else [],
        "errors": _error_summary(body),
    }


def booking_details_summary(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        return {"json_object": False}
    order = body.get("order") if isinstance(body.get("order"), dict) else {}
    hotel = ((body.get("itemInfos") or {}).get("HOTEL") or {}) if isinstance(body.get("itemInfos"), dict) else {}
    ops = (hotel.get("hInfo") or {}).get("ops") if isinstance(hotel.get("hInfo"), dict) else None
    op = ops[0] if isinstance(ops, list) and ops and isinstance(ops[0], dict) else {}
    cnp = op.get("cnp") if isinstance(op.get("cnp"), dict) else {}
    status = body.get("status") if isinstance(body.get("status"), dict) else {}
    return {
        "top_level_keys": sorted(body.keys()),
        "status_success": status.get("success"),
        "order_status": order.get("status"),
        "order_amount": _num(order.get("amount")),
        "order_keys": sorted(order.keys()),
        "option_total_price": _num(op.get("tp")),
        "option_refundable": cnp.get("ifra"),
        "option_penalties_count": len(cnp.get("pd") or []) if isinstance(cnp.get("pd"), list) else None,
        "hold_deadline_present": bool(op.get("ddt")),
        "pan_required": op.get("ipr"),
        "passport_required": op.get("ipm"),
        "hotel_confirmation_number_present": bool(body.get("hotelConfirmationNumber")),
        "errors": _error_summary(body),
    }


def _booker_base() -> str:
    import os
    base = (os.environ.get("TRIPJACK_HOTEL_BOOKER_URL") or UAT_BOOKER_BASE_URL).rstrip("/")
    host = base.split("//", 1)[-1].split("/", 1)[0].lower()
    if not host.startswith("apitest"):
        raise SystemExit("Refusing: booker host is not a TripJack UAT (apitest*) host.")
    return base


async def _booker_post(config, path: str, payload: dict | None) -> tuple[int, Any, float]:
    import httpx
    headers = {API_KEY_HEADER: config.api_key, "Content-Type": "application/json"}
    loop = asyncio.get_running_loop()
    async with httpx.AsyncClient(base_url=_booker_base(), timeout=httpx.Timeout(40.0, connect=5.0)) as http:
        t0 = loop.time()
        resp = await http.post("/" + path, json=payload, headers=headers) if payload is not None \
            else await http.post("/" + path, headers=headers)
        elapsed = round(loop.time() - t0, 2)
    try:
        body = resp.json()
    except ValueError:
        body = None
    return resp.status_code, body, elapsed


def review_hold_allowed(review_body: Any) -> bool | None:
    """Hold eligibility exactly as TripJack states it in the Review reply.

    True only when `onholdAllowed` / `onHoldAllowed` (top level, or on the
    reviewed option) is boolean True or the string "true". False when explicitly
    false; None when absent. Price, refundability, option order or deadlines are
    never used to infer hold eligibility."""
    if not isinstance(review_body, dict):
        return None
    opt = review_body.get("option") if isinstance(review_body.get("option"), dict) else {}
    seen: bool | None = None
    for src in (review_body, opt):
        for key in ("onholdAllowed", "onHoldAllowed"):
            if key not in src:
                continue
            v = src[key]
            if v is True or (isinstance(v, str) and v.strip().lower() == "true"):
                return True
            if v is False or (isinstance(v, str) and v.strip().lower() == "false"):
                seen = False
    return seen


def hold_candidate_summary(review_body: Any, detail_option: dict[str, Any] | None) -> dict[str, Any]:
    """Operator-safe facts for a reviewed option. Never ids, hashes, PAN, notes or payloads."""
    body = review_body if isinstance(review_body, dict) else {}
    opt = body.get("option") if isinstance(body.get("option"), dict) else {}
    rinfo = opt.get("roomInfo") if isinstance(opt.get("roomInfo"), list) else []
    pricing = opt.get("pricing") if isinstance(opt.get("pricing"), dict) else {}
    canc = opt.get("cancellation") if isinstance(opt.get("cancellation"), dict) else {}
    total = _num(pricing.get("totalPrice"))
    if total is None:
        total = _num(((detail_option or {}).get("pricing") or {}).get("totalPrice"))
    return {
        "hotel_name": body.get("hotelName"),
        "option_type": opt.get("optionType") or (detail_option or {}).get("optionType"),
        "room_name": ", ".join(str(r.get("name")) for r in rinfo if isinstance(r, dict) and r.get("name")) or None,
        "total_price": total,
        "hold_allowed": review_hold_allowed(body),
        "is_refundable": canc.get("isRefundable"),
    }


def _detail_candidates(detail: Any, wanted: str = "") -> list[dict[str, Any]]:
    """Priced detail options, cheapest first; only the requested one with --option-id."""
    if wanted:
        one = select_detail_option(detail, wanted)
        return [one] if one else []
    if not isinstance(detail, dict) or not isinstance(detail.get("options"), list):
        return []
    opts = [o for o in detail["options"] if isinstance(o, dict) and o.get("optionId")
            and isinstance(o.get("pricing"), dict) and _num(o["pricing"].get("totalPrice")) is not None]
    return sorted(opts, key=lambda o: _num(o["pricing"]["totalPrice"]))


async def _fresh_review(args):
    """search -> fresh detail -> review. Returns (config, session, detail_option, review_body).

    With --require-hold, reviews each priced option of the same hotel (cheapest
    first, up to --max-hold-candidates) and returns the first whose Review
    explicitly says onholdAllowed=true. Review is read-only; Book never runs here."""
    settings, config = _config()
    if args.search_id:
        from app.services import hotel_sessions as sessions
        session = await sessions.get_search_session(settings=settings, search_id=args.search_id)
        if session is None:
            raise SystemExit("Search session not found or expired.")
    else:
        session = await _session_via_search(args, settings)
    if not session.provider_search_id:
        raise SystemExit("Session has no listing correlationId.")
    hid = pick_hotel(session, args.hotel_id)
    if not hid:
        raise SystemExit("No hotel id from this search session.")
    status, detail, _ = await _raw_post(config, build_uat_pricing_payload(
        listing_correlation_id=session.provider_search_id, hid=hid, check_in=session.check_in,
        check_out=session.check_out, rooms=_rooms_from_session(session), currency=session.currency,
    ), HOTEL_PRICING_PATH)
    print("DETAIL HTTP status:", status)
    require_hold = bool(getattr(args, "require_hold", False))
    candidates = _detail_candidates(detail, getattr(args, "option_id", "")) if status < 400 else []
    limit = max(1, int(getattr(args, "max_hold_candidates", 5) or 5)) if require_hold else 1
    candidates = candidates[:limit]
    if not candidates or not isinstance(detail, dict) or not detail.get("reviewHash"):
        raise SystemExit("Detail gave no priced option / reviewHash.")
    for i, option in enumerate(candidates, 1):
        status, review, _ = await _raw_post(config, build_uat_review_payload(
            listing_correlation_id=session.provider_search_id, hid=hid,
            option_id=str(option["optionId"]), review_hash=str(detail["reviewHash"]),
        ), HOTEL_REVIEW_PATH)
        rs = review_summary(review, hid, option)
        print("REVIEW HTTP status:", status, "success:", rs.get("status_success"),
              "total_matches_detail:", rs.get("review_total_matches_detail"))
        ok = status < 400 and rs.get("status_success") is not False and isinstance(review, dict)
        if not require_hold:
            if not ok:
                raise SystemExit("Review failed; Book must not be attempted.")
            return config, session, option, review
        if not ok:
            print(f"CANDIDATE {i}/{len(candidates)}: review failed; skipping.")
            continue
        safe = hold_candidate_summary(review, option)
        print(f"CANDIDATE {i}/{len(candidates)}:", json.dumps(safe, default=str))
        if safe["hold_allowed"] is True:
            print("HOLD-ELIGIBLE OPTION FOUND:", json.dumps(safe, default=str))
            return config, session, option, review
        print("HOLD NOT AVAILABLE FOR SELECTED OPTION"
              + ("" if safe["hold_allowed"] is False else " (onholdAllowed absent)"))
    print("NO HOLD-ELIGIBLE OPTION: no reviewed option returned onholdAllowed=true.")
    raise SystemExit("Refusing: --require-hold set and no reviewed option supports Hold. Book NOT called.")


async def run_book(args) -> None:
    check_confirm_hold_args(args)
    config, session, _option, review = await _fresh_review(args)
    reqs = book_requirements(review)
    print("BOOK REQUIREMENTS (from Review):", json.dumps(reqs, indent=1))
    execute = bool(getattr(args, "execute_uat_hold", False))
    if not reqs["booking_id_present"]:
        raise SystemExit("Review returned no bookingId; Book cannot be built.")
    if reqs["pan_required"] and execute and not args.pan:
        raise SystemExit("Review says PAN is required: pass --pan (UAT test PANs, comma-separated per traveller).")
    if reqs["passport_required"] and execute and not args.passport:
        raise SystemExit("Review says passport is required: pass --passport.")
    if reqs["gst_info_needed"] and execute:
        raise SystemExit("Review needs gstInfo (GST passthrough/reseller); not supported by this diagnostic.")
    pan_values = [v.strip() for v in args.pan.split(",") if v.strip()] if args.pan else []
    rooms = _rooms_from_session(session)
    total_travellers = sum(
        int(r.get("adults") or 0) + len(r.get("childAges") or r.get("childAge") or [])
        for r in rooms
    )
    if reqs["pan_required"] and pan_values and len(pan_values) not in (1, total_travellers):
        raise SystemExit(
            f"--pan takes either 1 value (applied to every traveller) or exactly "
            f"{total_travellers} comma-separated values (one per traveller, search order); got {len(pan_values)}."
        )
    per_traveller_pans = pan_values if len(pan_values) > 1 else None
    payload = build_uat_book_payload(
        booking_id=str(review["bookingId"]), rooms=rooms,
        email=args.contact_email or "uat@example.invalid", phone=args.contact_phone or "9000000000",
        pan=pan_values[0] if (reqs["pan_required"] and len(pan_values) == 1) else "",
        passport=args.passport if reqs["passport_required"] else "",
        pans=per_traveller_pans if reqs["pan_required"] else None,
    )
    print("BOOK REQUEST (HOLD, keys/types only):", json.dumps(shape(payload), indent=1))
    print("paymentInfos included:", "paymentInfos" in payload)
    failures = validate_book_payload(payload, _rooms_from_session(session),
                                     pan_required=reqs["pan_required"], passport_required=reqs["passport_required"])
    print("PRE-FLIGHT VALIDATION:", "OK" if not failures else "FAILED")
    for f in failures:
        print("  -", f)
    if not execute:
        print("DRY RUN: Book NOT called. No booking created. Re-run with --execute-uat-hold "
              f"--confirm {BOOK_CONFIRM_PHRASE} --contact-email ... --contact-phone ... to place a UAT HOLD.")
        return
    if args.confirm != BOOK_CONFIRM_PHRASE:
        raise SystemExit(f"Refusing: --confirm {BOOK_CONFIRM_PHRASE} is required to create a UAT hold booking.")
    if not (args.contact_email and args.contact_phone):
        raise SystemExit("Refusing: --contact-email and --contact-phone are required for a real UAT hold.")
    if review_hold_allowed(review) is not True:
        raise SystemExit("HOLD NOT AVAILABLE FOR SELECTED OPTION: Review did not explicitly return "
                         "onholdAllowed=true; refusing (would need instant/payment). Book NOT called.")
    if failures:
        raise SystemExit(f"Refusing: {len(failures)} pre-flight validation failure(s); Book NOT called.")
    print("WARNING: creating a REAL TripJack UAT HOLD booking (no payment).")
    status, body, elapsed = await _booker_post(config, HOTEL_BOOK_PATH, payload)
    print("BOOK HTTP status:", status, "elapsed_s:", elapsed)
    print("BOOK SUMMARY:", json.dumps(book_summary(body), indent=1))
    if not book_created(status, body):
        print("BOOK FAILED: no booking was created. Not polling booking-details, not cancelling.")
        raise SystemExit("Book rejected by TripJack; stopped.")
    booking_id = body["bookingId"]
    last: dict[str, Any] = {}
    for attempt in range(max(1, args.poll_attempts)):
        await asyncio.sleep(5.0)
        st, det, _ = await _booker_post(config, HOTEL_BOOKING_DETAILS_PATH, {"bookingId": booking_id})
        last = booking_details_summary(det)
        print(f"BOOKING DETAILS poll {attempt + 1}: HTTP {st} order_status={last.get('order_status')}")
        if last.get("order_status") in BOOKING_TERMINAL:
            break
    print("BOOKING DETAILS SUMMARY:", json.dumps(last, indent=1))
    if getattr(args, "confirm_hold", False):
        if last.get("order_status") != "ON_HOLD":
            print("CONFIRM-HOLD SKIPPED: booking did not reach ON_HOLD.")
            return
        amount = confirm_amount(last, review)
        if amount is None:
            print("CONFIRM-HOLD SKIPPED: no positive total from Booking Details or Review.")
            return
        print("WARNING: confirming the REAL TripJack UAT hold (debits the UAT wallet).")
        await run_confirm_hold(config, booking_id, amount)
        print("NOTE: UAT only; no production booking record was saved.")
        return
    if getattr(args, "cancel_after", False):
        st, cb, _ = await _booker_post(config, f"{HOTEL_CANCEL_BOOKING_PATH}/{booking_id}", None)
        print("CANCEL HTTP status:", st, "summary:", json.dumps(book_summary(cb)))
        await asyncio.sleep(5.0)
        st, det, _ = await _booker_post(config, HOTEL_BOOKING_DETAILS_PATH, {"bookingId": booking_id})
        print("POST-CANCEL order_status:", booking_details_summary(det).get("order_status"))
    print("NOTE: no payment was made; no production booking record was saved.")


# ------------------------------------------------------ UAT confirm-hold (opt-in) --
# POST /oms/v3/hotel/confirm-book {"bookingId", "paymentInfos": [{"amount"}]}, then
# poll booking-details every 5s up to 180s. SUCCESS == CONFIRMED.
HOTEL_CONFIRM_BOOK_PATH = "oms/v3/hotel/confirm-book"
CONFIRM_TERMINAL_OK = {"SUCCESS"}
CONFIRM_TERMINAL_FAIL = {"FAILED", "ABORTED", "CANCELLED"}


def check_confirm_hold_args(args) -> None:
    """Refuse --confirm-hold unless every UAT gate is present. Runs BEFORE Book."""
    if not getattr(args, "confirm_hold", False):
        return
    if get_settings().is_production:
        raise SystemExit("Refusing: APP_ENV is production. --confirm-hold is UAT only.")
    if not getattr(args, "execute_uat_hold", False) or args.confirm != BOOK_CONFIRM_PHRASE:
        raise SystemExit(f"Refusing: --confirm-hold requires --execute-uat-hold --confirm {BOOK_CONFIRM_PHRASE}.")
    if getattr(args, "cancel_after", False):
        raise SystemExit("Refusing: --confirm-hold and --cancel-after cannot be combined.")
    _booker_base()  # refuses non-apitest hosts


def confirm_amount(details: dict[str, Any], review_body: Any) -> float | None:
    """Booking Details order amount first, else the Review totalPrice."""
    amt = details.get("order_amount") or details.get("option_total_price")
    if isinstance(amt, (int, float)) and amt > 0:
        return round(float(amt), 2)
    opt = review_body.get("option") if isinstance(review_body, dict) and isinstance(review_body.get("option"), dict) else {}
    pricing = opt.get("pricing") if isinstance(opt.get("pricing"), dict) else {}
    total = _num(pricing.get("totalPrice"))
    return round(total, 2) if total and total > 0 else None


async def run_confirm_hold(config, booking_id: str, amount: float, *, post=None, sleep=None,
                           interval: float = 5.0, max_seconds: float = 180.0) -> str:
    """Confirm an ON_HOLD UAT booking and poll. Returns CONFIRMED | FAILED | REJECTED | TIMEOUT."""
    post = post or _booker_post
    sleep = sleep or asyncio.sleep
    payload = {"bookingId": booking_id, "paymentInfos": [{"amount": round(float(amount), 2)}]}
    print("CONFIRM-HOLD REQUEST (keys/types only):", json.dumps(shape(payload)))
    st, body, _ = await post(config, HOTEL_CONFIRM_BOOK_PATH, payload)
    print("CONFIRM-HOLD HTTP status:", st, "summary:", json.dumps(book_summary(body)))
    ok = 200 <= st < 300 and isinstance(body, dict) and isinstance(body.get("status"), dict) \
        and body["status"].get("success") is True and not body.get("errors") and not body.get("error")
    if not ok:
        print("CONFIRM-HOLD REJECTED: hold left as-is; not polling.")
        return "REJECTED"
    attempts = max(1, int(max_seconds // interval))
    for attempt in range(attempts):
        await sleep(interval)
        st, det, _ = await post(config, HOTEL_BOOKING_DETAILS_PATH, {"bookingId": booking_id})
        status = booking_details_summary(det).get("order_status")
        print(f"CONFIRM-HOLD poll {attempt + 1}: HTTP {st} order_status={status}")
        if status in CONFIRM_TERMINAL_OK:
            print("CONFIRM-HOLD RESULT: CONFIRMED")
            return "CONFIRMED"
        if status in CONFIRM_TERMINAL_FAIL:
            print("CONFIRM-HOLD RESULT: FAILED")
            return "FAILED"
    print(f"CONFIRM-HOLD RESULT: TIMEOUT after {int(attempts * interval)}s (status unknown, not treated as success)")
    return "TIMEOUT"


def main() -> None:
    p = argparse.ArgumentParser(prog="hotel_listing_uat")
    p.add_argument("mode", choices=["select", "listing", "probe-limit", "endpoint", "detail", "review", "book"])
    p.add_argument("--destination", default="Goa")
    p.add_argument("--hids", default="")
    p.add_argument("--count", type=int, default=5)
    p.add_argument("--sizes", default="5,25,50,100")
    p.add_argument("--days-ahead", type=int, default=30)
    p.add_argument("--nights", type=int, default=1)
    p.add_argument("--adults", type=int, default=2)
    p.add_argument("--follow-page", action="store_true")
    p.add_argument("--save-ids", default="", help="probe-limit: write requested ids of largest successful probe here")
    p.add_argument("--hids-file", default="", help="listing: read comma-separated ids from this file")
    p.add_argument("--hotel-id", default="", help="detail: hotel id from the search session (default: first priced)")
    p.add_argument("--search-id", default="", help="detail: reuse an existing saved search session token")
    p.add_argument("--option-id", default="", help="review: optionId from detail (default: cheapest)")
    p.add_argument("--review-variant", choices=["documented", "with-context"], default="documented",
                   help="review: documented 4-field body, or add dates/rooms/currency/nationality")
    p.add_argument("--execute-uat-hold", action="store_true", help="book: actually send a UAT HOLD booking")
    p.add_argument("--require-hold", action="store_true",
                   help="book: review options until one explicitly returns onholdAllowed=true; else stop")
    p.add_argument("--max-hold-candidates", type=int, default=5,
                   help="book --require-hold: max options of the hotel to review (cheapest first)")
    p.add_argument("--confirm", default="", help=f"book: must be {BOOK_CONFIRM_PHRASE} with --execute-uat-hold")
    p.add_argument("--contact-email", default="", help="book: operator email for TripJack delivery (never printed)")
    p.add_argument("--contact-phone", default="", help="book: operator phone (never printed)")
    p.add_argument("--pan", default="", help="book: UAT test PAN(s), only if Review requires it; one value applies to all travellers, or comma-separated one per traveller in search order (never printed)")
    p.add_argument("--passport", default="", help="book: passport, only if Review requires it (never printed)")
    p.add_argument("--poll-attempts", type=int, default=36, help="book: booking-details polls, 5s apart (36 = 180s)")
    p.add_argument("--cancel-after", action="store_true", help="book: cancel the UAT hold after polling")
    p.add_argument("--confirm-hold", action="store_true",
                   help="book: UAT only; after ON_HOLD, call confirm-book and poll 5s/180s")
    args = p.parse_args()
    runner = {"select": run_select, "listing": run_listing, "probe-limit": run_probe, "endpoint": run_endpoint, "detail": run_detail, "review": run_review, "book": run_book}[args.mode]
    asyncio.run(runner(args))


if __name__ == "__main__":
    main()
