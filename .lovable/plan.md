# Hotel module status clarification

## Current state

The Phase 9 hotel booking module is **not temporary as a feature**, but it currently uses a **temporary mock provider** so the complete user journey can be built and tested before real TripJack credentials are available.

### What is real / production-ready

- Hotel search, results, detail, room selection, review/re-price, guest details, checkout, payment structure, and confirmation pages.
- Frontend API boundary at `src/lib/hotel-api.ts`.
- Type definitions, route structure, components, and shared payment UI.
- Database support reuses existing `bookings`, `booking_items`, `payments`, `travellers`, and `hotel_searches` tables with RLS.

### What is temporary / mock-only

- `src/lib/hotel-mock.ts` returns static hotel catalog data and simulates search/detail/review/booking responses.
- Test payment buttons (simulate success/failure) stand in for real Razorpay.
- No real money, no real hotel inventory, and no live provider calls happen.

### How it becomes live later

Once TripJack UAT/production credentials and the GoDaddy VPS FastAPI backend are ready:

1. FastAPI endpoints are built for `/api/v1/hotels/search`, `/detail`, `/review`, `/guests`, `/booking`, and `/bookings/{ref}`.
2. FastAPI talks to TripJack (listing → detail → review → book) and Razorpay for payment.
3. The frontend `hotel-api.ts` flips from mock to real by setting `VITE_BOOKING_API_URL` and turning off `VITE_HOTEL_TEST_MODE`.
4. The mock adapter can then be deleted or kept only for local development.

## Options

Because you asked whether it is temporary, I can do one of the following — please pick:

- **Option A — leave everything as-is**: full demo hotel journey stays visible and testable.
- **Option B — add a "demo / coming soon" banner** on hotel pages so visitors know booking is not live yet.
- **Option C — hide the Hotels link and routes** from public view until the real integration is ready (routes can stay in code but not be linked).
- **Option D — remove the hotel module entirely** and restore it later from the saved plan.

No provider credentials or live API connections will be added unless you explicitly approve the next phase.
