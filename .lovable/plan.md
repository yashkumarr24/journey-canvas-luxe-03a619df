# Flight & Hotel Booking with TripJack

Goal: turn Fly n Feel into a full online travel booking site (MakeMyTrip-style) powered by the TripJack API, with Razorpay payments and guest checkout (no login). Building starts only after you approve — nothing is created yet.

## What we need before building

1. TripJack UAT credentials (API key / user id) — you said test-only for now. Live keys can be swapped in later without code changes.
2. Lovable Cloud enabled — needed to store bookings, travellers, payment records and TripJack booking references, and to keep API keys off the browser.
3. Razorpay test key id + secret.

## Booking flow (both products)

```text
Search form -> results + filters -> select -> review & price re-check
   -> traveller/guest details -> Razorpay payment -> TripJack booking
   -> confirmation page + email + booking reference lookup
```

Every TripJack call runs on our server, never from the browser.

## Phase 1 — Foundation

- Enable Lovable Cloud; store TripJack and Razorpay keys as secrets.
- Server-side TripJack client (UAT base URL, auth header, error mapping, timeouts).
- Database: `bookings`, `booking_travellers`, `payments`, `search_logs`. Guest bookings keyed by a generated reference + email/phone.
- Shared booking UI shell matching the current design system (red accent, Inter Tight/Inter, pearl-white surfaces).

## Phase 2 — Flights

- `/flights` search: from/to airport autocomplete, dates, one-way / round-trip, pax counts, cabin class.
- TripJack air search -> results page with airline, times, duration, stops, fare; filters (stops, airline, price, departure window) and sorting.
- Fare rules and baggage detail on selection; re-price check before payment.
- Traveller details form with the fields TripJack requires (name as per ID, DOB, gender, contact; passport for international).
- Book -> hold -> Razorpay payment -> ticket confirmation, PNR shown and stored.

## Phase 3 — Hotels

- `/hotels` search: city/hotel autocomplete, check-in/out, rooms + guests.
- Results with photo, star rating, location, price per night, amenity chips, map-free list first.
- Hotel detail: gallery, room/rate options, cancellation policy, inclusions.
- Guest details -> Razorpay payment -> TripJack hotel booking -> voucher + confirmation.

## Phase 4 — Post-booking & polish

- `/booking/lookup` — retrieve a booking with reference + email (guest friendly).
- Confirmation emails (flight e-ticket summary / hotel voucher) with a PDF-style printable page.
- Cancellation request flow: user submits, your desk approves, TripJack cancel API called.
- Admin view for your team to see bookings, payment status and TripJack responses.
- Nav update: Flights and Hotels as primary links alongside the existing pages.

## Technical notes

- TanStack Start `createServerFn` for all TripJack and Razorpay calls; secrets read inside handlers.
- Razorpay: order created server-side, checkout opened client-side, signature verified in a server route before the TripJack booking is confirmed. Booking is only issued after verified payment; failed issuance triggers an automatic refund request and alerts your desk.
- Idempotency keys on booking calls so a double-click never double-books.
- Search results cached briefly (TripJack rate limits) and always re-priced before payment.
- Zod validation on every search and traveller payload.
- Everything responsive; results pages designed mobile-first.

## Suggested build order

Phase 1 -> Phase 2 (flights end to end in test mode) -> Phase 3 (hotels) -> Phase 4. Each phase is testable on UAT before moving on.
