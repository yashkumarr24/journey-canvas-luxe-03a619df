"""Coverage pass: account for every piece of source text in a DOCX.

After extraction, each paragraph line, table row/cell line, text-box line and
header/footer/footnote line is checked against what was stored. Anything not
represented in a structured field, a note, or review_text is reported as
*unclassified* with its source location — never silently dropped. Existing
review_text entries get the same location context. Nothing is rewritten:
text is reported verbatim.
"""

from __future__ import annotations

import re
from typing import Any

from app.package_import.docx_reader import DocxContent, Paragraph, Table
from app.package_import.extractor import ExtractedPackage, ReviewItem, _section_of

_TOKEN = re.compile(r"[a-z0-9]+")
_BULLET = re.compile(r"^[\s•●○▪■◦·\-–—*>✓✔➢➤►\d.)]*\s*")
SHORT_LINE_TOKENS = 12
STRUCTURED_FIELDS = ("name", "package_code", "duration_days", "indicative_price_from", "overview",
                     "highlights", "options", "itinerary", "inclusions", "exclusions", "flights",
                     "notes", "departures", "images")


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", _BULLET.sub("", text.strip())).strip().lower()


def _strings(value: Any, out: list[str]) -> None:
    if isinstance(value, dict):
        for v in value.values():
            _strings(v, out)
    elif isinstance(value, (list, tuple, set)):
        for v in value:
            _strings(v, out)
    elif isinstance(value, (str, int, float)) and not isinstance(value, bool):
        out.append(str(value))


def _corpus(pkg: ExtractedPackage) -> tuple[str, set[str]]:
    d = pkg.to_dict()
    for k in ("checksum", "images", "needs_review", "optional_missing", "package_type", "source_filename"):
        d.pop(k, None)
    parts: list[str] = list(getattr(pkg, "_consumed", set()))
    _strings(d, parts)
    norm = [_norm(p) for p in parts if p]
    joined = "\n".join(norm)
    tokens = set(_TOKEN.findall(joined))
    return joined, tokens


def _covered(line: str, joined: str, tokens: set[str]) -> bool:
    n = _norm(line)
    if not n or not _TOKEN.search(n):
        return True  # punctuation / bullet-only line: no content
    if n in joined:
        return True
    toks = _TOKEN.findall(n)
    # Short lines may be split across fields (e.g. "Dubai: Hotel X" -> city + hotel).
    return len(toks) <= SHORT_LINE_TOKENS and all(t in tokens for t in toks)


def _is_heading(line: str) -> bool:
    return len(line.split()) <= 6 and _section_of(line.rstrip(":-– "), strong_only=True) is not None


def _source_units(doc: DocxContent):
    """Yield (text, context) for every source line, in document order."""
    section, prev = "start of document", ""
    for bi, block in enumerate(doc.blocks, start=1):
        if isinstance(block, Paragraph):
            for line in block.text.split("\n"):
                line = line.strip()
                if not line:
                    continue
                where = "text box" if block.origin == "textbox" else "paragraph"
                yield line, f"{where} {bi}; section: {section}" + (f"; after: {prev[:60]}" if prev else ""), None
                if _is_heading(line):
                    section = line[:60]
                prev = line
        else:
            assert isinstance(block, Table)
            header = " | ".join(c.strip() for c in (block.rows[0] if block.rows else []) if c.strip())[:120]
            for ri, row in enumerate(block.rows, start=1):
                yield row, f"table at block {bi}, row {ri}; section: {section}; header: {header}", block
    for part, block in doc.other_parts:
        rows = [[block.text]] if isinstance(block, Paragraph) else block.rows
        for row in rows:
            for cell in row:
                for line in cell.split("\n"):
                    if line.strip():
                        yield line.strip(), f"{part} (outside the main body)", "other"


def account(pkg: ExtractedPackage, doc: DocxContent) -> dict[str, Any]:
    """Fill pkg.unclassified, add context to review_text, return the summary."""
    joined, tokens = _corpus(pkg)
    data_tables = getattr(pkg, "_data_tables", set())
    unclassified: list[dict[str, str]] = []
    seen_other: set[str] = set()
    contexts: list[tuple[str, str]] = []
    total = classified = 0
    header_zone: dict[int, bool] = {}

    for unit, ctx, owner in _source_units(doc):
        if owner == "other":
            total += 1
            if unit in seen_other:
                classified += 1
                continue
            seen_other.add(unit)
            unclassified.append({"field": "unclassified", "text": unit, "context": ctx})
            continue
        if isinstance(owner, Table):
            cells = [c for c in unit if c.strip()]
            if not cells:
                continue
            contexts.append((_norm(" | ".join(cells)), ctx))
            if id(owner) in data_tables:
                # A data table was parsed: a row counts if any of its cells was stored.
                # Rows before the first stored row are the table's column headers.
                total += 1
                hit = any(_covered(c, joined, tokens) for c in cells)
                started = header_zone.get(id(owner), False)
                if hit:
                    header_zone[id(owner)] = True
                if hit or not started:
                    classified += 1
                else:
                    unclassified.append({"field": "unclassified", "text": " | ".join(cells), "context": ctx})
                continue
            for ci, cell in enumerate(cells, start=1):
                for line in cell.split("\n"):
                    if not line.strip():
                        continue
                    total += 1
                    if _covered(line, joined, tokens) or _is_heading(line):
                        classified += 1
                    else:
                        unclassified.append({"field": "unclassified", "text": line.strip(),
                                             "context": f"{ctx}; column {ci}"})
            continue
        contexts.append((_norm(unit), ctx))
        total += 1
        if _covered(unit, joined, tokens) or _is_heading(unit):
            classified += 1
        else:
            unclassified.append({"field": "unclassified", "text": unit, "context": ctx})

    # Location context for items the extractor already put in review_text.
    for item in pkg.review_text:
        if item.get("context"):
            continue
        first = _norm(item["text"].split("\n", 1)[0].split("  [context:", 1)[0])
        item["context"] = next((c for t, c in contexts if first and (first in t or t in first and t)), "")

    pkg.unclassified = unclassified  # type: ignore[attr-defined]
    if unclassified:
        pkg.needs_review.append(ReviewItem(
            "unclassified", f"{len(unclassified)} source line(s) not placed in any field; kept verbatim in review_text.csv"))
    if doc.linked_images:
        pkg.needs_review.append(ReviewItem(
            "images", f"{len(doc.linked_images)} image(s) linked from outside the file, not embedded; not extracted"))

    structured: dict[str, int] = {}
    for f in STRUCTURED_FIELDS:
        v = getattr(pkg, f)
        structured[f] = len(v) if isinstance(v, list) else int(v not in (None, ""))
    structured["hotels"] = sum(len(o["hotels"]) for o in pkg.options)
    return {
        "structured": structured,
        "needs_review_items": len(pkg.needs_review),
        "review_text_items": len(pkg.review_text),
        "unclassified_items": len(unclassified),
        "source_lines": total,
        "classified_lines": classified,
        "coverage_pct": round(100 * classified / total, 1) if total else 100.0,
        "layout_parts": {"textbox_paragraphs": sum(1 for b in doc.blocks if isinstance(b, Paragraph) and b.origin == "textbox"),
                         "tables": sum(1 for b in doc.blocks if isinstance(b, Table)),
                         "data_tables_parsed": len(data_tables),
                         "header_footer_note_lines": len(seen_other),
                         "embedded_images": len(doc.images), "linked_images": len(doc.linked_images)},
    }
