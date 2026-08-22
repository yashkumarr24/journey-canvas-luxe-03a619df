# Database architecture (Supabase PostgreSQL)

Supabase is the **database**. FastAPI is the **API / security layer**. React is the
**client**. The browser never talks to TripJack, and never holds a service-role key.

```
React  ──HTTPS──▶  FastAPI (VPS, static IP)  ──▶  Supabase / TripJack / Razorpay
```

All privileged reads and writes (bookings, payments, events, provider calls) are
performed by FastAPI with the service-role key. Optional client-side auth may use
the anon key only, and RLS restricts it to *read-own* rows.

## Migration order

Run in numeric order; every file is idempotent and reproducible on a fresh database.

| # | File | Contents |
|---|------|----------|
| 0001 | `0001_foundation.sql` | `pgcrypto`, `citext`, enums, `set_updated_at()`, `generate_booking_reference()` |
| 0002 | `0002_profiles_travellers.sql` | `profiles`, `travellers` |
| 0003 | `0003_searches.sql` | `flight_searches`, `hotel_searches`, `search_result_refs` |
| 0004 | `0004_bookings.sql` | `bookings`, `booking_items`, `booking_travellers` |
| 0005 | `0005_payments_events.sql` | `payments`, `booking_events`, `provider_debug_logs` |
| 0006 | `0006_rls_policies.sql` | All RLS policies |

Apply with the Supabase CLI (preferred) or psql:

```bash
supabase db push                       # CLI, per environment
# or
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f backend/db/migrations/0001_foundation.sql
```

Never edit tables by hand in a dashboard — add a new numbered migration instead.

## Environment separation

Three **separate Supabase projects**: development, UAT/staging, production. Each has
its own URL and keys, supplied through that environment's `.env` (never committed).
Production credentials are never used locally. Migrations are applied dev → UAT → prod.

## Tables

| Table | Purpose | Client access |
|-------|---------|---------------|
| `profiles` | App profile for an auth user (never credentials) | read/write own |
| `travellers` | Passenger records; passport fields optional | read/write own |
| `flight_searches` / `hotel_searches` | Search analytics, non-identifying | none |
| `search_result_refs` | Opaque provider fare/room token + price + expiry | none |
| `bookings` | Core booking, public `FF-XXXXXXXX` reference | read own |
| `booking_items` | Priced components of a booking (normalized details) | read own |
| `booking_travellers` | Booking ↔ traveller join, ticket numbers | read own |
| `payments` | Gateway order/payment ids, amounts, status | read own |
| `booking_events` | Append-only lifecycle audit trail | none (internal) |
| `provider_debug_logs` | Optional redacted provider snapshots, 30-day expiry | none (internal) |

### Relationships

```
auth.users 1─1 profiles
auth.users 1─N travellers            (nullable → guest travellers)
auth.users 1─N bookings              (nullable → guest bookings)
bookings   1─N booking_items
bookings   1─N booking_travellers N─1 travellers
bookings   1─N payments
bookings   1─N booking_events
bookings   1─N provider_debug_logs
flight_searches / hotel_searches 1─N search_result_refs
```

## Money

Every monetary column is `numeric(12,2)` with a matching `char(3)` currency and a
`>= 0` check. No floating point anywhere. Totals sent by the browser are never
trusted; FastAPI recomputes and re-prices with the provider before payment.

## Booking references

`bookings.booking_reference` defaults to `generate_booking_reference()` —
`FF-` plus 8 characters drawn from `gen_random_bytes` over a 32-symbol alphabet,
protected by a `UNIQUE` index (retry on the rare collision). Internal UUIDs are
never shown to customers, and no sequential id is ever a customer-facing token.

## Guest bookings

`bookings.user_id` may be `NULL`. A guest is retrieved by
`booking_reference` **plus** a matching `contact_email`, verified inside FastAPI —
the reference alone is not an access token. Guest rows are invisible to every
`authenticated` client because all policies require `user_id = auth.uid()`.

## Authorization

RLS is the last line of defence, not the only one. FastAPI must re-check ownership
on every booking/payment endpoint: never trust `user_id`, `booking_id`, `role`,
`amount` or `price` from the browser. Authentication ≠ authorization.

## Sensitive data

- Never stored: passwords, API secrets, TripJack/Razorpay credentials, service-role
  key, card number, CVV, expiry, UPI PIN, bank password.
- Passport fields are nullable and collected only when the provider requires them;
  never logged, never placed in URLs or query strings.
- Future hardening path (no redesign needed): add `passport_number_enc bytea` +
  `passport_token text`, backfill, drop the plaintext column. All reads already go
  through FastAPI, so only the repository layer changes.
- `provider_debug_logs.redacted_body` is redacted before insert and purged on
  `expires_at` (30 days) by a scheduled job. Full raw provider responses are not
  persisted.
- Database errors are never returned to the frontend; FastAPI maps them to the safe
  `{success, code, message, request_id}` envelope.
