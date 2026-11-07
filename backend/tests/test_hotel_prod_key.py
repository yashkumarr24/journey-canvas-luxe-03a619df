import asyncio, pytest
from app.core.config import Settings
from app.integrations.tripjack.config import build_config, build_hotel_config, build_hotel_booker_config
from app.services import hotel_booking as hb

def S(**kw):
    base = dict(TRIPJACK_API_KEY="flight-uat", TRIPJACK_BASE_URL="https://apitest.tripjack.com")
    base.update(kw); return Settings(**base)

def test_hotel_key_used_for_hms_and_oms_flight_unchanged():
    s = S(TRIPJACK_HOTEL_API_KEY="hotel-prod", TRIPJACK_HOTEL_BASE_URL="https://hms.tripjack.com",
          TRIPJACK_HOTEL_BOOKER_URL="https://hotel-booker.tripjack.com")
    assert build_hotel_config(s).api_key == "hotel-prod"
    assert build_hotel_booker_config(s).api_key == "hotel-prod"
    f = build_config(s)
    assert f.api_key == "flight-uat" and f.base_url == "https://apitest.tripjack.com"

def test_flight_key_never_sent_to_production_hotel_host():
    s = S(TRIPJACK_HOTEL_BASE_URL="https://hms.tripjack.com", TRIPJACK_HOTEL_BOOKER_URL="https://hotel-booker.tripjack.com")
    assert build_hotel_config(s).api_key == "" and not build_hotel_config(s).is_configured
    assert build_hotel_booker_config(s).api_key == ""

def test_uat_hotel_falls_back_to_flight_key():
    assert build_hotel_config(S()).api_key == "flight-uat"

@pytest.mark.parametrize("call", [
    lambda s: hb.book(settings=s, reference="X", mode="instant", user_id="u", guest_token=None, idempotency_key=None),
    lambda s: hb.cancel(settings=s, reference="X", user_id="u", guest_token=None),
    lambda s: hb.confirm_hold(settings=s, reference="X", user_id="u", guest_token=None),
])
def test_production_book_confirm_cancel_refused(call):
    s = S(TRIPJACK_HOTEL_API_KEY="k", TRIPJACK_HOTEL_BOOKER_URL="https://hotel-booker.tripjack.com")
    with pytest.raises(hb.HotelBookingUnavailableError):
        asyncio.run(call(s))
