"""Holiday package DOCX importer — standalone VPS CLI (international only).

Reads .docx files straight from a local folder. DRY-RUN by default: nothing
is written to the database or storage. Import mode needs
--mode import --confirm IMPORT-PACKAGES. Max 20 files per run in this phase.

    python -m app.diagnostics.package_import --source /path/to/international \
        --report-dir ./import-reports/run1
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
from pathlib import Path
from typing import Any

from app.package_import.coverage import account
from app.package_import.docx_reader import read_docx
from app.package_import.duplicates import find_candidates, norm
from app.package_import.extractor import extract

MAX_FILES_THIS_PHASE = 20
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
            doc = read_docx(f)
            pkg = extract(doc, ptype)
            summary = account(pkg, doc)
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
            "extraction_summary": summary,
            "unclassified": pkg.unclassified,
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
        s = f.get("extraction_summary")
        if s:
            print(f"    coverage {s['coverage_pct']}% of {s['source_lines']} lines; review items {s['needs_review_items']}; "
                  f"review_text {s['review_text_items']}; unclassified {s['unclassified_items']}")
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
            pkg = extract(doc, ptype)
            account(pkg, doc)  # unclassified content marks the source needs_review
            result = await write_package(db, pkg, dest, images=doc.images, settings=settings)
        except Exception as exc:  # noqa: BLE001
            result = {"status": "failed", "error": type(exc).__name__}
        report["written"].append({"file": f.name, **result})
    iu = report["image_upload"] = {"uploaded": 0, "failed": 0, "skipped": 0, "not_attempted_dry_run": 0}
    for w in report["written"]:
        for img in w.get("images", []):
            key = img["status"] if img["status"] in ("uploaded", "failed") else "skipped"
            iu[key] += 1


def write_report_dir(r: dict[str, Any], out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "report.json").write_text(json.dumps(r, indent=2, ensure_ascii=False))
    written = {w["file"]: w for w in r.get("written", [])}

    def csv_out(name: str, header: list[str], rows: list[list[Any]]) -> None:
        with (out / name).open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(header)
            w.writerows(rows)

    csv_out("packages.csv",
            ["file", "checksum", "status", "name", "package_code", "nights", "days", "price_from",
             "options", "itinerary_days", "inclusions", "exclusions", "flights", "notes",
             "departures", "images", "fields_extracted", "import_result", "package_id"],
            [[f["file"], f["checksum"], f["status"], f["name"], f["package_code"], *f["duration"],
              f["indicative_price_from"], *f["counts"].values(), ";".join(f["fields_extracted"]),
              written.get(f["file"], {}).get("status", "not_imported (dry-run)" if r["mode"] == "dry-run" else ""),
              written.get(f["file"], {}).get("package_id")] for f in r["files"]])
    csv_out("review_text.csv", ["file", "field", "text", "source_context"],
            [[f["file"], t["field"], t["text"], t.get("context", "")] for f in r["files"]
             for t in [*f["extracted"].get("review_text", []), *f.get("unclassified", [])]])
    csv_out("extraction_summary.csv",
            ["file", "status", "coverage_pct", "source_lines", "classified_lines", "needs_review_items",
             "review_text_items", "unclassified_items", *(f"structured_{k}" for k in (
                 "name", "package_code", "duration_days", "indicative_price_from", "overview", "highlights",
                 "options", "hotels", "itinerary", "inclusions", "exclusions", "flights", "notes",
                 "departures", "images")), "tables", "data_tables_parsed", "textbox_paragraphs",
             "header_footer_note_lines", "linked_images"],
            [[f["file"], f["status"], s["coverage_pct"], s["source_lines"], s["classified_lines"],
              s["needs_review_items"], s["review_text_items"], s["unclassified_items"],
              *(s["structured"][k] for k in ("name", "package_code", "duration_days", "indicative_price_from",
                                             "overview", "highlights", "options", "hotels", "itinerary",
                                             "inclusions", "exclusions", "flights", "notes", "departures", "images")),
              s["layout_parts"]["tables"], s["layout_parts"]["data_tables_parsed"],
              s["layout_parts"]["textbox_paragraphs"], s["layout_parts"]["header_footer_note_lines"],
              s["layout_parts"]["linked_images"]]
             for f in r["files"] for s in [f["extraction_summary"]]])
    csv_out("needs_review.csv", ["file", "field", "reason"],
            [[n["file"], n["field"], n["reason"]] for n in r["needs_review"]])
    img_rows = []
    for f in r["image_status"]:
        uploads = {i["name"]: i for i in written.get(f["file"], {}).get("images", [])}
        for i in f["images"]:
            u = uploads.get(i["name"], {})
            img_rows.append([f["file"], i["name"], i["bytes"], i["status"],
                             u.get("status", "not_attempted (dry-run)" if r["mode"] == "dry-run" else ""),
                             u.get("path", ""), u.get("error", "")])
    csv_out("images.csv", ["file", "image", "bytes", "extraction", "upload", "storage_path", "error"], img_rows)
    csv_out("errors.csv", ["file", "error"], [[e["file"], e["error"]] for e in r["errors"]])
    csv_out("duplicate_candidates.csv", ["file_a", "file_b", "match_reasons"],
            [[d["a"], d["b"], ";".join(d["match_reasons"])] for d in r["duplicate_candidates"]])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", "--dir", dest="source", required=True, type=Path,
                    help="local folder of international package .docx files (read from disk)")
    ap.add_argument("--mode", choices=["dry-run", "import"], default="dry-run")
    ap.add_argument("--report-dir", type=Path,
                    help="write report.json, packages.csv, needs_review.csv, images.csv here")
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
    if a.mode == "import":
        a.execute = True
    if not a.source.is_dir():
        print(f"--source is not a directory: {a.source}", file=sys.stderr)
        return 2
    files = sorted(p for p in a.source.rglob("*.docx") if not p.name.startswith("~$"))[: a.limit]
    if not files:
        print("No .docx files found.", file=sys.stderr)
        return 2
    if a.execute and a.confirm != CONFIRM_PHRASE:
        print(f"--mode import requires --confirm {CONFIRM_PHRASE}", file=sys.stderr)
        return 2

    report = build_report(files, a.type)
    if a.execute:
        asyncio.run(_execute(report, files, a.type, a.destination_slug))
    print_summary(report)
    if a.report_dir:
        write_report_dir(report, a.report_dir)
        print(f"Reports written to {a.report_dir}")
    if a.report:
        a.report.write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(f"Report written to {a.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
