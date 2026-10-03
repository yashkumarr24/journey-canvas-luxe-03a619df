"""Holiday package DOCX importer CLI.

DRY-RUN by default: reads files, extracts, writes a report. Nothing is sent to
the database. Writing requires BOTH --execute and --confirm IMPORT-PACKAGES.
A hard cap of 5 files applies in this phase (the full 207 run is not allowed
yet).

    python -m app.diagnostics.package_import --dir ./docs --type international
    python -m app.diagnostics.package_import --dir ./docs --type domestic \
        --report /tmp/import_report.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from app.package_import.docx_reader import read_docx
from app.package_import.duplicates import find_candidates, norm
from app.package_import.extractor import extract

MAX_FILES_THIS_PHASE = 5
UPLOAD_EXT = {"png", "jpg", "jpeg", "gif", "webp", "bmp"}
CONFIRM_PHRASE = "IMPORT-PACKAGES"


ALLOWED_TYPE_THIS_PHASE = "international"


def infer_type(path: Path) -> str | None:
    """This phase is INTERNATIONAL only; a file under a 'domestic' path is refused."""
    if "domestic" in str(path).lower():
        return None
    return ALLOWED_TYPE_THIS_PHASE


def build_report(files: list[Path], forced_type: str | None) -> dict[str, Any]:
    report: dict[str, Any] = {"mode": "dry-run", "files_processed": 0, "packages_created": 0,
                              "options_created": 0, "hotels_found": 0, "images_extracted": 0,
                              "itinerary_days": 0, "errors": [], "needs_review": [], "files": [],
                              "duplicate_candidates": [], "image_status": [],
                              "image_upload": {"uploaded": 0, "failed": 0, "skipped": 0, "not_attempted_dry_run": 0}}
    pool = []
    for f in files:
        report["files_processed"] += 1
        ptype = infer_type(f)
        try:
            if ptype is None:
                raise ValueError("domestic file refused: this test phase is international only")
            pkg = extract(read_docx(f), ptype)
        except Exception as exc:  # noqa: BLE001 — report per file, keep going
            report["errors"].append({"file": f.name, "error": f"{type(exc).__name__}: {exc}"})
            continue
        report["packages_created"] += 1
        report["options_created"] += len(pkg.options)
        report["hotels_found"] += sum(len(o["hotels"]) for o in pkg.options)
        report["images_extracted"] += len(pkg.images)
        report["image_status"].append({"file": f.name, "images": [
            {"name": i["name"], "bytes": i["bytes"],
             "status": "extracted" + ("" if i["name"].rsplit(".", 1)[-1].lower() in UPLOAD_EXT
                                      else " (unsupported format, will be skipped)")}
            for i in pkg.images]})
        report["itinerary_days"] += len(pkg.itinerary)
        for item in pkg.needs_review:
            report["needs_review"].append({"file": f.name, "field": item.field, "reason": item.reason})
        report["files"].append({
            "file": f.name, "checksum": pkg.checksum, "package_type": ptype, "name": pkg.name,
            "package_code": pkg.package_code, "duration": [pkg.duration_nights, pkg.duration_days],
            "indicative_price_from": pkg.indicative_price_from,
            "fields_extracted": pkg.fields_extracted(),
            "counts": {"options": len(pkg.options), "itinerary_days": len(pkg.itinerary),
                       "inclusions": len(pkg.inclusions), "exclusions": len(pkg.exclusions),
                       "flights": len(pkg.flights), "notes": len(pkg.notes),
                       "departures": len(pkg.departures), "images": len(pkg.images)},
            "status": "needs_review" if pkg.needs_review else "parsed",
            "extracted": pkg.to_dict(),
        })
        pool.append({"key": f.name, "name": pkg.name, "package_code": pkg.package_code,
                     "destination_key": norm(pkg.name).split(" ")[0] if pkg.name else None})
    report["image_upload"]["not_attempted_dry_run"] = report["images_extracted"]
    report["duplicate_candidates"] = [
        {"a": a, "b": b, "match_reasons": [r for r in reasons if r != "destination"]}
        for a, b, reasons in find_candidates(pool)
    ]
    return report


def print_summary(r: dict[str, Any]) -> None:
    print(f"Mode: {r['mode']}")
    for k in ("files_processed", "packages_created", "options_created", "hotels_found",
              "images_extracted", "itinerary_days"):
        print(f"  {k.replace('_', ' ')}: {r[k]}")
    iu = r["image_upload"]
    print(f"  images: uploaded {iu['uploaded']}, failed {iu['failed']}, skipped {iu['skipped']}, "
          f"not attempted (dry-run) {iu['not_attempted_dry_run']}")
    print(f"  errors: {len(r['errors'])}")
    print(f"  needs_review items: {len(r['needs_review'])}")
    print(f"  duplicate candidates (in batch): {len(r['duplicate_candidates'])}")
    for f in r["files"]:
        print(f"- {f['file']} [{f['status']}] fields: {', '.join(f['fields_extracted']) or 'none'}")
    for e in r["errors"]:
        print(f"! {e['file']}: {e['error']}")


async def _execute(report: dict[str, Any], files: list[Path], forced_type: str | None, dest: str | None) -> None:
    from app.core.config import get_settings
    from app.package_import.writer import write_package
    from app.repositories.supabase_rest import SupabaseRest

    settings = get_settings()
    db = SupabaseRest(settings)
    if not db.enabled:
        raise SystemExit("Database credentials not configured on this server; nothing written.")
    report["mode"] = "execute"
    report["written"] = []
    for f in files:
        ptype = infer_type(f)
        if ptype is None:
            continue
        try:
            doc = read_docx(f)
            result = await write_package(db, extract(doc, ptype), dest, images=doc.images, settings=settings)
        except Exception as exc:  # noqa: BLE001
            result = {"status": "failed", "error": type(exc).__name__}
        report["written"].append({"file": f.name, **result})
    iu = report["image_upload"] = {"uploaded": 0, "failed": 0, "skipped": 0, "not_attempted_dry_run": 0}
    for w in report["written"]:
        for img in w.get("images", []):
            key = img["status"] if img["status"] in ("uploaded", "failed") else "skipped"
            iu[key] += 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dir", required=True, type=Path)
    ap.add_argument("--type", choices=["international"], default="international",
                    help="international only in this phase")
    ap.add_argument("--limit", type=int, default=MAX_FILES_THIS_PHASE)
    ap.add_argument("--report", type=Path)
    ap.add_argument("--destination-slug")
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--confirm")
    a = ap.parse_args(argv)

    if a.limit < 1 or a.limit > MAX_FILES_THIS_PHASE:
        print(f"--limit must be 1..{MAX_FILES_THIS_PHASE} in this phase.", file=sys.stderr)
        return 2
    files = sorted(p for p in a.dir.rglob("*.docx") if not p.name.startswith("~$"))[: a.limit]
    if not files:
        print("No .docx files found.", file=sys.stderr)
        return 2
    if a.execute and a.confirm != CONFIRM_PHRASE:
        print(f"--execute requires --confirm {CONFIRM_PHRASE}", file=sys.stderr)
        return 2

    report = build_report(files, a.type)
    if a.execute:
        asyncio.run(_execute(report, files, a.type, a.destination_slug))
    print_summary(report)
    if a.report:
        a.report.write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(f"Report written to {a.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
