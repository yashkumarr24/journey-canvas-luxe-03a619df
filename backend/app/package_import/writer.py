"""Write an extracted package to the existing schema (service role, unpublished).

Only used with --execute. Every package is inserted unpublished, as its own
row; nothing is updated or merged. Images are counted but not uploaded yet
(package_images.url needs a hosted URL) — recorded as needs_review.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from app.package_import.duplicates import find_candidates
from typing import Awaitable, Callable

from app.package_import.docx_reader import DocImage
from app.package_import.extractor import ExtractedPackage
from app.package_import.storage import UPLOADABLE, object_path, storage_ref, upload_image
from app.repositories.supabase_rest import SupabaseRest


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80] or "package"


async def match_destination(db: SupabaseRest, pkg: ExtractedPackage, destination_slug: str | None) -> dict | None:
    if destination_slug:
        rows = await db.select("destinations", columns="id,slug,name,region",
                               filters={"slug": f"eq.{destination_slug}"})
        return rows[0] if rows else None
    rows = await db.select("destinations", columns="id,slug,name,region",
                           filters={"region": f"eq.{pkg.package_type}"}, limit=1000)
    hay = f"{pkg.name or ''} {pkg.source_filename}".lower()
    hits = [d for d in rows if re.search(rf"\b{re.escape(d['name'].lower())}\b", hay)]
    return hits[0] if len(hits) == 1 else None


async def write_package(db: SupabaseRest, pkg: ExtractedPackage, destination_slug: str | None,
                        images: list[DocImage] | None = None, settings: Any = None,
                        uploader: Callable[..., Awaitable[None]] = upload_image) -> dict[str, Any]:
    existing = await db.select("package_sources", columns="id", filters={"file_checksum": f"eq.{pkg.checksum}"})
    if existing:
        return {"status": "skipped", "reason": "same file checksum already imported"}

    dest = await match_destination(db, pkg, destination_slug)
    if dest is None:
        pkg.needs_review.append(_ri("destination", "no single existing destination matched"))
    status = "needs_review" if pkg.needs_review else "parsed"
    warnings = [{"field": i.field, "reason": i.reason} for i in pkg.needs_review]
    src = (await db.insert("package_sources", {
        "original_filename": pkg.source_filename, "file_checksum": pkg.checksum,
        "parse_status": status if dest else "needs_review", "parse_warnings": warnings,
        "parsed_at": datetime.now(timezone.utc).isoformat(),
    }))[0]
    if dest is None:
        return {"status": "needs_review", "source_id": src["id"], "package_id": None,
                "images": [{"name": i.name, "status": "skipped_no_package"} for i in (images or [])]}

    slug = slugify(f"{pkg.name or pkg.source_filename}-{pkg.checksum[:8]}")
    row = (await db.insert("packages", {
        "destination_id": dest["id"], "source_id": src["id"], "package_code": pkg.package_code,
        "name": pkg.name or pkg.source_filename, "slug": slug,
        "duration_nights": pkg.duration_nights, "duration_days": pkg.duration_days,
        "indicative_price_from": pkg.indicative_price_from, "overview": pkg.overview,
        "highlights": pkg.highlights, "is_published": False,
    }))[0]
    pid = row["id"]
    for i, o in enumerate(pkg.options):
        opt = (await db.insert("package_options", {
            "package_id": pid, "option_name": o["option_name"], "sort_order": i,
            "indicative_price": o.get("indicative_price"), "price_basis": o.get("price_basis"),
            "notes": o.get("price_text"),
        }))[0]
        if o["hotels"]:
            await db.insert("package_option_hotels", [
                {**h, "option_id": opt["id"], "sort_order": j} for j, h in enumerate(o["hotels"])
            ], returning=False)
    seen: set[int] = set()
    days = [d for d in pkg.itinerary if not (d["day_number"] in seen or seen.add(d["day_number"]))]
    if days:
        await db.insert("package_itinerary_days", [{**d, "package_id": pid} for d in days], returning=False)
    inc = [{"package_id": pid, "kind": "inclusion", "text": t, "sort_order": i} for i, t in enumerate(pkg.inclusions)]
    inc += [{"package_id": pid, "kind": "exclusion", "text": t, "sort_order": i} for i, t in enumerate(pkg.exclusions)]
    if inc:
        await db.insert("package_inclusions", inc, returning=False)
    if pkg.flights:
        await db.insert("package_flights", [{**f, "package_id": pid, "sort_order": i}
                                            for i, f in enumerate(pkg.flights)], returning=False)
    if pkg.notes:
        await db.insert("package_notes", [{**n, "package_id": pid, "sort_order": i}
                                          for i, n in enumerate(pkg.notes)], returning=False)
    if pkg.departures:
        await db.insert("package_departures", [{"package_id": pid, "departure_date": d}
                                               for d in sorted(set(pkg.departures))], returning=False)

    # duplicate candidates against existing packages (flag only)
    others = await db.select("packages", columns="id,name,package_code,destination_id", filters={"id": f"neq.{pid}"}, limit=5000)
    me = {"key": pid, "name": pkg.name, "package_code": pkg.package_code, "destination_key": dest["id"]}
    pool = [me] + [{"key": o["id"], "name": o["name"], "package_code": o["package_code"],
                    "destination_key": o["destination_id"]} for o in others]
    cands = [c for c in find_candidates(pool) if pid in c[:2]]
    if cands:
        await db.upsert("package_duplicate_candidates",
                        [{"package_a_id": a, "package_b_id": b, "match_reasons": r} for a, b, r in cands],
                        on_conflict="package_a_id,package_b_id")
    image_results = await _upload_images(db, settings, uploader, pid, pkg, images or [])
    failed = [r for r in image_results if r["status"] != "uploaded"]
    if failed:
        warnings.append({"field": "images", "reason": f"{len(failed)} image(s) not uploaded"})
        await db.update("package_sources", {"parse_status": "needs_review", "parse_warnings": warnings},
                        filters={"id": f"eq.{src['id']}"})
        status = "needs_review"
    return {"status": status, "images": image_results, "source_id": src["id"], "package_id": pid, "duplicate_candidates": len(cands)}


def _ri(field: str, reason: str):
    from app.package_import.extractor import ReviewItem
    return ReviewItem(field, reason)


async def _upload_images(db, settings, uploader, pid: str, pkg: ExtractedPackage,
                         images: list[DocImage]) -> list[dict[str, Any]]:
    """Upload each embedded image; link successes in package_images (no alt text invented)."""
    results: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, img in enumerate(images):
        if img.sha256 in seen:
            results.append({"name": img.name, "status": "skipped_duplicate_in_file"})
            continue
        seen.add(img.sha256)
        ctype = UPLOADABLE.get(img.ext)
        if ctype is None:
            results.append({"name": img.name, "status": "skipped_unsupported_format"})
            continue
        path = object_path(pkg.checksum, i, img.name)
        try:
            await uploader(settings, path, img.data, ctype)
        except Exception as exc:  # noqa: BLE001
            results.append({"name": img.name, "status": "failed", "error": str(exc)[:120]})
            continue
        rows.append({"package_id": pid, "url": storage_ref(path), "alt": None,
                     "is_cover": False, "sort_order": len(rows)})
        results.append({"name": img.name, "status": "uploaded", "path": path})
    if rows:
        await db.insert("package_images", rows, returning=False)
    return results
