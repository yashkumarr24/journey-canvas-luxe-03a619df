# Flight V2 Review verification

## Implemented scope

- Existing flight selection still calls Review once on the VPS through the existing API configuration. Review-page GET replays the authorized server session; it does not create another provider session.
- Provider POST `fms/v1/review` sends only `{ "priceIds": [...] }`, using the selected fare's stored `provider_refs` or its primary reference. No cross-leg combinations are constructed. Automatic retries remain disabled.
- Returned `bookingId` stays private in `provider_booking_ref`; plural selected price IDs are saved to the existing `provider_price_refs` column. No columns or migrations were added.
- The exact returned conditions are retained in the existing itinerary JSON snapshot and replayed to the Review page. Only explicitly true documented fields are displayed. `pm` means passport mandatory; `ipa` means PAN applicable, not passport. Adult/child/infant DOB flags are mapped separately. No geographical document rules are invented.
- Returned `conditions.st` controls session validity; a timezone-qualified `sct` anchors it when present. Missing/unusable duration preserves the existing compatibility lifetime, not a claim of provider validity. The page says review validity, not that a seat or fare is held.
- `FAREALERT`, including an alert with an unchanged numeric total, and increases/decreases all require explicit acknowledgement using the existing consent field/server gate. The customer sees the current server-reviewed total. Continue remains disabled until acknowledgement.
- Seat map/hold/GST/emergency-contact/PAN/document flags are informational requirements only. No seat-map call, hold, new Book fields or payment behavior was implemented.
- Unsupported multi-city Review stays blocked. Hotel, provider booking, payment, certification and Search implementations were not modified.

## Official documentation limit

The supplied official PDF (page 3) and Review screenshot establish the endpoint, `priceIds` array, `bookingId`, conditions table and FAREALERT warning. They do **not** contain a complete Review JSON response, an exact FAREALERT object schema or the revised total's precise response field. Existing `tripInfos`/`totalPriceInfo` and alerts-array normalization were preserved, rather than introducing guessed replacements. Response tests exercising those existing fields are compatibility fixtures, **not** an official captured Review sample. Full response conformance requires an official TripJack sample/clarification; this is not a claim that an end-to-end live provider booking was verified.

## Changed files

- `backend/app/integrations/tripjack/review.py`
- `backend/app/repositories/reviews.py`
- `backend/app/schemas/review.py`
- `backend/app/services/flight_booking.py` (selection, review shaping and existing traveller consent/requirement gate only)
- `backend/tests/test_flight_review.py`
- `backend/tests/test_flight_review_v2.py` (new)
- `src/types/booking.ts`
- `src/components/booking/TravellerForm.tsx`
- `src/routes/flights.review.tsx`
- `tests/browser/flight_review_v2.py` (new)
- `AGENTS.md`, `roadmap.md`, this report

## Checks

Isolated Python environment: `/tmp/flight-review-venv`, installed from existing `backend/requirements.txt`.

```sh
PYTHONPATH=backend /tmp/flight-review-venv/bin/pytest -q \
  backend/tests/test_flight_review.py \
  backend/tests/test_flight_review_v2.py \
  backend/tests/test_flight_multicity.py
```

**83 passed**, one unrelated Starlette/AnyIO deprecation warning. Tests assert documented request shape, selected plural IDs and single-ID compatibility, booking handle retention, explicit conditions/expiry, PAN versus passport, persistence/replay and blocked unaccepted changes, including a decrease and unchanged-total FAREALERT.

Expanded compatibility run, same command with `backend/tests/test_flight_search.py` added: **121 passed**, one unrelated deprecation warning.

```sh
mkdir -p /tmp/browser/flight-review-v2
cp tests/browser/flight_review_v2.py /tmp/browser/flight-review-v2/check_review.py
python3 /tmp/browser/flight-review-v2/check_review.py
```

**3/3 browser cases passed:** success, unchanged-total FAREALERT, fare decrease. Real Review UI and booking client run against intercepted test responses; returned requirements render, false flags do not render, consent disables/enables Continue, and the intercepted traveller POST contains the expected consent. No provider, production database, real booking or payment requests were made. No browser page errors.

Automatic preview checks: **build OK**. No manual production build/typecheck was run; these are managed by the preview harness.

No deployment, migration application, VPS restart, provider call or production data change occurred. VPS compatibility is not certified by local tests; this checkout's existing plural columns must match the target VPS, as previously verified by the user.