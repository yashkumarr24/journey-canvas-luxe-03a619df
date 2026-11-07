import asyncio, pytest
from app.core.config import Settings
from app.integrations.tripjack import config as tj
from app.integrations.tripjack.config import build_config, build_hotel_config, build_hotel_booker_config, hotel_environment
from app.services import hotel_booking as hb

HMS_P, OMS_P = "https://hms-search.tripjack.com", "https://hms-booker.tripjack.com"
HMS_U, OMS_U = "https://apitest-hms.tripjack.com", "https://apitest-hotel-booker.tripjack.com"

@pytest.fixture
def confirmed():
    yield

def S(**kw):
    base = dict(TRIPJACK_API_KEY="flight-uat", TRIPJACK_BASE_URL="https://apitest.tripjack.com",
                TRIPJACK_HOTEL_API_KEY="hotel-prod")
    base.update(kw); return Settings(**base)

def test_production_pair_uses_hotel_key_flight_unchanged(confirmed):
    s = S(TRIPJACK_HOTEL_BASE_URL=HMS_P, TRIPJACK_HOTEL_BOOKER_URL=OMS_P)
    assert hotel_environment(s) == "production"
    assert build_hotel_config(s).api_key == "hotel-prod"
    assert build_hotel_booker_config(s).api_key == "hotel-prod"
    f = build_config(s)
    assert f.api_key == "flight-uat" and f.base_url == "https://apitest.tripjack.com"

def test_production_key_never_sent_to_uat():
    s = S(TRIPJACK_HOTEL_BASE_URL=HMS_U, TRIPJACK_HOTEL_BOOKER_URL=OMS_U)
    assert build_hotel_config(s).api_key == "flight-uat"
    assert build_hotel_booker_config(s).api_key == "flight-uat"

@pytest.mark.parametrize("hms,oms", [(HMS_P, OMS_U), (HMS_U, OMS_P), (HMS_P, ""), ("", OMS_P)])
def test_mixed_uat_production_rejected(confirmed, hms, oms):
    s = S(TRIPJACK_HOTEL_BASE_URL=hms, TRIPJACK_HOTEL_BOOKER_URL=oms)
    assert hotel_environment(s) == "invalid"
    assert not build_hotel_config(s).is_configured and not build_hotel_booker_config(s).is_configured

@pytest.mark.parametrize("hms,oms", [
    ("https://hms.tripjack.com", "https://hotel-booker.tripjack.com"),   # unknown
    (OMS_P, HMS_P),                                                      # wrong surface
    (OMS_U, HMS_U),                                                      # wrong surface UAT
    ("https://apitest.tripjack.com", OMS_U),                             # flight host
    (HMS_P + "/x", OMS_P), ("https://hms-search.tripjack.com:8443", OMS_P),
    ("http://" + HMS_P.split("//")[1], OMS_P),                           # not https
    ("https://apitest-hms.evil.com", OMS_U),                             # not tripjack
])
def test_unconfirmed_or_unsafe_hosts_rejected(confirmed, hms, oms):
    s = S(TRIPJACK_HOTEL_BASE_URL=hms, TRIPJACK_HOTEL_BOOKER_URL=oms)
    assert build_hotel_config(s).api_key == "" and build_hotel_booker_config(s).api_key == ""

def test_production_without_hotel_key_not_configured(confirmed):
    s = S(TRIPJACK_HOTEL_API_KEY="", TRIPJACK_HOTEL_BASE_URL=HMS_P, TRIPJACK_HOTEL_BOOKER_URL=OMS_P)
    assert build_hotel_config(s).api_key == ""

def test_exact_allowlists():
    assert tj.CONFIRMED_HOTEL_PRODUCTION_HOSTS == {"hms": frozenset({"hms-search.tripjack.com"}),
                                                  "oms": frozenset({"hms-booker.tripjack.com"})}
    assert tj.UAT_HOTEL_HOSTS == {"hms": frozenset({"apitest-hms.tripjack.com"}),
                                  "oms": frozenset({"apitest-hotel-booker.tripjack.com"})}

def test_trailing_slash_accepted():
    s = S(TRIPJACK_HOTEL_BASE_URL=HMS_P + "/", TRIPJACK_HOTEL_BOOKER_URL=OMS_P)
    assert hotel_environment(s) == "production"

CALLS = [
    lambda s: hb.book(settings=s, reference="X", mode="instant", user_id="u", guest_token=None, idempotency_key=None),
    lambda s: hb.cancel(settings=s, reference="X", user_id="u", guest_token=None),
    lambda s: hb.confirm_hold(settings=s, reference="X", user_id="u", guest_token=None),
]

BOOK_CONFIRM = CALLS[0::2]

@pytest.mark.parametrize("call", BOOK_CONFIRM)
@pytest.mark.parametrize("pair", [(HMS_P, OMS_P), (HMS_P, OMS_U), ("https://hms.tripjack.com", OMS_P)])
def test_production_or_invalid_book_confirm_refused(call, pair):
    s = S(TRIPJACK_HOTEL_BASE_URL=pair[0], TRIPJACK_HOTEL_BOOKER_URL=pair[1])
    with pytest.raises(hb.HotelBookingUnavailableError):
        asyncio.run(call(s))

@pytest.mark.parametrize("pair", [(HMS_P, OMS_U), (HMS_U, OMS_P), ("https://hms.tripjack.com", OMS_P)])
def test_cancel_refused_for_invalid_hosts(pair):
    s = S(TRIPJACK_HOTEL_BASE_URL=pair[0], TRIPJACK_HOTEL_BOOKER_URL=pair[1])
    with pytest.raises(hb.HotelBookingUnavailableError):
        asyncio.run(CALLS[1](s))

def test_cancel_gate_allows_production_pair():
    hb._cancel_gate(S(TRIPJACK_HOTEL_BASE_URL=HMS_P, TRIPJACK_HOTEL_BOOKER_URL=OMS_P))

def test_routes_never_mark_payment_verified():
    import pathlib, re
    src = pathlib.Path("app/api/v1/hotels.py").read_text()
    assert not re.search(r"payment_verified\s*=\s*True", src)
