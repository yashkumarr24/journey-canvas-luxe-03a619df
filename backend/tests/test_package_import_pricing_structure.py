"""Pricing/structure layouts seen in the 20-file dry run (synthetic DOCX only).

Covers: price-bearing "Label: INR …" lines that are not headings, hotel tables
with a star "Category" and "Room Type" column, option prices written after
the option's hotel table, "Package Cost (3★):" headings over Pax/Cost tables,
flight fares never used as the package price, day markers after a pricing
block, and a title duration that disagrees with the file name.
"""

from __future__ import annotations

from pathlib import Path

from app.package_import.coverage import account
from app.package_import.docx_reader import read_docx
from app.package_import.extractor import extract
from tests.test_package_import import make_docx, p, tbl

HDR = ["Nights", "City", "Hotel", "Category", "Room Type", "Meal Plan"]


def _run(path: Path):
    doc = read_docx(path)
    pkg = extract(doc, "international")
    return pkg, account(pkg, doc)


def _days(n: int) -> str:
    return "".join(p(f"Day {i}: Programme {i}") for i in range(1, n + 1))


def test_table_then_option_price_line_gives_separate_priced_options(tmp_path):
    body = (p("Bali Holiday Package – 6 Nights 7 Days", "Title") + _days(7)
            + p("Flight Fare: INR 1,15,800/- for Couple")
            + p("HOTEL OPTIONS", bold=True)
            + tbl([HDR, ["4N", "Kuta", "Anathera Resort Kuta", "4★", "Deluxe City View", "BB"],
                   ["2N", "Ubud", "Royal Casa Ganesha", "4★", "Deluxe", "BB"]])
            + p("Option 1 Package Cost: INR 86,000/- for Couple + GST 5%")
            + tbl([HDR, ["4N", "Kuta", "Fairfield by Marriott Legian", "4★", "Deluxe No Balcony", "BB"]])
            + p("Option 2 Package Cost: INR 93,000/- for Couple + GST 5%"))
    pkg, s = _run(make_docx(tmp_path / "Bali Holiday Package 6 Nights 7 Days.docx", body))
    by = {o["option_name"]: o for o in pkg.options}
    assert set(by) == {"Option 1", "Option 2"}            # never "4★" / room types as options
    assert by["Option 1"]["indicative_price"] == 86000 and len(by["Option 1"]["hotels"]) == 2
    assert by["Option 2"]["indicative_price"] == 93000 and len(by["Option 2"]["hotels"]) == 1
    h = by["Option 1"]["hotels"][0]
    assert h["star_rating"] == 4 and h["room_type"] == "Deluxe City View"
    assert pkg.indicative_price_from == 86000              # not the flight fare
    assert any("1,15,800" in (f["notes"] or "") for f in pkg.flights)
    assert any("price line" in r.reason for r in pkg.needs_review)
    assert s["source_lines"] == s["classified_lines"] + s["unclassified_items"]


def test_price_colon_line_stays_with_current_option(tmp_path):
    body = (p("Bali 6N/7D", "Title") + _days(7) + p("Hotels", bold=True)
            + p("Option 1 – Standard") + p("Kuta: Anathera Resort")
            + p("Price: INR 47,780/- for 2 Pax")
            + p("Option 2 – Deluxe") + p("Kuta: Fairfield Legian")
            + p("Price: INR 48,940/- for 2 Pax"))
    pkg, _ = _run(make_docx(tmp_path / "b.docx", body))
    by = {o["option_name"]: o["indicative_price"] for o in pkg.options}
    assert by == {"Option 1 – Standard": 47780, "Option 2 – Deluxe": 48940}
    assert not [t for t in pkg.review_text if t["field"] == "pricing"]


def test_package_cost_heading_after_option_hotels_prices_that_option(tmp_path):
    body = (p("Bali 7N/8D", "Title") + _days(8) + p("Hotel Options", bold=True)
            + p("Option 1 – Bronze Package") + p("Bronze")
            + p("4N in Kuta - Anathera Resort Kuta (Deluxe Room) // similar")
            + p("Package Cost", bold=True)
            + p("INR 22,500/- Per Person on Double Sharing × 4 Pax")
            + p("Total Land Package: INR 1,24,599/- + GST 5%")
            + p("Option 2 – Silver Package")
            + p("3N in Seminyak - Sakaya Villa // similar")
            + p("Package Cost", bold=True)
            + p("INR 27,999/- Per Person on Double Sharing × 4 Pax"))
    pkg, _ = _run(make_docx(tmp_path / "c.docx", body))
    by = {o["option_name"]: o for o in pkg.options}
    assert set(by) == {"Option 1 – Bronze Package", "Option 2 – Silver Package"}
    assert by["Option 1 – Bronze Package"]["indicative_price"] == 22500
    assert "1,24,599" in by["Option 1 – Bronze Package"]["price_text"]   # kept verbatim
    assert by["Option 2 – Silver Package"]["indicative_price"] == 27999


def test_labelled_pax_cost_tables(tmp_path):
    body = (p("Bhutan 7N/8D", "Title") + _days(8)
            + p("Hotels", bold=True) + p("🟠 3 Star Category") + p("Thimphu: Hotel Norbuling")
            + p("Package Cost (3★):", bold=True)
            + tbl([["Pax", "Total Cost", "Per Person"], ["24 Adults", "₹6,90,000/-", "₹28,750/-"]])
            + p("Package Cost (4★):", bold=True)
            + tbl([["Pax", "Total Cost", "Per Person"], ["24 Adults", "₹11,17,800/-", "₹46,575/-"]]))
    pkg, s = _run(make_docx(tmp_path / "d.docx", body))
    by = {o["option_name"]: o for o in pkg.options}
    assert by["🟠 3 Star Category"]["indicative_price"] == 28750      # per-person preferred
    assert by["🟠 3 Star Category"]["hotels"]
    assert by["4★"]["indicative_price"] == 46575
    assert "6,90,000" in by["🟠 3 Star Category"]["price_text"]
    assert not [t for t in pkg.review_text if t["field"] == "pricing"]


def test_day_lines_after_pricing_block_are_itinerary(tmp_path):
    body = (p("Baku 3N/4D", "Title") + p("Cost Per Couple", bold=True) + p("INR 1,56,000 for 2 pax")
            + p("DAY 1 - WELCOME TO BAKU") + p("Arrival at airport") + p("DAY 2 - CITY TOUR")
            + p("DAY 3 - GABALA") + p("DAY 4 - DEPARTURE"))
    pkg, _ = _run(make_docx(tmp_path / "e.docx", body))
    assert [d["day_number"] for d in pkg.itinerary] == [1, 2, 3, 4]
    assert pkg.itinerary[0]["description"] == "Arrival at airport"


def test_title_vs_filename_duration_conflict_is_flagged(tmp_path):
    body = p("Bali Holiday Package – 4 Nights 5 Days", "Title") + _days(5)
    pkg, _ = _run(make_docx(tmp_path / "Bali Holiday Package 6 Nights 7 Days - X.docx", body))
    assert (pkg.duration_nights, pkg.duration_days) == (4, 5)
    assert any(r.field == "duration" and "6N/7D" in r.reason for r in pkg.needs_review)
