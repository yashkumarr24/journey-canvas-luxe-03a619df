import json

from app.diagnostics import hotel_listing_uat as uat

ROOMS = [{"adults": 2, "childAges": []}]
SECRETS = ["ABCDE1234F", "PQRSX9876Z", "ops@example.com", "9876543210", "Uataa", "Uatab", "Diagnostic"]


def _payload(booking_id="BID-1", pans=("ABCDE1234F", "PQRSX9876Z")):
    return uat.build_uat_book_payload(booking_id=booking_id, rooms=ROOMS, email="ops@example.com",
                                      phone="9876543210", pans=list(pans))


def _ident(p, hid="100001"):
    return uat.booking_identity_summary(p, hid=hid, check_in="2026-10-10", check_out="2026-10-11")


def test_identity_has_no_sensitive_values():
    text = json.dumps(_ident(_payload()))
    for s in SECRETS + ["BID-1", "100001"]:
        assert s not in text
    assert "2026-10-10" in text


def test_fresh_booking_id_changes_only_its_fingerprint():
    a, b = _ident(_payload("BID-1")), _ident(_payload("BID-2"))
    assert a["review_booking_id_fp"] != b["review_booking_id_fp"]
    # Synthetic guest names/PAN/contact are identical across runs -> same fingerprints.
    for k in ("lead_guest_fp", "all_guests_fp", "pan_set_fp", "email_fp", "phone_fp", "hotel_fp"):
        assert a[k] == b[k]


def test_different_hotel_or_pan_changes_fingerprint():
    assert _ident(_payload(), hid="1")["hotel_fp"] != _ident(_payload(), hid="2")["hotel_fp"]
    assert _ident(_payload(pans=("ABCDE1234F", "ABCDE1234F")))["pan_set_fp"] != _ident(_payload())["pan_set_fp"]


def test_duplicate_error_detected_and_id_redacted():
    body = {"errors": [{"errCode": "2502",
                        "message": "Duplicate Booking. This is a duplicate booking of TJP200203091176"}]}
    assert uat.is_duplicate_booking(body)
    msg = uat.book_summary(body)["errors"][0]["message"]
    assert "TJP200203091176" not in msg and "<TJ-ID>" in msg
    assert not uat.is_duplicate_booking({"errors": [{"errCode": "810", "message": "x"}]})
