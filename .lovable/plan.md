# TripJack Integration — Zero-Cost Path

You want this done without paying for extra services. That is possible. The only thing money would normally buy here is a fixed outbound IP address, and there are two free ways around it.

## The one requirement that matters

Their guide says: the API key only appears after you save Whitelisted IPs, and only those IPs may call the API. IPv6 must be off. Our app's backend runs on serverless infrastructure with rotating IPs, so there is no single IP to give them.

Free ways to satisfy this, in order of preference:

1. **Ask your TripJack agent to open staging** — request `0.0.0.0/0` (all IPs) for the UAT/test key. Most agents allow this for testing since no real money moves. Costs nothing, unblocks everything today. Send them one message asking exactly this.
2. **Free always-free VPS relay** — Oracle Cloud Always Free (or similar) gives a permanent public IPv4 at no cost. We run a tiny relay there, whitelist that one IP with TripJack, and our backend calls TripJack through it. More setup, still free, and it also works for the live key later.

Live/production will very likely require a real whitelisted IP, so option 2 becomes the long-term answer either way. We start with option 1 so building can begin now.

## What you do on the TripJack portal

1. Log in at https://apitest.tripjack.com/ and change the password.
2. Manage User -> API Configuration.
3. Enter the whitelisted IPs -> SAVE.
4. Popup -> YES to generate the key.
5. Copy the key immediately. It is masked permanently afterwards. You will paste it into a secure form here, never into chat or email.

## Build phases (all free-tier)

**Phase 1 — Foundation**
- Enable Lovable Cloud (free tier) for the database and secure key storage. The last attempt errored; I will retry.
- Store `TRIPJACK_API_KEY` and the staging base URL as server secrets.
- Server-side TripJack client with auth header, timeouts, and error mapping. An optional relay URL setting so switching to option 2 later is a config change, not a rewrite.
- Tables: `bookings`, `booking_travellers`, `payments`. Guest bookings keyed by reference + email.
- A `/dev/tripjack-check` page that fires one authenticated test call, so we confirm whitelisting works before building any UI.

**Phase 2 — Flights**
Search form (from/to, dates, one-way/round-trip, pax, cabin) -> TripJack air search -> results with filters and sort -> fare rules and baggage -> traveller details -> re-price -> Razorpay test payment -> book -> PNR and confirmation page.

**Phase 3 — Hotels**
City/date/rooms search -> results with photos, star rating, price -> hotel detail with room and rate options and cancellation policy -> guest details -> payment -> booking voucher.

**Phase 4 — Post-booking**
Guest booking lookup by reference + email, confirmation emails, printable ticket/voucher, cancellation request flow, and an internal view for your desk.

Razorpay is free to set up; they only take a per-transaction cut on live payments. Test mode costs nothing.

## Technical notes

- All TripJack and Razorpay calls run in `createServerFn` handlers; keys are read inside handlers and never reach the browser.
- Base URL and optional relay host are config values, so test -> live and no-relay -> relay are switches, not rewrites.
- Idempotency keys on booking calls; prices always re-checked before payment.
- Zod validation on every search and traveller payload.
- Mobile-first results pages using the existing design system.

## What unblocks the build

The API key plus a whitelisting answer. Everything in Phase 1 except the live test call can be built before that arrives.
