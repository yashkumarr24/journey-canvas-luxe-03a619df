"""Safe, sequential TripJack Hotel V3 Listing UAT diagnostics (operator CLI).

Run on the VPS (whitelisted IP), from `backend/`:

    python -m app.diagnostics.hotel_listing_uat select  --destination Goa
    python -m app.diagnostics.hotel_listing_uat listing --destination Goa --count 5 [--follow-page]
    python -m app.diagnostics.hotel_listing_uat probe-limit --destination Goa --sizes 5,25,50,100,200
    python -m app.diagnostics.hotel_listing_uat endpoint --destination Goa

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
    build_listing_continuation_payload,
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


async def _raw_post(config, payload: dict) -> tuple[int, Any, float]:
    """Same client/host/headers/timeouts as production, but returns the status
    and decoded body even on errors so the structure can be inspected."""
    client = get_hotel_client(config)
    http = await client._ensure_client()  # noqa: SLF001 - diagnostic reuse of the pool
    headers = {API_KEY_HEADER: config.api_key, "Content-Type": "application/json"}
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    resp = await http.post("/" + HOTEL_LISTING_PATH, json=payload, headers=headers)
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


async def run_listing(args) -> None:
    _, config = _config()
    ids = args.hids.split(",") if args.hids else (await select_ids(args.destination, args.count))[0]
    if not ids:
        raise SystemExit("No hotel ids to test.")
    ci, co = dates(args.days_ahead, args.nights)
    payload = build_listing_payload(hids=ids, check_in=ci, check_out=co,
                                    rooms=[{"adults": args.adults, "childAges": []}], nationality="IN", currency="INR")
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


async def run_probe(args) -> None:
    _, config = _config()
    sizes = sorted(int(s) for s in args.sizes.split(","))
    ids, _ = await select_ids(args.destination, max(sizes))
    ci, co = dates(args.days_ahead, args.nights)
    for n in sizes:
        if n > len(ids):
            print(f"size {n}: only {len(ids)} ids available; stopping.")
            break
        payload = build_listing_payload(hids=ids[:n], check_in=ci, check_out=co,
                                        rooms=[{"adults": args.adults, "childAges": []}], nationality="IN", currency="INR")
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
        await asyncio.sleep(PROBE_PAUSE_SECONDS)


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


def main() -> None:
    p = argparse.ArgumentParser(prog="hotel_listing_uat")
    p.add_argument("mode", choices=["select", "listing", "probe-limit", "endpoint"])
    p.add_argument("--destination", default="Goa")
    p.add_argument("--hids", default="")
    p.add_argument("--count", type=int, default=5)
    p.add_argument("--sizes", default="5,25,50,100")
    p.add_argument("--days-ahead", type=int, default=30)
    p.add_argument("--nights", type=int, default=1)
    p.add_argument("--adults", type=int, default=2)
    p.add_argument("--follow-page", action="store_true")
    args = p.parse_args()
    runner = {"select": run_select, "listing": run_listing, "probe-limit": run_probe, "endpoint": run_endpoint}[args.mode]
    asyncio.run(runner(args))


if __name__ == "__main__":
    main()
