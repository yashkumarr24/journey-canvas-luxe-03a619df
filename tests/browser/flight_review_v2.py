import asyncio
from pathlib import Path
from playwright.async_api import async_playwright, expect

async def check(browser, name, changed, delta=False):
    context = await browser.new_context(viewport={"width":1280,"height":1800})
    page = await context.new_page()
    calls, errors = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    async def config(route):
        response = await route.fetch()
        await route.fulfill(response=response, body=(await response.text()).replace('import.meta.env.VITE_BOOKING_API_URL', '"http://localhost:8080"'))
    async def api(route):
        if '/flights/review/' in route.request.url:
            data = {"reviewToken":"test-review", "status":"price_changed" if changed else "reviewed",
                "itineraries":[{"direction":"outbound","segments":[{"origin":{"code":"DEL"},"destination":{"code":"BOM"},"departureAt":"2026-12-01T08:00:00+05:30","arrivalAt":"2026-12-01T10:00:00+05:30"}],"stops":0}],
                "fare":{"totalPrice":{"amount":8450,"currency":"INR"}},"passengers":{"adults":1,"children":0,"infants":0},
                "requirements":{"passportRequired":True,"passportExpiryRequired":True,"adultDobRequired":True},
                "conditions":{"isa":True,"pm":True,"pped":True,"adobr":True,"iecr":True,"ipa":True,"igm":False},
                "expiresAt":"2026-12-01T12:00:00Z","validForSeconds":180}
            if delta:
                data['priceChange']={"previous":{"amount":9000,"currency":"INR"},"current":{"amount":8450,"currency":"INR"},"difference":{"amount":550,"currency":"INR"},"direction":"decrease"}
            await route.fulfill(json={"success":True,"data":data})
        elif '/flights/travellers' in route.request.url:
            calls.append(route.request.post_data_json)
            await route.fulfill(status=409,json={"success":False,"message":"Test submission intercepted"})
        else:
            await route.fulfill(json={"success":True,"data":{}})
    await page.route('**/src/lib/booking-api.ts*',config)
    await page.route('**/api/v1/**',api)
    await page.goto('http://localhost:8080/flights/review?token=test-review')
    await expect(page.get_by_role('heading',name='Traveller details',exact=True)).to_be_visible()
    region = page.get_by_role('region',name='Requirements for this fare')
    await expect(region.get_by_text('Seat map available for this fare',exact=True)).to_be_visible()
    await expect(region.get_by_text('Passport required',exact=True)).to_be_visible()
    await expect(region.get_by_text('GST details required',exact=True)).to_have_count(0)
    button=page.get_by_role('button',name='Continue to payment',exact=True)
    if changed:
        await expect(button).to_be_disabled()
        await expect(page.get_by_role('status').filter(has_text='The airline re-priced this fare')).to_be_visible()
        await page.get_by_text('I accept the updated total of',exact=False).click()
        await expect(button).to_be_enabled()
    else:
        await expect(button).to_be_enabled()
    await page.get_by_label('First name (as on ID)').fill('Test')
    await page.get_by_label('Last name (as on ID)').fill('Passenger')
    await page.get_by_label('Date of birth',exact=True).fill('1990-01-01')
    await page.get_by_label('Passport number',exact=True).fill('A1234567')
    await page.get_by_label('Issuing country (2-letter code)').fill('IN')
    await page.get_by_label('Passport expiry',exact=True).fill('2030-01-01')
    await page.get_by_label('Email',exact=True).fill('test@example.com')
    await page.get_by_label('Phone',exact=True).fill('+919999999999')
    await button.click()
    await expect(page.get_by_text('Test submission intercepted',exact=True)).to_be_visible()
    assert len(calls)==1 and calls[0]['acceptPriceChange']==changed, calls
    assert errors==[],errors
    await region.screenshot(path=str(Path(__file__).parent/f'{name}.png'))
    print('PASS',name,'returned requirements visible; consent enforced; intercepted submission reads expected consent')
    await context.close()

async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        await check(browser,'success',False)
        await check(browser,'farealert_same_amount',True)
        await check(browser,'fare_decrease',True,True)
        await browser.close()
asyncio.run(main())
