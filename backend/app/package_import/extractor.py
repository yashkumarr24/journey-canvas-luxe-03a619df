"""Turn DOCX blocks into a package record WITHOUT rewriting source wording.

Every value is copied from the document. When a field cannot be identified
with confidence it is left empty and a needs_review item is recorded rather
than guessed.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

from app.package_import.docx_reader import DocxContent, Paragraph, Table

SECTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("itinerary", re.compile(r"^(detailed\s+)?(itinerary|day[\s-]*wise|tour\s+plan)\b", re.I)),
    ("inclusion", re.compile(r"^(package\s+)?(inclusions?|includes?|what'?s\s+included|cost\s+includes?)\b", re.I)),
    ("exclusion", re.compile(r"^(package\s+)?(exclusions?|excludes?|what'?s\s+not\s+included|cost\s+excludes?|not\s+included)\b", re.I)),
    ("hotels", re.compile(r"^(hotels?|accommodation|hotel\s+details|proposed\s+hotels?)\b", re.I)),
    ("flights", re.compile(r"^(flights?|flight\s+details|air\s*fare|airline)\b", re.I)),
    ("highlights", re.compile(r"^(highlights?|tour\s+highlights?)\b", re.I)),
    ("departures", re.compile(r"^(departure\s+dates?|fixed\s+departures?|dates?\s+of\s+travel)\b", re.I)),
    ("visa", re.compile(r"^visa\b", re.I)),
    ("gst", re.compile(r"^(gst|taxes)\b", re.I)),
    ("tcs", re.compile(r"^tcs\b", re.I)),
    ("payment", re.compile(r"^(payment(\s+terms|\s+policy)?|booking\s+terms)\b", re.I)),
    ("cancellation", re.compile(r"^cancell?ation(\s+policy|\s+terms)?\b", re.I)),
    ("other", re.compile(r"^(notes?|important\s+notes?|terms(\s*&\s*|\s+and\s+)conditions|remarks?)\b", re.I)),
]
NOTE_KINDS = {"visa", "gst", "tcs", "payment", "cancellation", "other"}

DAY_RE = re.compile(r"^\s*day\s*[-:]?\s*0?(\d{1,2})\s*[:.\-–—]?\s*(.*)$", re.I)
DURATION_RE = re.compile(r"(\d{1,2})\s*N(?:ights?)?\s*[/&,\-\s]*\s*(\d{1,2})\s*D(?:ays?)?\b", re.I)
CODE_RE = re.compile(r"\b(?:package|tour|pkg)\s*code\s*[:\-]?\s*([A-Z0-9][A-Z0-9/_\-]{2,30})", re.I)
PRICE_RE = re.compile(r"(?:₹|INR|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)", re.I)
MEAL_WORDS = {"breakfast": "breakfast", "lunch": "lunch", "dinner": "dinner"}
DATE_RE = re.compile(r"\b(\d{1,2})[\-/ .](\d{1,2}|[A-Za-z]{3,9})[\-/ .,]*(\d{2,4})\b")
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
FLIGHT_NO_RE = re.compile(r"\b([A-Z0-9]{2})[\s-]?(\d{2,4})\b")


@dataclass
class ReviewItem:
    field: str
    reason: str


@dataclass
class ExtractedPackage:
    source_filename: str
    checksum: str
    package_type: str
    name: str | None = None
    package_code: str | None = None
    duration_nights: int | None = None
    duration_days: int | None = None
    indicative_price_from: float | None = None
    price_basis: str | None = None
    overview: str | None = None
    highlights: list[str] = field(default_factory=list)
    options: list[dict[str, Any]] = field(default_factory=list)
    itinerary: list[dict[str, Any]] = field(default_factory=list)
    inclusions: list[str] = field(default_factory=list)
    exclusions: list[str] = field(default_factory=list)
    flights: list[dict[str, Any]] = field(default_factory=list)
    notes: list[dict[str, str]] = field(default_factory=list)
    departures: list[str] = field(default_factory=list)
    unparsed_departures: list[str] = field(default_factory=list)
    images: list[dict[str, Any]] = field(default_factory=list)
    needs_review: list[ReviewItem] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def fields_extracted(self) -> list[str]:
        names = ["name", "package_code", "duration_nights", "duration_days",
                 "indicative_price_from", "overview", "highlights", "options",
                 "itinerary", "inclusions", "exclusions", "flights", "notes",
                 "departures", "images"]
        return [n for n in names if getattr(self, n) not in (None, "", [])]


def _section_of(text: str) -> str | None:
    head = text.strip().rstrip(":").strip()
    if len(head) > 60:
        return None
    for name, pat in SECTION_PATTERNS:
        if pat.match(head):
            return name
    return None


def _price(text: str) -> float | None:
    m = PRICE_RE.search(text)
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


def _parse_date(text: str) -> str | None:
    m = DATE_RE.search(text)
    if not m:
        return None
    d, mo, y = m.groups()
    month = int(mo) if mo.isdigit() else MONTHS.get(mo[:3].lower())
    if not month or not 1 <= month <= 12:
        return None
    year = int(y) + (2000 if len(y) == 2 else 0)
    day = int(d)
    if not 1 <= day <= 31 or not 2000 <= year <= 2100:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def _split_lines(text: str) -> list[str]:
    return [re.sub(r"^[\s•\-–*·●▪➢✓✔]+", "", ln).strip() for ln in text.split("\n") if ln.strip()]


def _hotel_table(tbl: Table, pkg: ExtractedPackage) -> bool:
    """Header row containing 'hotel' → recommended hotels, grouped by option column."""
    if len(tbl.rows) < 2:
        return False
    header = [c.lower() for c in tbl.rows[0]]
    if not any("hotel" in h for h in header):
        return False

    def col(*keys: str) -> int | None:
        for i, h in enumerate(header):
            if any(k in h for k in keys):
                return i
        return None

    c_hotel = col("hotel")
    c_city = col("city", "destination", "place", "location")
    c_option = col("option", "category", "package type", "class")
    c_room = col("room")
    c_nights = col("night", "nts")
    c_meal = col("meal", "plan")
    c_star = col("star", "rating")
    c_price = col("price", "cost", "rate", "inr", "₹")

    by_option: dict[str, dict[str, Any]] = {}
    for row in tbl.rows[1:]:
        cell = lambda i: (row[i].strip() if i is not None and i < len(row) else "")  # noqa: E731
        hotel = cell(c_hotel)
        if not hotel:
            continue
        opt_name = cell(c_option) or "Option 1"
        opt = by_option.setdefault(opt_name, {"option_name": opt_name, "hotels": [], "indicative_price": None, "price_text": None})
        nights_txt = cell(c_nights)
        nights = int(re.search(r"\d+", nights_txt).group()) if re.search(r"\d+", nights_txt) else None
        star_m = re.search(r"([1-7])\s*(?:\*|★|star)", cell(c_star) + " " + hotel, re.I)
        opt["hotels"].append({
            "city": cell(c_city) or None,
            "hotel_name": hotel,
            "star_rating": int(star_m.group(1)) if star_m else None,
            "room_type": cell(c_room) or None,
            "nights": nights,
            "meal_plan": cell(c_meal) or None,
            "is_similar": bool(re.search(r"\bor\s+similar\b", hotel, re.I)),
        })
        if c_price is not None and cell(c_price):
            opt["indicative_price"] = opt["indicative_price"] or _price(cell(c_price)) or _price("INR " + cell(c_price))
            opt["price_text"] = opt["price_text"] or cell(c_price)
    pkg.options.extend(by_option.values())
    return True


def _price_table(tbl: Table, pkg: ExtractedPackage) -> bool:
    """Table with option/category names and prices but no hotel column."""
    if len(tbl.rows) < 2:
        return False
    text = " ".join(" ".join(r) for r in tbl.rows).lower()
    if not any(k in text for k in ("price", "cost", "₹", "inr", "rs")):
        return False
    header = tbl.rows[0]
    found = False
    # Layout A: header = option names, later rows carry prices per column.
    for ci, name in enumerate(header[1:], start=1):
        for row in tbl.rows[1:]:
            if ci < len(row) and (_price(row[ci]) or re.fullmatch(r"[\d,]{4,}", row[ci].strip())):
                price = _price(row[ci]) or float(row[ci].replace(",", ""))
                basis = row[0].strip() or None
                existing = next((o for o in pkg.options if o["option_name"] == name.strip()), None)
                if existing:
                    existing["indicative_price"] = existing["indicative_price"] or price
                    existing.setdefault("price_basis", basis)
                elif name.strip():
                    pkg.options.append({"option_name": name.strip(), "hotels": [], "indicative_price": price,
                                        "price_text": row[ci].strip(), "price_basis": basis})
                found = True
                break
    return found


def _flight_table(tbl: Table, pkg: ExtractedPackage) -> bool:
    if len(tbl.rows) < 2:
        return False
    header = [c.lower() for c in tbl.rows[0]]
    if not any(k in " ".join(header) for k in ("flight", "airline", "sector")):
        return False
    def idx(*keys: str) -> int | None:
        return next((i for i, h in enumerate(header) if any(k in h for k in keys)), None)
    cols = {"sector": idx("sector", "route", "from"), "airline": idx("airline", "carrier"),
            "flight_no": idx("flight no", "flight"), "depart_time": idx("dep"), "arrive_time": idx("arr")}
    for row in tbl.rows[1:]:
        rec = {k: (row[i].strip() or None) if i is not None and i < len(row) else None for k, i in cols.items()}
        if any(rec.values()):
            pkg.flights.append(rec)
    return True


def extract(doc: DocxContent, package_type: str) -> ExtractedPackage:
    pkg = ExtractedPackage(source_filename=doc.filename, checksum=doc.checksum, package_type=package_type)
    section: str | None = None
    current_day: dict[str, Any] | None = None
    preamble: list[str] = []
    all_text: list[str] = []
    unknown_tables = 0

    for block in doc.blocks:
        if isinstance(block, Table):
            all_text.extend(" | ".join(r) for r in block.rows)
            if _hotel_table(block, pkg) or _flight_table(block, pkg):
                continue
            if _price_table(block, pkg):
                continue
            if section in ("inclusion", "exclusion"):
                for row in block.rows:
                    for c in row:
                        (pkg.inclusions if section == "inclusion" else pkg.exclusions).extend(_split_lines(c))
                continue
            unknown_tables += 1
            continue

        assert isinstance(block, Paragraph)
        text = block.text
        all_text.append(text)
        first_line = text.split("\n", 1)[0]
        looks_heading = block.is_heading_like or first_line.rstrip().endswith(":") \
            or (":" in first_line and len(first_line.split(":", 1)[0].split()) <= 3) \
            or (len(first_line.split()) <= 3 and section not in ("inclusion", "exclusion", "highlights"))
        sec = _section_of(first_line.split(":", 1)[0] if ":" in first_line else first_line) if looks_heading else None
        day_m = DAY_RE.match(first_line)

        if pkg.name is None and (block.style.lower().startswith(("title", "heading")) or block.bold) \
                and not sec and not day_m and len(first_line) <= 120:
            pkg.name = first_line
            continue

        if sec:
            section, current_day = sec, None
            rest = text.split("\n", 1)[1] if "\n" in text else re.sub(r"^[^:]*:\s*", "", first_line) if ":" in first_line else ""
            if not rest:
                continue
            text = rest
            first_line = text.split("\n", 1)[0]
            day_m = DAY_RE.match(first_line)

        if day_m and (section in (None, "itinerary", "highlights")):
            section = "itinerary"
            title = day_m.group(2).strip() or f"Day {int(day_m.group(1))}"
            body = text.split("\n", 1)[1].strip() if "\n" in text else ""
            current_day = {"day_number": int(day_m.group(1)), "title": title, "description": body or None,
                           "meals": []}
            pkg.itinerary.append(current_day)
            continue

        if section == "itinerary" and current_day is not None:
            current_day["description"] = (current_day["description"] + "\n" + text) if current_day["description"] else text
            continue
        if section in ("inclusion", "exclusion"):
            (pkg.inclusions if section == "inclusion" else pkg.exclusions).extend(_split_lines(text))
            continue
        if section == "highlights":
            pkg.highlights.extend(_split_lines(text))
            continue
        if section in NOTE_KINDS:
            pkg.notes.append({"kind": section, "text": text})
            continue
        if section == "flights":
            pkg.flights.append({"sector": None, "airline": None, "flight_no": None,
                                "depart_time": None, "arrive_time": None, "notes": text})
            continue
        if section == "departures":
            for ln in _split_lines(text):
                iso = _parse_date(ln)
                (pkg.departures.append(iso) if iso else pkg.unparsed_departures.append(ln))
            continue
        if section is None:
            preamble.append(text)

    # ---- document-wide facts (copied, never inferred beyond the pattern) ----
    joined = "\n".join(all_text)
    if (m := DURATION_RE.search((pkg.name or "") + "\n" + joined)):
        pkg.duration_nights, pkg.duration_days = int(m.group(1)), int(m.group(2))
    if (m := CODE_RE.search(joined)):
        pkg.package_code = m.group(1)
    if preamble:
        pkg.overview = "\n".join(p for p in preamble if p != pkg.name) or None
    for day in pkg.itinerary:
        desc = (day["title"] + " " + (day["description"] or "")).lower()
        day["meals"] = [v for k, v in MEAL_WORDS.items() if re.search(rf"\b{k}\b", desc)]
    priced = [o["indicative_price"] for o in pkg.options if o.get("indicative_price")]
    if priced:
        pkg.indicative_price_from = min(priced)
    elif (p := _price(joined)) is not None:
        pkg.indicative_price_from = p
        pkg.needs_review.append(ReviewItem("indicative_price_from", "price found in text, not tied to an option"))
    pkg.images = [{"name": i.name, "sha256": i.sha256, "bytes": len(i.data)} for i in doc.images]

    # ---- needs_review flags ------------------------------------------------
    r = pkg.needs_review.append
    if not pkg.name:
        r(ReviewItem("name", "no title/heading found"))
    if pkg.duration_nights is None:
        r(ReviewItem("duration", "no 'xN/yD' duration pattern found"))
    if not pkg.itinerary:
        r(ReviewItem("itinerary", "no 'Day N' lines found"))
    else:
        nums = [d["day_number"] for d in pkg.itinerary]
        if len(set(nums)) != len(nums):
            r(ReviewItem("itinerary", "duplicate day numbers"))
        if pkg.duration_days and max(nums) != pkg.duration_days:
            r(ReviewItem("itinerary", f"{max(nums)} days in itinerary vs {pkg.duration_days} in duration"))
    if not pkg.inclusions:
        r(ReviewItem("inclusions", "no inclusions section found"))
    if not pkg.exclusions:
        r(ReviewItem("exclusions", "no exclusions section found"))
    if not pkg.options:
        r(ReviewItem("options", "no hotel/price option table found"))
    for o in pkg.options:
        if not o.get("indicative_price"):
            r(ReviewItem("options", f"option '{o['option_name']}' has no price"))
    if pkg.indicative_price_from is None:
        r(ReviewItem("indicative_price_from", "no price found"))
    if pkg.unparsed_departures:
        r(ReviewItem("departures", f"{len(pkg.unparsed_departures)} departure line(s) not a clear date"))
    if unknown_tables:
        r(ReviewItem("tables", f"{unknown_tables} table(s) not recognised; content not imported"))
    if not pkg.package_code:
        r(ReviewItem("package_code", "no package code in document (optional)"))
    return pkg
