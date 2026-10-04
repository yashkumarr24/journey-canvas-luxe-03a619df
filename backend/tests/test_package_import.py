"""Package DOCX importer tests (synthetic DOCX built in-test; no DB calls)."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import pytest

from app.diagnostics import package_import as cli
from app.package_import.docx_reader import read_docx
from app.package_import.duplicates import candidate_reasons
from app.package_import.extractor import extract

NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def p(text: str, style: str = "", bold: bool = False) -> str:
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    rpr = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f"<w:p>{ppr}<w:r>{rpr}<w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r></w:p>"


def tbl(rows: list[list[str]]) -> str:
    return "<w:tbl>" + "".join(
        "<w:tr>" + "".join(f"<w:tc>{p(c)}</w:tc>" for c in r) + "</w:tr>" for r in rows) + "</w:tbl>"


def make_docx(path: Path, body: str, images: int = 0) -> Path:
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("word/document.xml", f"<w:document {NS}><w:body>{body}</w:body></w:document>")
        for i in range(images):
            z.writestr(f"word/media/image{i + 1}.jpeg", b"\xff\xd8fake" + bytes([i]))
    return path


FULL = (
    p("Magical Kashmir 5N/6D", "Title")
    + p("Package Code: KSH-001")
    + p("Experience the valley of Kashmir.")
    + p("Itinerary", bold=True)
    + p("Day 1: Arrival in Srinagar")
    + p("Check in to houseboat. Dinner and overnight.")
    + p("Day 2: Gulmarg")
    + p("After breakfast drive to Gulmarg.")
    + p("Day 3 - Pahalgam") + p("Day 4: Sonmarg") + p("Day 5: Srinagar") + p("Day 6: Departure")
    + tbl([["Category", "City", "Hotel", "Nights", "Meal Plan", "Price per person"],
           ["Deluxe", "Srinagar", "Hotel Grand Mumtaz or similar", "3", "MAP", "INR 24,999"],
           ["Deluxe", "Pahalgam", "Pine Spring 3*", "2", "MAP", ""],
           ["Luxury", "Srinagar", "Vivanta Dal View 5 star", "3", "MAP", "INR 45,999"]])
    + p("Inclusions", bold=True) + p("Accommodation on twin sharing") + p("Airport transfers")
    + p("Exclusions", bold=True) + p("Airfare") + p("GST 5%")
    + p("Departure Dates", bold=True) + p("15-Mar-2026") + p("Every Sunday")
    + p("Cancellation Policy", bold=True) + p("50% charge within 15 days.")
)


@pytest.fixture()
def full_doc(tmp_path: Path) -> Path:
    return make_docx(tmp_path / "domestic" / "Kashmir.docx" if False else tmp_path / "Kashmir.docx", FULL, images=2)


def test_reads_text_tables_images_and_checksum(full_doc):
    doc = read_docx(full_doc)
    assert doc.filename == "Kashmir.docx" and len(doc.checksum) == 64
    assert len(doc.images) == 2
    assert any(getattr(b, "rows", None) for b in doc.blocks)


def test_extracts_fields_verbatim(full_doc):
    pkg = extract(read_docx(full_doc), "domestic")
    assert pkg.name == "Magical Kashmir 5N/6D"
    assert pkg.package_code == "KSH-001"
    assert (pkg.duration_nights, pkg.duration_days) == (5, 6)
    assert [d["day_number"] for d in pkg.itinerary] == [1, 2, 3, 4, 5, 6]
    assert pkg.itinerary[0]["title"] == "Arrival in Srinagar"
    assert "dinner" in pkg.itinerary[0]["meals"]
    assert pkg.inclusions == ["Accommodation on twin sharing", "Airport transfers"]
    assert pkg.exclusions == ["Airfare", "GST 5%"]
    assert pkg.departures == ["2026-03-15"]
    assert pkg.unparsed_departures == ["Every Sunday"]
    assert pkg.notes == [{"kind": "cancellation", "text": "50% charge within 15 days."}]
    assert pkg.package_type == "domestic"


def test_multiple_options_with_hotels(full_doc):
    pkg = extract(read_docx(full_doc), "domestic")
    names = [o["option_name"] for o in pkg.options]
    assert names == ["Deluxe", "Luxury"]
    deluxe = pkg.options[0]
    assert len(deluxe["hotels"]) == 2 and deluxe["indicative_price"] == 24999
    assert deluxe["hotels"][0]["is_similar"] is True
    assert deluxe["hotels"][1]["star_rating"] == 3
    assert pkg.indicative_price_from == 24999


def test_flights_only_when_present(full_doc, tmp_path):
    assert extract(read_docx(full_doc), "domestic").flights == []
    body = FULL + tbl([["Sector", "Airline", "Flight No", "Departure", "Arrival"],
                       ["DEL-SXR", "IndiGo", "6E 2131", "06:00", "07:30"]])
    pkg = extract(read_docx(make_docx(tmp_path / "f.docx", body)), "international")
    assert pkg.flights[0]["airline"] == "IndiGo" and pkg.flights[0]["flight_no"] == "6E 2131"


def test_unclear_doc_flags_needs_review(tmp_path):
    pkg = extract(read_docx(make_docx(tmp_path / "x.docx", p("some text") + p("more"))), "domestic")
    fields = {i.field for i in pkg.needs_review}
    assert {"name", "duration", "itinerary", "inclusions", "options", "indicative_price_from"} <= fields
    assert pkg.name is None  # never invented


def test_unparsed_departure_flagged(full_doc):
    pkg = extract(read_docx(full_doc), "domestic")
    assert any(i.field == "departures" for i in pkg.needs_review)


def test_duplicate_rules_flag_not_merge():
    a = {"key": "a", "name": "Magical Kashmir", "package_code": "K1", "destination_key": "d"}
    assert candidate_reasons(a, {**a, "key": "b"}) == ["package_code", "name", "destination"]
    assert candidate_reasons(a, {"key": "c", "name": "Other", "package_code": None, "destination_key": "d"}) == []


def test_cli_dry_run_report(tmp_path, capsys):
    d = tmp_path / "International"
    d.mkdir()
    make_docx(d / "a.docx", FULL, images=1)
    make_docx(d / "b.docx", FULL.replace("KSH-001", "KSH-002"))
    out = tmp_path / "r.json"
    assert cli.main(["--dir", str(d), "--report", str(out)]) == 0
    r = json.loads(out.read_text())
    assert r["mode"] == "dry-run" and r["files_processed"] == 2
    assert r["packages_created"] == 2 and r["options_created"] == 4 and r["images_extracted"] == 1
    assert r["files"][0]["package_type"] == "international"
    assert r["duplicate_candidates"][0]["match_reasons"] == ["name"]


def test_cli_caps_at_fifty_and_requires_confirm(tmp_path):
    for i in range(52):
        make_docx(tmp_path / f"{i}.docx", FULL)
    assert cli.main(["--dir", str(tmp_path), "--limit", "51"]) == 2
    assert cli.main(["--dir", str(tmp_path), "--execute"]) == 2
    out = tmp_path / "r.json"
    cli.main(["--dir", str(tmp_path), "--report", str(out)])
    assert json.loads(out.read_text())["files_processed"] == 50


def test_domestic_refused_this_phase(tmp_path):
    d = tmp_path / "Domestic"
    d.mkdir()
    make_docx(d / "a.docx", FULL)
    out = tmp_path / "r.json"
    cli.main(["--dir", str(d), "--report", str(out)])
    r = json.loads(out.read_text())
    assert r["packages_created"] == 0 and "international only" in r["errors"][0]["error"]
    with pytest.raises(SystemExit):
        cli.main(["--dir", str(d), "--type", "domestic"])


def test_dry_run_reports_images_separately(tmp_path):
    make_docx(tmp_path / "a.docx", FULL, images=2)
    out = tmp_path / "r.json"
    cli.main(["--dir", str(tmp_path), "--report", str(out)])
    r = json.loads(out.read_text())
    assert r["image_upload"] == {"uploaded": 0, "failed": 0, "skipped": 0, "not_attempted_dry_run": 2}
    assert [i["status"] for i in r["image_status"][0]["images"]] == ["extracted", "extracted"]


class FakeDB:
    def __init__(self, destinations):
        self.destinations, self.inserts, self.updates = destinations, {}, []

    async def select(self, table, *, columns="*", filters, limit=1, order=None):
        if table == "destinations":
            return self.destinations
        return []

    async def insert(self, table, rows, *, returning=True):
        rows = rows if isinstance(rows, list) else [rows]
        self.inserts.setdefault(table, []).extend(rows)
        return [{"id": f"{table}-{len(self.inserts[table])}"} for _ in rows]

    async def update(self, table, values, *, filters, returning=False):
        self.updates.append((table, values))
        return []

    async def upsert(self, *a, **k):
        return []


def _run(coro):
    import asyncio
    return asyncio.run(coro)


def test_execute_uploads_and_links_images(tmp_path):
    from app.package_import.writer import write_package
    path = make_docx(tmp_path / "Kashmir.docx", FULL, images=2)
    with zipfile.ZipFile(path, "a") as z:
        z.writestr("word/media/image9.emf", b"emf")
    doc = read_docx(path)
    db = FakeDB([{"id": "d1", "slug": "kashmir", "name": "Kashmir", "region": "international"}])
    uploaded = []

    async def up(settings, p, data, ct):
        uploaded.append((p, ct))
    res = _run(write_package(db, extract(doc, "international"), None, images=doc.images, uploader=up))
    statuses = [i["status"] for i in res["images"]]
    assert statuses.count("uploaded") == 2 and "skipped_unsupported_format" in statuses
    assert len(db.inserts["package_images"]) == 2
    assert all(r["url"].startswith("storage://package-images/") and r["alt"] is None
               for r in db.inserts["package_images"])
    assert db.inserts["packages"][0]["is_published"] is False


def test_failed_upload_flags_needs_review(tmp_path):
    from app.package_import.writer import write_package
    doc = read_docx(make_docx(tmp_path / "Kashmir.docx", FULL, images=1))
    db = FakeDB([{"id": "d1", "slug": "kashmir", "name": "Kashmir", "region": "international"}])

    async def up(*a):
        raise RuntimeError("storage upload failed (HTTP 500)")
    res = _run(write_package(db, extract(doc, "international"), None, images=doc.images, uploader=up))
    assert res["status"] == "needs_review" and res["images"][0]["status"] == "failed"
    assert "package_images" not in db.inserts
    assert db.updates and db.updates[0][1]["parse_status"] == "needs_review"


def test_no_destination_no_package(tmp_path):
    from app.package_import.writer import write_package
    doc = read_docx(make_docx(tmp_path / "Mystery.docx", FULL.replace("Kashmir", "Somewhere"), images=1))
    db = FakeDB([{"id": "d1", "slug": "kashmir", "name": "Kashmir", "region": "international"}])
    res = _run(write_package(db, extract(doc, "international"), None, images=doc.images))
    assert res["package_id"] is None and "packages" not in db.inserts
    assert res["images"][0]["status"] == "skipped_no_package"
    assert db.inserts["package_sources"][0]["parse_status"] == "needs_review"


def test_source_and_mode_flags_and_csv(tmp_path):
    src = tmp_path / "intl"
    src.mkdir()
    make_docx(src / "a.docx", FULL, images=1)
    out = tmp_path / "rep"
    assert cli.main(["--source", str(src), "--mode", "dry-run", "--report-dir", str(out)]) == 0
    for n in ("report.json", "packages.csv", "needs_review.csv", "images.csv", "errors.csv",
              "duplicate_candidates.csv"):
        assert (out / n).exists()
    import csv as _csv
    rows = list(_csv.DictReader((out / "images.csv").open()))
    assert rows[0]["upload"] == "not_attempted (dry-run)"
    pk = list(_csv.DictReader((out / "packages.csv").open()))[0]
    assert pk["file"] == "a.docx" and len(pk["checksum"]) == 64


def test_import_mode_requires_confirm(tmp_path):
    make_docx(tmp_path / "a.docx", FULL)
    assert cli.main(["--source", str(tmp_path), "--mode", "import"]) == 2
    assert cli.main(["--source", str(tmp_path / "missing")]) == 2


# ---- varied real-world layouts ---------------------------------------------

def test_layout_tables_option_columns_and_paragraph_sections(tmp_path):
    body = (
        p("Baku & Georgia 6N/7D", "Title")
        + tbl([["City", "3★ Hotels", "4★ Hotels"],
               ["Baku (3N)", "Central Park Hotel or similar", "Ramada Baku"],
               ["Tbilisi (3N)", "Hotel Ibis", "Holiday Inn Tbilisi"],
               ["Price per person on twin sharing", "INR 65,000", "₹ 78,500/-"]])
        + tbl([["Tour Itinerary"]])
        + p("Day 01: Arrive Baku") + p("Transfer to hotel. Dinner.")
        + p("Day 02 - 03 | Baku city tour") + p("Day 4: Drive to Tbilisi")
        + p("Day 5: Tbilisi") + p("Day 6: Kakheti") + p("Day 7: Departure")
        + tbl([["Package Inclusions:", "Accommodation\nDaily breakfast"],
               ["Package Exclusions:", "Airfare\nVisa"]])
    )
    pkg = extract(read_docx(make_docx(tmp_path / "BakuGeorgia.docx", body)), "international")
    assert [o["option_name"] for o in pkg.options] == ["3★ Hotels", "4★ Hotels"]
    assert pkg.options[1]["indicative_price"] == 78500 and pkg.options[0]["indicative_price"] == 65000
    assert pkg.options[0]["hotels"][0]["city"] == "Baku (3N)" and pkg.options[0]["hotels"][0]["nights"] == 3
    assert pkg.itinerary[1]["title"] == "Baku city tour"
    assert pkg.inclusions == ["Accommodation", "Daily breakfast"]
    assert pkg.exclusions == ["Airfare", "Visa"]
    fields = {i.field for i in pkg.needs_review}
    assert "itinerary" not in fields and "options" not in fields and "tables" not in fields
    assert "package_code" in pkg.optional_missing and "package_code" not in fields


def test_itinerary_table_and_departure_formats(tmp_path):
    body = (
        p("Almaty Fix Departure 4N/5D", "Title")
        + tbl([["Day", "Itinerary"], ["1", "Arrival Almaty\nMeet at airport."], ["2", "City tour"],
               ["3", "Shymbulak"], ["4", "Free day"], ["5", "Departure"]])
        + p("Fixed Departures", bold=True)
        + p("12th Oct 2026") + p("Nov 5, 2026") + p("December 2026: 3, 17")
        + p("15 Jan 2027 - 19 Jan 2027") + p("On request")
    )
    pkg = extract(read_docx(make_docx(tmp_path / "Almaty.docx", body)), "international")
    assert [d["day_number"] for d in pkg.itinerary] == [1, 2, 3, 4, 5]
    assert pkg.itinerary[0]["title"] == "Arrival Almaty" and pkg.itinerary[0]["description"] == "Meet at airport."
    assert pkg.departures == ["2026-10-12", "2026-11-05", "2026-12-03", "2026-12-17", "2027-01-15"]
    assert pkg.unparsed_departures == [] and {"kind": "other", "text": "On request"} in pkg.notes
    assert not any(i.field == "itinerary" for i in pkg.needs_review)


def test_heading_days_without_markers_are_flagged_not_hidden(tmp_path):
    body = (p("Dubai Delight 2N/3D", "Title") + p("Day Wise Itinerary", bold=True)
            + p("Arrival in Dubai", bold=True) + p("Dhow cruise dinner.")
            + p("Desert Safari", bold=True) + p("Afternoon safari.")
            + p("Departure", bold=True) + p("Transfer to airport.")
            + p("What's Included", bold=True) + p("Hotel stay")
            + p("Not Included", bold=True) + p("Visa"))
    pkg = extract(read_docx(make_docx(tmp_path / "Dubai.docx", body)), "international")
    assert [d["title"] for d in pkg.itinerary] == ["Arrival in Dubai", "Desert Safari", "Departure"]
    assert pkg.itinerary[1]["description"] == "Afternoon safari."
    assert pkg.inclusions == ["Hotel stay"] and pkg.exclusions == ["Visa"]
    assert any("numbered by order" in i.reason for i in pkg.needs_review)


def test_textbox_and_content_control_text_is_read(tmp_path):
    box = ('<w:p><w:r><w:drawing><w:txbxContent>' + p("Day 1: Arrival") + '</w:txbxContent></w:drawing></w:r></w:p>')
    sdt = '<w:sdt><w:sdtContent>' + p("Inclusions", bold=True) + p("Breakfast") + '</w:sdtContent></w:sdt>'
    doc = read_docx(make_docx(tmp_path / "t.docx", p("Trip 1N/2D", "Title") + box + sdt))
    pkg = extract(doc, "international")
    assert pkg.itinerary[0]["title"] == "Arrival" and pkg.inclusions == ["Breakfast"]


def test_restarted_day_blocks_and_label_noise_go_to_review(tmp_path):
    body = (
        p("Abu Dhabi & Dubai 2N/3D", "Title")
        + p("Itinerary", bold=True)
        + p("Day 1: Arrive Dubai") + p("Day 2: City tour") + p("Day 3: Depart")
        + p("Optional add-on", bold=True)
        + p("Day 1: Abu Dhabi tour") + p("Day 2: Ferrari World")
        + p("Day 5: Unrelated numbered line")
        + tbl([["City", "Option 01", "Option 02"], ["Dubai", "Hotel A", "Hotel B"],
               ["Price", "INR 40,000", "INR 52,000"]])
        + tbl([["Category", "Twin", "Single"], ["Option 1", "INR 40,000", "INR 55,000"]])
        + tbl([["Room", "Standard Room", "5★"]])
        + p("Departure Dates 2026", bold=True) + p("12 Oct, 19 Oct") + p("Every Friday") + p("Ex Mumbai")
    )
    pkg = extract(read_docx(make_docx(tmp_path / "AUH.docx", body)), "international")
    assert [d["title"] for d in pkg.itinerary] == ["Arrive Dubai", "City tour", "Depart"]
    assert any("Abu Dhabi tour" in t["text"] for t in pkg.review_text if t["field"] == "itinerary")
    assert [o["option_name"] for o in pkg.options] == ["Option 01", "Option 02"]
    assert pkg.options[0]["indicative_price"] == 40000
    assert not any("Standard Room" == o["option_name"] for o in pkg.options)
    assert pkg.departures == ["2026-10-12", "2026-10-19"]
    assert pkg.unparsed_departures == ["Every Friday"]
    assert not any("duplicate" in i.reason for i in pkg.needs_review)


def test_unlabelled_hotels_and_prices_become_one_flagged_option(tmp_path):
    body = (p("Abu Dhabi & Dubai 2N/3D", "Title")
            + p("Hotel Details", bold=True)
            + p("Dubai: Hotel Citymax or similar") + p("Abu Dhabi: Hotel Ibis")
            + p("Package Cost", bold=True) + p("Twin/Double sharing") + p("INR 45,000 per person"))
    pkg = extract(read_docx(make_docx(tmp_path / "AUH.docx", body)), "international")
    assert len(pkg.options) == 1 and pkg.options[0]["option_name"] == "Hotel Details"
    o = pkg.options[0]
    assert [h["hotel_name"] for h in o["hotels"]] == ["Hotel Citymax or similar", "Hotel Ibis"]
    assert o["hotels"][0]["city"] == "Dubai"
    assert o["indicative_price"] == 45000 and o["price_basis"] == "Twin/Double sharing"
    assert any("single option built" in i.reason for i in pkg.needs_review)
    assert not [t for t in pkg.review_text if t["field"] in ("hotels", "pricing")]


def test_heading_plus_detail_days_are_one_itinerary(tmp_path):
    body = (p("Baku + Georgia 2N/3D", "Title") + p("Itinerary", bold=True)
            + p("Day 1: Arrive Baku") + p("Day 2: Baku tour") + p("Day 3: Depart")
            + p("Detailed Itinerary", bold=True)
            + p("Day 1", bold=True) + p("Day 1: Arrive Baku") + p("Meet at airport.")
            + p("Day 2", bold=True) + p("Old city walk.")
            + p("Day 3", bold=True) + p("Transfer to airport."))
    pkg = extract(read_docx(make_docx(tmp_path / "Baku.docx", body)), "international")
    assert [d["day_number"] for d in pkg.itinerary] == [1, 2, 3]
    assert [d["title"] for d in pkg.itinerary] == ["Arrive Baku", "Baku tour", "Depart"]
    assert pkg.itinerary[0]["description"] == "Meet at airport."
    assert pkg.itinerary[1]["description"] == "Old city walk."
    assert not any(i.field == "itinerary" for i in pkg.needs_review)


def test_star_labels_under_option_are_hotel_categories(tmp_path):
    body = (p("Almaty 1N/2D", "Title")
            + tbl([["Option 1"], ["City", "Hotel", "Category"], ["Almaty", "Hotel Kazakhstan", "4 ****"]])
            + tbl([["Option 2"], ["City", "Hotel", "Category"], ["Almaty", "Rixos Almaty", "5 *****"]])
            + tbl([["Category", "Price"], ["Option 1", "INR 50,000"], ["Option 2", "INR 70,000"]]))
    pkg = extract(read_docx(make_docx(tmp_path / "Almaty.docx", body)), "international")
    assert [o["option_name"] for o in pkg.options] == ["Option 1", "Option 2"]
    assert pkg.options[0]["hotels"][0]["star_rating"] == 4 and pkg.options[1]["hotels"][0]["star_rating"] == 5
    assert [o["indicative_price"] for o in pkg.options] == [50000, 70000]


def test_unknown_duration_ignores_unrelated_numbered_days(tmp_path):
    body = (p("Abu Dhabi & Dubai", "Title") + p("Itinerary", bold=True)
            + p("Day 1: Arrive") + p("Day 2: Tour") + p("Day 3: Depart")
            + p("Day 10: Park access valid") + p("Day 26: Offer ends"))
    pkg = extract(read_docx(make_docx(tmp_path / "AUH.docx", body)), "international")
    assert [d["day_number"] for d in pkg.itinerary] == [1, 2, 3]
    assert sum(1 for t in pkg.review_text if t["field"] == "itinerary") == 2


def test_duration_with_nts_in_title_caps_days(tmp_path):
    body = (p("Abu Dhabi & Dubai 6 Nts / 7 Days", "Title") + p("Itinerary", bold=True)
            + "".join(p(f"Day {i}: Stop {i}") for i in range(1, 8)) + p("Day 9: Unrelated"))
    pkg = extract(read_docx(make_docx(tmp_path / "AUH.docx", body)), "international")
    assert (pkg.duration_nights, pkg.duration_days) == (6, 7)
    assert len(pkg.itinerary) == 7


def test_separately_priced_hotel_choices_are_not_collapsed(tmp_path):
    body = (p("Abu Dhabi & Dubai 6N/7D", "Title") + p("Hotel Details", bold=True)
            + p("Abu Dhabi Hotel (2N + 2 Park Access)")
            + p("Yas Island Rotana") + p("Centro Yas Island")
            + p("Package Cost", bold=True)
            + p("Yas Island Rotana: INR 85,000") + p("Centro Yas Island: INR 72,000"))
    pkg = extract(read_docx(make_docx(tmp_path / "AUH.docx", body)), "international")
    assert [o["option_name"] for o in pkg.options] == ["Yas Island Rotana", "Centro Yas Island"]
    assert [o["indicative_price"] for o in pkg.options] == [85000, 72000]
    assert pkg.options[0]["hotels"][0]["city"] == "Abu Dhabi" and pkg.options[0]["hotels"][0]["nights"] == 2
    assert not any("Park Access" in t["text"] for t in pkg.review_text)


def test_removed_option_label_keeps_table_context(tmp_path):
    body = (p("Azerbaijan 4N/5D", "Title")
            + tbl([["City", "Standard", "Deluxe"], ["Baku", "", "Hotel A"], ["Price", "", "INR 60,000"]]))
    pkg = extract(read_docx(make_docx(tmp_path / "AZ.docx", body)), "international")
    assert [o["option_name"] for o in pkg.options] == ["Deluxe"]
    ctx = [t["text"] for t in pkg.review_text if t["field"] == "options"]
    assert ctx and ctx[0].startswith("Standard") and "table header: City | Standard | Deluxe" in ctx[0]
