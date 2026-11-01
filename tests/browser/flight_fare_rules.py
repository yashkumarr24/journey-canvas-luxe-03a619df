"""Review-page regression. Run a /tmp/browser copy against the running preview.

Only network responses and the public API base in the served test module are
substituted. The actual booking client, query, normalizer and page all run.
No provider, booking or payment request is made.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright, expect

CAPTURED = {"response": {"fareRules": [{"fareRule": {"DEL-BOM": {"tfr": {
    "CANCELLATION": ["Cancellation fee of INR 3500 applies"],
    "DATECHANGE": ["Date change fee of INR 2500 per passenger"],
    "NO_SHOW": ["No-show forfeits the base fare"],
    "SEAT_CHARGEABLE": ["Seat selection is chargeable on this fare"],
}}}}]}}
FALLBACK = "The airline didn't return detailed rules for this fare."


async def check_case(browser, name, response, expected_lines, error=False):
    context = await browser.new_context(viewport={"width": 1280, "height": 1800})
    page = await context.new_page()
    calls, page_errors = [], []
    page.on("pageerror", lambda e: page_errors.append(str(e)))

    async def configure_api(route):
        served = await route.fetch()
        text = (await served.text()).replace(
            "import.meta.env.VITE_BOOKING_API_URL", '"http://localhost:8080"'
        )
        await route.fulfill(response=served, body=text)

    async def api(route):
        if "/fare-rule" in route.request.url:
            calls.append((route.request.method, route.request.post_data_json))
            await route.fulfill(status=503 if error else 200, json=response)
        elif "/flights/review/" in route.request.url:
            await route.fulfill(json={"success": True, "data": {
                "reviewToken": "test-review", "status": "reviewed",
                "itineraries": [{"direction": "outbound", "segments": [{
                    "origin": {"code": "DEL"}, "destination": {"code": "BOM"},
                    "departureAt": "2026-12-01T08:00:00+05:30",
                    "arrivalAt": "2026-12-01T10:00:00+05:30",
                    "airline": {"code": "AI", "name": "Air India"},
                    "flightNumber": "101",
                }], "durationMinutes": 120, "stops": 0}],
                "fare": {"totalPrice": {"amount": 6500, "currency": "INR"}},
                "passengers": {"adults": 1, "children": 0, "infants": 0},
                "requirements": {}, "validForSeconds": 600,
                "expiresAt": "2026-12-01T12:00:00Z",
            }})
        else:
            await route.fulfill(json={"success": True, "data": {}})

    await page.route("**/src/lib/booking-api.ts*", configure_api)
    await page.route("**/api/v1/**", api)
    await page.goto("http://localhost:8080")
    # Test refs only, scoped to this origin and one synthetic selection.
    await page.evaluate("""() => sessionStorage.setItem('fnf.fareRefs.test-review',
        JSON.stringify({searchId:'selected-search', fareId:'selected-fare'}))""")
    await page.goto("http://localhost:8080/flights/review?token=test-review")
    await expect(page.get_by_role("heading", name="Traveller details", exact=True)).to_be_visible()
    section = page.get_by_role("region", name="Fare rules", exact=True)
    await expect(section).to_be_visible()
    await expect(section.get_by_role("status")).to_have_count(0)
    if error:
        await expect(section.get_by_role("alert")).to_contain_text("Fare rules couldn't be loaded")
    elif expected_lines:
        for line in expected_lines:
            await expect(section.get_by_text(line, exact=True)).to_be_visible()
        await expect(section.get_by_text(FALLBACK, exact=False)).to_have_count(0)
        await expect(section.get_by_role("listitem")).to_have_count(len(expected_lines))
    else:
        await expect(section.get_by_text(FALLBACK, exact=False)).to_be_visible()
    # Existing focus behavior must not issue a second request.
    await page.get_by_role("heading", name="Traveller details", exact=True).click()
    await page.evaluate("() => window.dispatchEvent(new Event('focus'))")
    await expect(section).to_be_visible()
    assert calls == [("POST", {"searchId": "selected-search", "fareId": "selected-fare"})], calls
    assert page_errors == [], page_errors
    await section.screenshot(path=str(Path(__file__).parent / f"{name}.png"))
    print(f"PASS {name}: one selected-flight POST; expected policies/state rendered")
    await context.close()


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        await check_case(browser, "captured", CAPTURED, [
            "Cancellation fee of INR 3500 applies",
            "Date change fee of INR 2500 per passenger",
            "No-show forfeits the base fare",
            "Seat selection is chargeable on this fare",
        ])
        await check_case(browser, "single_topic", {"response": {"fareRules": [
            {"fareRule": {"BOM-GOI": {"tfr": {"SEAT_CHARGEABLE": ["Seat selection is chargeable"]}}}},
        ]}}, ["Seat selection is chargeable"])
        await check_case(browser, "empty", {"response": {"fareRules": [
            {"fareRule": {"DEL-BOM": {"tfr": {"CANCELLATION": [], "DATECHANGE": [],
                "NO_SHOW": [], "SEAT_CHARGEABLE": []}}}},
        ]}}, [])
        await check_case(browser, "error", {"success": False, "message": "Rules unavailable"}, [], error=True)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())