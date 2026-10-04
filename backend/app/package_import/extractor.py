"""Turn DOCX blocks into a package record WITHOUT rewriting source wording.

Every value is copied from the document. When a field cannot be identified
with confidence it is left empty and a needs_review item is recorded rather
than guessed.
"""

from __future__ import annotations

import re
from datetime import date
from dataclasses import asdict, dataclass, field
from typing import Any

from app.package_import.docx_reader import DocxContent, Paragraph, Table

# (section, strong prefix pattern, weaker "contains" pattern). Exclusion is
# checked before inclusion because "not included" contains "included".
SECTION_PATTERNS: list[tuple[str, re.Pattern[str], re.Pattern[str] | None]] = [
    ("exclusion", re.compile(r"^(package\s+|tour\s+|cost\s+|price\s+)?(exclusions?|excludes?|what'?s\s+not\s+included|cost\s+excludes?|not\s+included|does\s+not\s+include)\b", re.I),
     re.compile(r"\b(exclusions?|excludes?|not\s+included|does\s+not\s+include|not\s+covered)\b", re.I)),
    ("inclusion", re.compile(r"^(package\s+|tour\s+|cost\s+|price\s+)?(inclusions?|includes?|what'?s\s+included|cost\s+includes?)\b", re.I),
     re.compile(r"\b(inclusions?|includes?|included|covered)\b", re.I)),
    ("itinerary", re.compile(r"^(detailed\s+|tour\s+|day\s+wise\s+|brief\s+)?(itinerary|day[\s-]*wise|day\s+by\s+day|tour\s+plan|programme|program|schedule)\b", re.I),
     re.compile(r"\b(itinerary|itenary|iternary|day[\s-]*wise|day\s+by\s+day|tour\s+plan|programme)\b", re.I)),
    ("pricing", re.compile(r"^(package\s+|tour\s+)?(price|prices|pricing|cost|costing|tariff|rates?)\b", re.I),
     re.compile(r"\b(package\s+cost|tour\s+cost|package\s+price|tour\s+price|cost\s+per\s+person|price\s+per\s+person|pricing|tariff)\b", re.I)),
    ("hotels", re.compile(r"^(hotels?|accommodation|hotel\s+details|proposed\s+hotels?|stay)\b", re.I),
     re.compile(r"\b(hotels?|accommodation|properties)\b", re.I)),
    ("flights", re.compile(r"^(flights?|flight\s+details|air\s*fare|airline)\b", re.I),
     re.compile(r"\b(flight\s+details|flight\s+schedule|flights?)\b", re.I)),
    ("highlights", re.compile(r"^(highlights?|tour\s+highlights?|package\s+highlights?)\b", re.I),
     re.compile(r"\bhighlights?\b", re.I)),
    ("departures", re.compile(r"^(departure\s+dates?|fixed\s+departures?|dates?\s+of\s+travel|travel\s+dates?|departures|batch(es)?)\b", re.I),
     re.compile(r"\b(departure\s+dates?|fixed\s+departures?|travel\s+dates?|dates?\s+of\s+(travel|departure))\b", re.I)),
    ("visa", re.compile(r"^visa\b", re.I), re.compile(r"\bvisa\b", re.I)),
    ("gst", re.compile(r"^(gst|taxes)\b", re.I), None),
    ("tcs", re.compile(r"^tcs\b", re.I), None),
    ("payment", re.compile(r"^(payment(\s+terms|\s+policy|\s+schedule)?|booking\s+terms|booking\s+policy)\b", re.I),
     re.compile(r"\bpayment\s+(terms|policy|schedule)\b", re.I)),
    ("cancellation", re.compile(r"^cancell?ation(\s+policy|\s+terms|\s+charges)?\b", re.I),
     re.compile(r"\bcancell?ation\b", re.I)),
    ("other", re.compile(r"^(notes?|important\s+notes?|terms(\s*&\s*|\s+and\s+)conditions|remarks?|important\s+information|please\s+note)\b", re.I),
     re.compile(r"\b(terms\s*(&|and)\s*conditions|important\s+notes?|please\s+note)\b", re.I)),
]
NOTE_KINDS = {"visa", "gst", "tcs", "payment", "cancellation", "other"}
LIST_SECTIONS = {"inclusion", "exclusion", "highlights"} | NOTE_KINDS

WORD_NUM = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen".split())}
_SEP = r"[\s:.\-–—|)>]*"
DAY_RE = re.compile(
    r"^\s*(?:day|d(?=\s*\d))\s*[-:#.]?\s*0?(\d{1,2})"
    r"(?:\s*(?:&|-|–|—|to|and|/|,)\s*(?:day\s*)?0?(\d{1,2}))?(?!\d)" + _SEP + r"(.*)$", re.I)
DAY_ORD_RE = re.compile(r"^\s*(\d{1,2})(?:st|nd|rd|th)\s+day\b" + _SEP + r"(.*)$", re.I)
DAY_WORD_RE = re.compile(r"^\s*day\s+(" + "|".join(WORD_NUM) + r")\b" + _SEP + r"(.*)$", re.I)
DURATION_RE = re.compile(r"(\d{1,2})\s*N(?:ights?)?\s*[/&,\-\s]*\s*(\d{1,2})\s*D(?:ays?)?\b", re.I)
CODE_RE = re.compile(r"\b(?:package|tour|pkg|trip)\s*(?:code|id|ref(?:erence)?)\s*(?:no\.?)?\s*[:\-#]?\s*([A-Z0-9][A-Z0-9/_\-]{2,30})", re.I)
_CUR = r"₹|INR|Rs\.?|USD|US\$|\$|AED|EUR|€|GBP|£|SGD|MYR|THB"
PRICE_RE = re.compile(
    rf"(?P<c1>{_CUR})\s*(?P<a1>\d[\d,]*(?:\.\d{{1,2}})?)"
    rf"|(?P<a2>\d[\d,]{{2,}}(?:\.\d{{1,2}})?)\s*(?:(?P<c2>INR|USD|AED|EUR|GBP|SGD|MYR|THB|Rs\.?)\b|(?P<dash>/-))", re.I)
CUR_CODE = {"₹": "INR", "inr": "INR", "rs": "INR", "rs.": "INR", "usd": "USD", "us$": "USD", "$": "USD",
            "aed": "AED", "eur": "EUR", "€": "EUR", "gbp": "GBP", "£": "GBP", "sgd": "SGD", "myr": "MYR", "thb": "THB"}
OPTION_RE = re.compile(r"(\b[1-7]\s*(?:\*|★|☆|star\b|stars\b)|★|\b(deluxe|standard|premium|luxury|budget|superior|economy|"
                       r"super\s+deluxe|option\s*\w*|category\s*\w*|cat\s*\d|platinum|gold|silver)\b)", re.I)
PRICE_WORDS = re.compile(r"\b(price|cost|rate|tariff|per\s+person|pp|twin|double|triple|single|child|adult|sharing|inr|usd|aed)\b|₹|\$", re.I)
MEAL_WORDS = {"breakfast": "breakfast", "lunch": "lunch", "dinner": "dinner"}
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
_MON = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
_ORD = r"(?:st|nd|rd|th)?"
DATE_NUM_RE = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b")
DATE_DMY_RE = re.compile(rf"\b(\d{{1,2}}){_ORD}((?:\s*(?:,|&|and)\s*\d{{1,2}}{_ORD})*)[\s\-]*{_MON}(?:[\s,'’\-]*(\d{{4}}|\d{{2}}\b))?", re.I)
DATE_MDY_RE = re.compile(rf"\b{_MON}\s*(\d{{1,2}}){_ORD}\b((?:\s*(?:,|&|and)\s*\d{{1,2}}{_ORD}\b)*)(?:,?\s*(\d{{4}}))?", re.I)
DATE_MY_LIST_RE = re.compile(rf"\b{_MON}[\s,'’\-]*(\d{{4}}|\d{{2}})\s*[:\-–]\s*(\d{{1,2}}{_ORD}(?:\s*(?:,|&|and)\s*\d{{1,2}}{_ORD})*)\b", re.I)
RANGE_GAP_RE = re.compile(r"^\s*(?:-|–|—|to|till|until)\s*$", re.I)
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
    currency: str = "INR"
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
    # Absent optional facts (e.g. no package code) — informational, not review.
    optional_missing: list[str] = field(default_factory=list)
    needs_review: list[ReviewItem] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def fields_extracted(self) -> list[str]:
        names = ["name", "package_code", "duration_nights", "duration_days",
                 "indicative_price_from", "overview", "highlights", "options",
                 "itinerary", "inclusions", "exclusions", "flights", "notes",
                 "departures", "images"]
        return [n for n in names if getattr(self, n) not in (None, "", [])]


# ---------------------------------------------------------------- helpers --

def _clean_head(text: str) -> str:
    return re.sub(r"[\s:\-–—|.*#•]+$", "", re.sub(r"^[\s•\-–*·●▪➢✓✔#\d.)]*", "", text)).strip()


def _section_of(text: str, strong_only: bool = False) -> str | None:
    head = _clean_head(text)
    if not head or len(head) > 70 or len(head.split()) > 8:
        return None
    for name, strong, _ in SECTION_PATTERNS:
        if strong.match(head):
            return name
    if strong_only or len(head.split()) > 6:
        return None
    for name, _, weak in SECTION_PATTERNS:
        if weak is not None and weak.search(head):
            return name
    return None


def _price_cur(text: str) -> tuple[float, str | None] | None:
    m = PRICE_RE.search(text)
    if not m:
        return None
    amount = m.group("a1") or m.group("a2")
    cur = m.group("c1") or m.group("c2")
    code = CUR_CODE.get(cur.lower()) if cur else ("INR" if m.group("dash") else None)
    try:
        return float(amount.replace(",", "")), code
    except ValueError:
        return None


def _price(text: str) -> float | None:
    r = _price_cur(text)
    return r[0] if r else None


def _bare_amount(text: str) -> float | None:
    """A cell that is only a number (e.g. '55,000'); only used inside price tables."""
    t = text.strip().rstrip("/-").strip()
    if re.fullmatch(r"\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d{4,7}(?:\.\d{1,2})?", t):
        return float(t.replace(",", ""))
    return None


def _norm_opt(name: str) -> str:
    n = name.lower().replace("★", " star ").replace("*", " star ")
    n = re.sub(r"\bstars\b", "star", n)
    n = re.sub(r"\b(hotels?|option|category|package)\b", "", n)
    return re.sub(r"[^a-z0-9]", "", n)


def _mk_date(y: int, m: int, d: int) -> str | None:
    if y < 100:
        y += 2000
    try:
        return date(y, m, d).isoformat() if 2000 <= y <= 2100 else None
    except ValueError:
        return None


def _dates_in(text: str) -> list[str]:
    """Every explicit calendar date in a line. Dates without a year in the
    line are not completed by guessing; ranges keep only their start date."""
    found: list[tuple[int, int, str]] = []

    def mon(tok: str) -> int | None:
        return MONTHS.get(tok[:3].lower())

    def add(span: tuple[int, int], iso: str | None) -> None:
        if iso and not any(s <= span[0] < e for s, e, _ in found):
            found.append((span[0], span[1], iso))

    for m in DATE_MY_LIST_RE.finditer(text):
        mo, y = mon(m.group(1)), int(m.group(2))
        for d in re.findall(r"\d{1,2}", m.group(3)):
            add((m.start() + len(found) * 0, m.end()), None)  # placeholder keeps span
            found.pop()
            iso = _mk_date(y, mo, int(d)) if mo else None
            if iso:
                found.append((m.start(), m.end(), iso))
    for m in DATE_NUM_RE.finditer(text):
        add(m.span(), _mk_date(int(m.group(3)), int(m.group(2)), int(m.group(1))))
    for rx, dmy in ((DATE_DMY_RE, True), (DATE_MDY_RE, False)):
        for m in rx.finditer(text):
            if any(s <= m.start() < e for s, e, _ in found):
                continue
            if dmy:
                first, more, mtok, ytok = m.group(1), m.group(2), m.group(3), m.group(4)
            else:
                mtok, first, more, ytok = m.group(1), m.group(2), m.group(3), m.group(4)
            mo = mon(mtok)
            if not mo or not ytok:
                continue
            for d in [first] + re.findall(r"\d{1,2}", more or ""):
                iso = _mk_date(int(ytok), mo, int(d))
                if iso:
                    found.append((m.start(), m.end(), iso))
    found.sort()
    out: list[str] = []
    prev_end = None
    for s, e, iso in found:
        # "15 Oct 2026 - 20 Oct 2026" is one departure (start), not two.
        if prev_end is not None and s > prev_end and RANGE_GAP_RE.match(text[prev_end:s]):
            prev_end = e
            continue
        if iso not in out:
            out.append(iso)
        prev_end = e
    # "15-20 Oct 2026": a day range collapsed into one DMY match keeps its start.
    return out


def _parse_date(text: str) -> str | None:
    d = _dates_in(text)
    return d[0] if d else None


def _split_lines(text: str) -> list[str]:
    return [re.sub(r"^[\s•\-–*·●▪➢✓✔]+", "", ln).strip() for ln in text.split("\n") if ln.strip()]


def _day_match(line: str) -> tuple[int, int, str] | None:
    """(start_day, end_day, rest-of-line) for a day-wise line, else None."""
    if m := DAY_RE.match(line):
        a = int(m.group(1))
        b = int(m.group(2)) if m.group(2) and int(m.group(2)) > a else a
        return (a, b, m.group(3).strip()) if 0 < a <= 60 else None
    if m := DAY_ORD_RE.match(line):
        return int(m.group(1)), int(m.group(1)), m.group(2).strip()
    if m := DAY_WORD_RE.match(line):
        n = WORD_NUM[m.group(1).lower()]
        return (n, n, m.group(2).strip()) if n else None
    return None


def _find_option(pkg: ExtractedPackage, name: str) -> dict[str, Any] | None:
    key = _norm_opt(name)
    return next((o for o in pkg.options if key and _norm_opt(o["option_name"]) == key), None)


def _new_option(pkg: ExtractedPackage, name: str) -> dict[str, Any]:
    opt = {"option_name": name, "hotels": [], "indicative_price": None, "price_text": None,
           "price_basis": None, "currency": None}
    pkg.options.append(opt)
    return opt


def _set_price(opt: dict[str, Any], text: str, basis: str | None = None, allow_bare: bool = False) -> bool:
    pc = _price_cur(text)
    if pc is None and allow_bare and (b := _bare_amount(text)) is not None:
        pc = (b, None)
    if pc is None:
        return False
    line = text.strip()
    opt["price_text"] = line if not opt.get("price_text") else (
        opt["price_text"] if line in opt["price_text"] else opt["price_text"] + "\n" + line)
    if opt.get("indicative_price") is None:
        opt["indicative_price"], opt["currency"] = pc[0], pc[1] or opt.get("currency")
        if basis and not opt.get("price_basis"):
            opt["price_basis"] = basis
    return True


def _hotel_dict(hotel: str, city: str | None = None, room: str | None = None, nights: str = "",
                meal: str | None = None, star_txt: str = "") -> dict[str, Any]:
    nm = re.search(r"(\d+)\s*(?:n\b|nts?\b|nights?\b)?", nights, re.I) if nights else None
    star_m = re.search(r"([1-7])\s*(?:\*|★|-?\s*star)", f"{star_txt} {hotel}", re.I)
    return {"city": city or None, "hotel_name": hotel, "star_rating": int(star_m.group(1)) if star_m else None,
            "room_type": room or None, "nights": int(nm.group(1)) if nm else None, "meal_plan": meal or None,
            "is_similar": bool(re.search(r"\bor\s+similar\b|\bsimilar\b", hotel, re.I))}


# ----------------------------------------------------------------- tables --

def _row_cell(row: list[str], i: int | None) -> str:
    return row[i].strip() if i is not None and i < len(row) else ""


def _hotel_table(tbl: Table, pkg: ExtractedPackage) -> bool:
    """Rows of hotels with a 'hotel/accommodation' header (header may be the
    2nd/3rd row under a merged title row). Grouped by an option column."""
    hdr_idx = next((i for i, r in enumerate(tbl.rows[:3])
                    if any(re.search(r"\bhotels?\b|accommodation|property|properties", c, re.I) for c in r)
                    and len(r) >= 2), None)
    if hdr_idx is None or len(tbl.rows) <= hdr_idx + 1:
        return False
    header = [c.lower() for c in tbl.rows[hdr_idx]]
    if sum(1 for h in header[1:] if OPTION_RE.search(h)) >= 2:
        return False  # option-per-column layout: handled by _option_column_table

    def col(*keys: str) -> int | None:
        return next((i for i, h in enumerate(header) if any(k in h for k in keys)), None)

    c_hotel = col("hotel", "accommodation", "property")
    c_city = col("city", "destination", "place", "location")
    c_option = col("option", "category", "package type", "class")
    c_room = col("room")
    c_nights = col("night", "nts", "no. of n", "duration")
    c_meal = col("meal", "plan", "basis")
    c_star = col("star", "rating")
    c_price = col("price", "cost", "rate", "inr", "₹", "tariff", "usd")
    if c_hotel == c_city:
        c_city = None

    by_option: dict[str, dict[str, Any]] = {}
    for row in tbl.rows[hdr_idx + 1:]:
        cell = lambda i: _row_cell(row, i)  # noqa: E731
        hotel = cell(c_hotel)
        if not hotel or hotel.lower() == header[c_hotel]:
            continue
        opt_name = cell(c_option) or "Option 1"
        if opt_name not in by_option:
            by_option[opt_name] = _find_option(pkg, opt_name) or _new_option(pkg, opt_name)
        opt = by_option[opt_name]
        opt["hotels"].append(_hotel_dict(hotel, cell(c_city), cell(c_room), cell(c_nights), cell(c_meal), cell(c_star)))
        if c_price is not None and cell(c_price):
            _set_price(opt, cell(c_price), allow_bare=True)
    return bool(by_option)


def _option_column_table(tbl: Table, pkg: ExtractedPackage) -> bool:
    """Header like 'City | 3★ | 4★ | 5★': each option column lists hotels per
    city row; rows whose label/cells are prices give that option's price."""
    for hdr_idx, header in enumerate(tbl.rows[:3]):
        opt_cols = [i for i, h in enumerate(header) if i > 0 and h.strip() and OPTION_RE.search(h)
                    and len(h.split()) <= 6 and not _price_cur(h)]
        if len(opt_cols) >= 2:
            break
    else:
        return False
    header = tbl.rows[hdr_idx]
    opts = {i: (_find_option(pkg, header[i].strip()) or _new_option(pkg, header[i].strip())) for i in opt_cols}
    used = False
    for row in tbl.rows[hdr_idx + 1:]:
        label = _row_cell(row, 0)
        priced_row = bool(PRICE_WORDS.search(label)) or any(_price_cur(_row_cell(row, i)) for i in opt_cols)
        for i in opt_cols:
            val = _row_cell(row, i)
            if not val:
                continue
            if priced_row:
                used |= _set_price(opts[i], val if not label else f"{label}: {val}", basis=label or None,
                                   allow_bare=True) or _set_price(opts[i], val, basis=label or None, allow_bare=True)
            else:
                nights = re.search(r"\(?\s*(\d+)\s*(?:n|nts?|nights?)\b\s*\)?", label, re.I)
                opts[i]["hotels"].append(_hotel_dict(val, label or None, nights=nights.group(0) if nights else ""))
                used = True
    return used


def _price_table(tbl: Table, pkg: ExtractedPackage) -> bool:
    """Option names with prices but no hotels. Layout A: header row = option
    names, later rows = prices per column. Layout B: one option per row."""
    if len(tbl.rows) < 2:
        return False
    text = " ".join(" ".join(r) for r in tbl.rows)
    if not PRICE_WORDS.search(text) and not PRICE_RE.search(text):
        return False
    found = False
    header = tbl.rows[0]
    for ci, name in enumerate(header[1:], start=1):
        name = name.strip()
        if not name or _price_cur(name):
            continue
        for row in tbl.rows[1:]:
            val = _row_cell(row, ci)
            if val and (_price_cur(val) or _bare_amount(val) is not None):
                opt = _find_option(pkg, name) or _new_option(pkg, name)
                found |= _set_price(opt, val, basis=_row_cell(row, 0) or None, allow_bare=True)
    if found:
        return True
    for row in tbl.rows:
        label = _row_cell(row, 0)
        if not label or not OPTION_RE.search(label):
            continue
        for val in row[1:]:
            if val.strip() and (_price_cur(val) or _bare_amount(val) is not None):
                opt = _find_option(pkg, label) or _new_option(pkg, label)
                found |= _set_price(opt, val, allow_bare=True)
    return found


def _flight_table(tbl: Table, pkg: ExtractedPackage) -> bool:
    if len(tbl.rows) < 2:
        return False
    header = [c.lower() for c in tbl.rows[0]]
    if not any(k in " ".join(header) for k in ("flight", "airline", "sector", "carrier")):
        return False
    def idx(*keys: str) -> int | None:
        return next((i for i, h in enumerate(header) if any(k in h for k in keys)), None)
    cols = {"sector": idx("sector", "route", "from"), "airline": idx("airline", "carrier"),
            "flight_no": idx("flight no", "flight"), "depart_time": idx("dep", "etd"), "arrive_time": idx("arr", "eta")}
    for row in tbl.rows[1:]:
        rec = {k: (row[i].strip() or None) if i is not None and i < len(row) else None for k, i in cols.items()}
        if any(rec.values()):
            pkg.flights.append(rec)
    return True


def _itinerary_table(tbl: Table, pkg: ExtractedPackage, ends: dict[int, int]) -> bool:
    """Rows that start with a day marker ('Day 1', 'Day 01 - 02', '1st Day'),
    or a 'Day' column holding numbers."""
    header = [c.lower() for c in tbl.rows[0]]
    day_col_numeric = bool(header) and re.fullmatch(r"\s*day[s]?\s*(no\.?)?\s*", header[0] or "") is not None
    rows = []
    for row in tbl.rows[1:] if day_col_numeric else tbl.rows:
        first = _row_cell(row, 0)
        if day_col_numeric and re.fullmatch(r"0?\d{1,2}", first):
            dm = (int(first), int(first), "")
        else:
            dm = _day_match(first.split("\n", 1)[0])
        if dm:
            rows.append((dm, row, first))
    if not rows or (len(rows) < 2 and not pkg.itinerary and len(tbl.rows) > 2):
        return False
    for (a, b, rest), row, first in rows:
        extra_first = first.split("\n", 1)[1].strip() if "\n" in first else ""
        others = [c.strip() for c in row[1:] if c.strip()]
        title = rest or (others.pop(0).split("\n", 1)[0] if others else "") or f"Day {a}"
        if others and others[0].startswith(title):
            others[0] = others[0][len(title):].strip()
        desc = "\n".join(x for x in [extra_first, *others] if x) or None
        day = {"day_number": a, "title": title, "description": desc, "meals": []}
        pkg.itinerary.append(day)
        ends[id(day)] = b
    return True


def _departure_table(tbl: Table, pkg: ExtractedPackage, section: str | None) -> bool:
    header = " ".join(tbl.rows[0]).lower()
    if section != "departures" and not re.search(r"\b(departure|dates?|batch)\b", header):
        return False
    if re.search(r"\b(hotel|flight|airline|sector)\b", header):
        return False
    hits = 0
    rows = tbl.rows[1:] if not _dates_in(" ".join(tbl.rows[0])) else tbl.rows
    for row in rows:
        line = " | ".join(c for c in row if c.strip())
        ds = _dates_in(line)
        if ds:
            hits += 1
            pkg.departures.extend(d for d in ds if d not in pkg.departures)
        elif line:
            pkg.unparsed_departures.append(line)
    return hits > 0


# ---------------------------------------------------------------- extract --

def _units(doc: DocxContent, pkg: ExtractedPackage, state: dict[str, Any]):
    """Yield (line, heading_like, from_table) in document order. Data tables
    are consumed here; any other table is read cell by cell as text so its
    content still reaches the section logic instead of being dropped."""
    for block in doc.blocks:
        if isinstance(block, Table):
            state["all_text"].extend(" | ".join(r) for r in block.rows)
            if (_itinerary_table(block, pkg, state["ends"]) or _option_column_table(block, pkg)
                    or _hotel_table(block, pkg) or _flight_table(block, pkg)
                    or _departure_table(block, pkg, state["section"]) or _price_table(block, pkg)):
                continue
            state["layout_tables"] += 1
            for row in block.rows:
                cells = [c for c in row if c.strip()]
                for ci, cell in enumerate(cells):
                    lines = cell.split("\n")
                    for li, ln in enumerate(lines):
                        heading = ci == 0 and li == 0 and len(cells) > 1 and _section_of(ln) is not None
                        yield ln, heading, True
            continue
        assert isinstance(block, Paragraph)
        state["all_text"].append(block.text)
        for li, ln in enumerate(block.text.split("\n")):
            yield ln, (block.is_heading_like if li == 0 else False), False, *( (block,) if li == 0 else (None,))


def extract(doc: DocxContent, package_type: str) -> ExtractedPackage:
    pkg = ExtractedPackage(source_filename=doc.filename, checksum=doc.checksum, package_type=package_type)
    state: dict[str, Any] = {"section": None, "all_text": [], "ends": {}, "layout_tables": 0}
    current_day: dict[str, Any] | None = None
    current_opt: dict[str, Any] | None = None
    explicit_days = False
    inferred_days = 0
    unnamed_option = False
    preamble: list[str] = []

    for unit in _units(doc, pkg, state):
        raw, heading_like, from_table = unit[0], unit[1], unit[2]
        block = unit[3] if len(unit) > 3 else None
        line = raw.strip()
        if not line:
            continue
        section = state["section"]
        dm = _day_match(line)

        if pkg.name is None and block is not None and not from_table and \
                (block.style.lower().startswith(("title", "heading")) or block.bold) \
                and not dm and _section_of(line, strong_only=True) is None and len(line) <= 120:
            pkg.name = line
            continue

        head_part, _, after = line.partition(":") if ":" in line else (line, "", "")
        colon_head = ":" in line and len(head_part.split()) <= 6
        ends_colon = bool(re.search(r"[:\-–]\s*$", line))
        in_list = section in LIST_SECTIONS
        looks_heading = heading_like or ends_colon or colon_head or (len(line.split()) <= 4 and not in_list)
        sec = None
        if looks_heading and not dm:
            cand = head_part if colon_head else line
            strong_only = in_list and not (heading_like or ends_colon)
            if section == "itinerary" and not (heading_like or ends_colon):
                strong_only = True
            sec = _section_of(cand, strong_only=strong_only)
        if sec:
            state["section"], current_day = sec, None
            if sec in ("hotels", "pricing"):
                current_opt = None
            rest = after.strip() if colon_head else ""
            if not rest:
                continue
            line, section, dm = rest, sec, _day_match(rest)

        if dm and section not in ("inclusion", "exclusion", "departures", "pricing") and section not in NOTE_KINDS:
            state["section"] = section = "itinerary"
            explicit_days = True
            a, b, rest = dm
            current_day = {"day_number": a, "title": rest or f"Day {a}", "description": None, "meals": []}
            pkg.itinerary.append(current_day)
            state["ends"][id(current_day)] = b
            continue

        if section == "itinerary":
            if (heading_like and not explicit_days and len(line) <= 90 and not line.endswith(".")) or current_day is None:
                if heading_like and not explicit_days and len(line) <= 90:
                    inferred_days += 1
                    current_day = {"day_number": len(pkg.itinerary) + 1, "title": line, "description": None, "meals": []}
                    pkg.itinerary.append(current_day)
                    state["ends"][id(current_day)] = current_day["day_number"]
                    continue
                if current_day is None:
                    preamble.append(line)  # itinerary intro text before the first day
                    continue
            current_day["description"] = (current_day["description"] + "\n" + line) if current_day["description"] else line
            continue
        if section in ("inclusion", "exclusion"):
            (pkg.inclusions if section == "inclusion" else pkg.exclusions).extend(_split_lines(line))
            continue
        if section == "highlights":
            pkg.highlights.extend(_split_lines(line))
            continue
        if section in NOTE_KINDS:
            pkg.notes.append({"kind": section, "text": line})
            continue
        if section == "flights":
            pkg.flights.append({"sector": None, "airline": None, "flight_no": None,
                                "depart_time": None, "arrive_time": None, "notes": line})
            continue
        if section == "departures":
            for ln in _split_lines(line):
                ds = _dates_in(ln)
                if ds:
                    pkg.departures.extend(d for d in ds if d not in pkg.departures)
                else:
                    pkg.unparsed_departures.append(ln)
            continue
        if section in ("hotels", "pricing"):
            pc = _price_cur(line)
            label = _clean_head(PRICE_RE.split(line, maxsplit=1)[0]) if pc else ""
            if pc:
                target = (_find_option(pkg, label) if label else None)
                if target is None and label and OPTION_RE.search(label) and len(label.split()) <= 6:
                    target = _new_option(pkg, label)
                if target is None and section == "hotels" and current_opt is not None:
                    target = current_opt
                if target is not None:
                    _set_price(target, line, basis=None)
                    continue
                pkg.notes.append({"kind": "other", "text": line})  # price not tied to an option: kept verbatim
                state.setdefault("loose_prices", []).append(line)
                continue
            if OPTION_RE.search(line) and len(line.split()) <= 6 and (heading_like or ends_colon or section == "hotels"):
                name = _clean_head(line)
                current_opt = _find_option(pkg, name) or _new_option(pkg, name)
                continue
            if section == "hotels":
                if current_opt is None:
                    current_opt = _new_option(pkg, "Option 1")
                    unnamed_option = True
                city, hotel = (head_part.strip(), after.strip()) if colon_head and after.strip() else (None, line)
                current_opt["hotels"].append(_hotel_dict(hotel, city))
                continue
            pkg.notes.append({"kind": "other", "text": line})
            continue
        preamble.append(line)

    # ---- document-wide facts (copied, never inferred beyond the pattern) ----
    joined = "\n".join(state["all_text"])
    if (m := DURATION_RE.search((pkg.name or "") + "\n" + doc.filename + "\n" + joined)):
        pkg.duration_nights, pkg.duration_days = int(m.group(1)), int(m.group(2))
    if (m := CODE_RE.search(joined)):
        pkg.package_code = m.group(1)
    if preamble:
        pkg.overview = "\n".join(p for p in preamble if p != pkg.name) or None
    for day in pkg.itinerary:
        desc = (day["title"] + " " + (day["description"] or "")).lower()
        day["meals"] = [v for k, v in MEAL_WORDS.items() if re.search(rf"\b{k}\b", desc)]
    priced = [o for o in pkg.options if o.get("indicative_price")]
    if priced:
        curs = [o.get("currency") or "INR" for o in priced]
        pkg.currency = max(set(curs), key=curs.count)
        pkg.indicative_price_from = min(o["indicative_price"] for o in priced if (o.get("currency") or "INR") == pkg.currency)
    elif (pc := _price_cur(joined)) is not None:
        pkg.indicative_price_from, pkg.currency = pc[0], pc[1] or "INR"
        pkg.needs_review.append(ReviewItem("indicative_price_from", "price found in text, not tied to an option"))
    pkg.images = [{"name": i.name, "sha256": i.sha256, "bytes": len(i.data)} for i in doc.images]

    # ---- needs_review flags (only genuinely uncertain data) ---------------
    r = pkg.needs_review.append
    if not pkg.name:
        r(ReviewItem("name", "no title/heading found"))
    if pkg.duration_nights is None:
        r(ReviewItem("duration", "no 'xN/yD' duration pattern found"))
    if not pkg.itinerary:
        r(ReviewItem("itinerary", "no day-wise itinerary identified"))
    else:
        nums = [d["day_number"] for d in pkg.itinerary]
        last = max(state["ends"].get(id(d), d["day_number"]) for d in pkg.itinerary)
        if len(set(nums)) != len(nums):
            r(ReviewItem("itinerary", "duplicate day numbers"))
        if inferred_days:
            r(ReviewItem("itinerary", f"{inferred_days} day(s) numbered by order (no 'Day N' marker in source)"))
        if pkg.duration_days and last != pkg.duration_days:
            r(ReviewItem("itinerary", f"{last} days in itinerary vs {pkg.duration_days} in duration"))
    if not pkg.inclusions:
        r(ReviewItem("inclusions", "no inclusions section found"))
    if not pkg.exclusions:
        r(ReviewItem("exclusions", "no exclusions section found"))
    if not pkg.options:
        r(ReviewItem("options", "no hotel/price option found"))
    if unnamed_option:
        r(ReviewItem("options", "hotels listed without an option name; grouped as 'Option 1'"))
    for o in pkg.options:
        if not o.get("indicative_price"):
            r(ReviewItem("options", f"option '{o['option_name']}' has no price"))
    if pkg.indicative_price_from is None:
        r(ReviewItem("indicative_price_from", "no price found"))
    if pkg.unparsed_departures:
        r(ReviewItem("departures", f"{len(pkg.unparsed_departures)} departure line(s) without a full calendar date"))
    if not pkg.package_code:
        pkg.optional_missing.append("package_code")
    return pkg
