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


def test_cli_caps_at_five_and_requires_confirm(tmp_path):
    for i in range(7):
        make_docx(tmp_path / f"{i}.docx", FULL)
    assert cli.main(["--dir", str(tmp_path), "--limit", "6"]) == 2
    assert cli.main(["--dir", str(tmp_path), "--execute"]) == 2
    out = tmp_path / "r.json"
    cli.main(["--dir", str(tmp_path), "--report", str(out)])
    assert json.loads(out.read_text())["files_processed"] == 5


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
