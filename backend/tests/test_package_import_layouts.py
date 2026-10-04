"""Generic layout tests for the package importer's coverage pass.

Each synthetic DOCX uses a different layout. The rule under test is the same
for all of them: every source line is either stored in a field or reported
verbatim (with its location) as unclassified — nothing is dropped or invented.
"""

from __future__ import annotations

import csv
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import pytest

from app.diagnostics import package_import as cli
from app.package_import.coverage import account
from app.package_import.docx_reader import read_docx
from app.package_import.extractor import extract
from tests.test_package_import import FULL, NS, make_docx, p, tbl


def _run(path: Path):
    doc = read_docx(path)
    pkg = extract(doc, "international")
    return pkg, doc, account(pkg, doc)


def _textbox(*lines: str) -> str:
    inner = "".join(p(x) for x in lines)
    return ("<w:p><w:r><w:pict><v:shape xmlns:v=\"urn:schemas-microsoft-com:vml\"><v:textbox>"
            f"<w:txbxContent>{inner}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>")


PARAGRAPH_LAYOUT = FULL
TABLE_LAYOUT = (
    p("Dubai Delight 4N/5D", "Title")
    + tbl([["Day", "Programme"], ["1", "Arrive Dubai, transfer to hotel"], ["2", "City tour"],
           ["3", "Desert safari"], ["4", "Free day"], ["5", "Depart"]])
    + tbl([["City", "3★", "4★"], ["Dubai (4N)", "Citymax or similar", "Rove Downtown"],
           ["Price per person", "INR 39,999", "INR 49,999"]])
    + tbl([["Inclusions", "Exclusions"], ["Breakfast daily", "Airfare"], ["Airport transfers", "Visa fee"]])
)
TEXTBOX_LAYOUT = (
    p("Bali Escape 5N/6D", "Title")
    + _textbox("Highlights", "Ubud rice terraces", "Uluwatu sunset")
    + p("Day 1: Arrive Bali") + p("Day 2: Ubud") + p("Day 3: Kintamani") + p("Day 4: Nusa Penida")
    + p("Day 5: Leisure") + p("Day 6: Depart")
    + p("Inclusions", bold=True) + p("Daily breakfast")
    + p("Exclusions", bold=True) + p("Tips")
)


@pytest.mark.parametrize("body", [PARAGRAPH_LAYOUT, TABLE_LAYOUT, TEXTBOX_LAYOUT],
                         ids=["paragraph-sections", "table-driven", "text-boxes"])
def test_every_source_line_is_accounted_for(tmp_path, body):
    pkg, _, s = _run(make_docx(tmp_path / "pkg.docx", body))
    assert s["source_lines"] == s["classified_lines"] + s["unclassified_items"]
    assert s["structured"]["itinerary"] >= 5
    assert s["structured"]["inclusions"] and s["structured"]["exclusions"]


def test_table_layout_separates_options_prices_and_lists(tmp_path):
    pkg, _, s = _run(make_docx(tmp_path / "Dubai.docx", TABLE_LAYOUT))
    names = sorted(o["option_name"] for o in pkg.options)
    assert names == ["3★", "4★"]
    assert sorted(o["indicative_price"] for o in pkg.options) == [39999, 49999]
    assert pkg.inclusions == ["Breakfast daily", "Airport transfers"] and pkg.exclusions == ["Airfare", "Visa fee"]
    assert s["unclassified_items"] == 0


def test_textbox_content_is_read_and_reported(tmp_path):
    pkg, _, s = _run(make_docx(tmp_path / "Bali.docx", TEXTBOX_LAYOUT))
    assert s["layout_parts"]["textbox_paragraphs"] == 3
    assert "Ubud rice terraces" in pkg.highlights


def test_unplaced_table_row_is_kept_with_location(tmp_path):
    body = FULL.replace(
        '<w:tr><w:tc>' + p("Luxury"),
        '<w:tr><w:tc>' + p("") + '</w:tc><w:tc>' + p("Early check-in subject to availability")
        + '</w:tc><w:tc>' + p("") + '</w:tc></w:tr><w:tr><w:tc>' + p("Luxury"), 1)
    pkg, _, s = _run(make_docx(tmp_path / "K.docx", body))
    hits = [u for u in pkg.unclassified if "Early check-in" in u["text"]]
    assert hits and "table at block" in hits[0]["context"] and "header:" in hits[0]["context"]
    assert any(i.field == "unclassified" for i in pkg.needs_review)


def test_headers_footers_and_footnotes_are_reported_not_merged(tmp_path):
    path = make_docx(tmp_path / "H.docx", FULL)
    with zipfile.ZipFile(path, "a") as z:
        z.writestr("word/header1.xml", f"<w:hdr {NS}>{p('Fly n Feel Holidays')}</w:hdr>")
        z.writestr("word/footer1.xml", f"<w:ftr {NS}>{p('Call +91 00000 00000')}</w:ftr>")
        z.writestr("word/footnotes.xml", f"<w:footnotes {NS}><w:footnote>{p('Rates valid till March')}</w:footnote></w:footnotes>")
    pkg, _, s = _run(path)
    texts = {u["text"]: u["context"] for u in pkg.unclassified}
    assert "Fly n Feel Holidays" in texts and "outside the main body" in texts["Fly n Feel Holidays"]
    assert "Rates valid till March" in texts and "Call +91 00000 00000" in texts
    assert "Fly n Feel Holidays" not in (pkg.overview or "") and pkg.name == "Magical Kashmir 5N/6D"
    assert s["layout_parts"]["header_footer_note_lines"] == 3


def test_linked_images_are_flagged(tmp_path):
    path = make_docx(tmp_path / "L.docx", FULL)
    rels = ('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="r9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
            'Target="http://example.com/a.jpg" TargetMode="External"/></Relationships>')
    with zipfile.ZipFile(path, "a") as z:
        z.writestr("word/_rels/document.xml.rels", rels)
    pkg, _, s = _run(path)
    assert s["layout_parts"]["linked_images"] == 1
    assert any(i.field == "images" and "linked" in i.reason for i in pkg.needs_review)


def test_review_text_entries_get_source_context(tmp_path):
    body = (p("Almaty 5N/6D", "Title") + p("Hotels", bold=True) + p("Standard")
            + p("Day 1: Arrive") + p("Day 2: City") + p("Day 3: Lake") + p("Day 4: Free") + p("Day 5: Shop") + p("Day 6: Fly"))
    pkg, _, _ = _run(make_docx(tmp_path / "A.docx", body))
    std = [t for t in pkg.review_text if t["text"].startswith("Standard")]
    assert std and std[0]["context"].startswith("paragraph")


def test_cli_writes_extraction_summary_and_context(tmp_path):
    src = tmp_path / "intl"
    src.mkdir()
    make_docx(src / "A.docx", TABLE_LAYOUT)
    make_docx(src / "B.docx", FULL.replace(p("GST 5%"), p("GST 5%") + tbl([["Random", "Grid"], ["zqx", "wvy"]])))
    out = tmp_path / "rep"
    assert cli.main(["--source", str(src), "--report-dir", str(out)]) == 0
    rows = list(csv.DictReader((out / "extraction_summary.csv").open(encoding="utf-8")))
    assert {r["file"] for r in rows} == {"A.docx", "B.docx"}
    assert all(float(r["coverage_pct"]) > 0 for r in rows)
    rt = list(csv.DictReader((out / "review_text.csv").open(encoding="utf-8")))
    assert "source_context" in rt[0] if rt else True
    assert any(r["text"] in ("zqx", "wvy") and r["field"] == "unclassified" and r["source_context"] for r in rt)


def test_dry_run_is_still_default(tmp_path, monkeypatch):
    src = tmp_path / "intl"
    src.mkdir()
    make_docx(src / "A.docx", TABLE_LAYOUT)
    called = []
    monkeypatch.setattr(cli, "_execute", lambda *a, **k: called.append(1))
    assert cli.main(["--source", str(src)]) == 0 and not called
